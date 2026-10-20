//! The only disk access the library needs: reading `locales/`, and finding generated files that
//! a run no longer writes (REQ-GEN-003). Writing is the binary's job.

use crate::config::CodegenPaths;
use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// One artifact `generate` produced, not yet written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedFile {
    pub path: PathBuf,
    pub contents: String,
}

/// Entries of `dir`, sorted so every run visits them in the same order.
pub fn list_dir(dir: &Path) -> Result<Vec<PathBuf>, String> {
    fs::read_dir(dir)
        .and_then(|entries| {
            entries
                .map(|entry| entry.map(|entry| entry.path()))
                .collect::<io::Result<Vec<_>>>()
        })
        .map(|mut paths| {
            paths.sort();
            paths
        })
        .map_err(|e| format!("read {}: {e}", dir.display()))
}

pub fn read_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))
}

/// Generated files of the kinds this tool owns that `written` does not include: String Catalogs in
/// the iOS output (and its `Strings/` folder), and `strings*.xml` in every Android `values*` folder.
/// Anything else in those folders is left alone.
pub fn stale_files(
    paths: &CodegenPaths,
    written: &BTreeSet<PathBuf>,
) -> Result<Vec<PathBuf>, String> {
    let is_catalog: Matcher = |name| name.ends_with(".xcstrings");
    let is_android_strings: Matcher = |name| name.starts_with("strings") && name.ends_with(".xml");
    let ios = &paths.ios_generated_dir;
    // The pre-module layout kept a single `Generated/Localizable.xcstrings`.
    let catalogs = [ios.join("Strings"), ios.clone()].map(|folder| (folder, is_catalog));
    let android = existing(&paths.android_res_dir)?
        .into_iter()
        .filter(|folder| folder.is_dir() && file_name(folder).starts_with("values"))
        .map(|folder| (folder, is_android_strings));

    let mut stale = Vec::new();
    for (folder, matches) in catalogs.into_iter().chain(android) {
        stale.extend(unwritten(&folder, written, matches)?);
    }
    Ok(stale)
}

/// Deletes `stale` files, then each folder they leave empty (a removed locale's `values-xx/`).
pub fn remove_stale(stale: &[PathBuf]) -> Result<(), String> {
    stale
        .iter()
        .try_for_each(|path| remove(|p| fs::remove_file(p), path))?;
    let folders: BTreeSet<&Path> = stale.iter().filter_map(|path| path.parent()).collect();
    folders
        .into_iter()
        .filter(|folder| list_dir(folder).is_ok_and(|entries| entries.is_empty()))
        .try_for_each(|folder| remove(|p| fs::remove_dir(p), folder))
}

fn remove(operation: fn(&Path) -> io::Result<()>, path: &Path) -> Result<(), String> {
    operation(path).map_err(|e| format!("remove {}: {e}", path.display()))
}

type Matcher = fn(&str) -> bool;

fn unwritten(
    dir: &Path,
    written: &BTreeSet<PathBuf>,
    matches: Matcher,
) -> Result<Vec<PathBuf>, String> {
    existing(dir).map(|paths| {
        paths
            .into_iter()
            .filter(|path| path.is_file() && matches(&file_name(path)) && !written.contains(path))
            .collect()
    })
}

/// Like [`list_dir`], but a folder that does not exist yet has no entries.
fn existing(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if dir.exists() {
        list_dir(dir)
    } else {
        Ok(Vec::new())
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::config::CodegenConfig;

    fn touch(root: &Path, relative: &str) -> PathBuf {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "x").unwrap();
        path
    }

    // Verifies: REQ-GEN-003
    #[test]
    fn finds_only_unwritten_generated_files_and_removes_emptied_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let paths = CodegenConfig::sample_defaults().resolve(root);
        let ios = "apps/ios/Sources/TranVotingDemo/Generated";
        let res = "apps/android/app/src/main/res";

        let kept_catalog = touch(root, &format!("{ios}/Strings/Shell.xcstrings"));
        let old_catalog = touch(root, &format!("{ios}/Strings/Removed.xcstrings"));
        let legacy_catalog = touch(root, &format!("{ios}/Localizable.xcstrings"));
        let swift = touch(root, &format!("{ios}/BrandTokens.swift"));
        let kept_strings = touch(root, &format!("{res}/values/strings_shell.xml"));
        let dropped_locale = touch(root, &format!("{res}/values-fr/strings_shell.xml"));
        let colors = touch(root, &format!("{res}/values/colors.xml"));
        let drawable = touch(root, &format!("{res}/drawable/strings_icon.xml"));
        touch(root, &format!("{res}/values-file-not-folder"));

        let written = BTreeSet::from([kept_catalog.clone(), kept_strings.clone()]);
        let stale = stale_files(&paths, &written).unwrap();
        assert_eq!(
            stale,
            [old_catalog.clone(), legacy_catalog, dropped_locale.clone()]
        );

        remove_stale(&stale).unwrap();
        let exists = |paths: &[&PathBuf]| paths.iter().map(|p| p.exists()).collect::<Vec<_>>();
        assert_eq!(exists(&[&old_catalog, &dropped_locale]), [false, false]);
        // The emptied `values-fr/` goes too.
        assert!(!dropped_locale.parent().unwrap().exists());
        let kept = [&kept_catalog, &swift, &kept_strings, &colors, &drawable];
        assert_eq!(exists(&kept), [true; 5]);
        assert_eq!(
            stale_files(&paths, &written).unwrap(),
            Vec::<PathBuf>::new()
        );
    }

    #[test]
    fn a_tree_without_outputs_has_nothing_stale() {
        let dir = tempfile::tempdir().unwrap();
        let paths = CodegenConfig::sample_defaults().resolve(dir.path());
        assert!(stale_files(&paths, &BTreeSet::new()).unwrap().is_empty());
    }

    /// Makes `dir` unreadable for the rest of the test; `false` when that cannot be enforced (root).
    #[cfg(unix)]
    pub(crate) fn make_unreadable(dir: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o000)).unwrap();
        fs::read_dir(dir).is_err()
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_output_folder_fails_the_scan() {
        use std::os::unix::fs::PermissionsExt;
        for folder in [
            "apps/android/app/src/main/res",
            "apps/ios/Sources/TranVotingDemo/Generated/Strings",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let paths = CodegenConfig::sample_defaults().resolve(dir.path());
            let locked = dir.path().join(folder);
            fs::create_dir_all(&locked).unwrap();
            // Root reads anything; then there is nothing to check.
            let enforced = make_unreadable(&locked);
            let result = stale_files(&paths, &BTreeSet::new());
            assert!(!enforced || result.unwrap_err().starts_with("read "));
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn io_failures_name_the_path() {
        assert!(list_dir(Path::new("/no/such/dir"))
            .unwrap_err()
            .contains("read /no/such/dir"));
        assert!(read_file(Path::new("/no/such/file"))
            .unwrap_err()
            .contains("read /no/such/file"));
        let missing = PathBuf::from("/no/such/stale.xml");
        assert!(remove_stale(&[missing])
            .unwrap_err()
            .contains("remove /no/such/stale.xml"));
    }
}
