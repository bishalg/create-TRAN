//! Destinations and Android package names for the tokens / i18n codegen binary.
//!
//! Paths are relative to the Cargo workspace root. Edit
//! `tooling/design-tokens/codegen.json` when renaming the sample app; keep the
//! binary in this monorepo (ADR-0025).

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Relative path of the checked-in codegen destinations file.
pub const CODEGEN_CONFIG_RELATIVE: &str = "tooling/design-tokens/codegen.json";

/// Where `tran-tokens-codegen` writes platform artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CodegenConfig {
    /// Directory of locale JSON modules (`locales/`).
    pub locales_dir: String,
    /// `@tran/core` generated tokens and string keys.
    pub core_generated_dir: String,
    /// Web CSS custom properties output.
    pub web_generated_dir: String,
    /// iOS SwiftUI generated tokens and String Catalogs.
    pub ios_generated_dir: String,
    /// Android Compose / Kotlin generated sources.
    pub android_kotlin_generated_dir: String,
    /// Android `res/` root for per-locale `strings_*.xml`.
    pub android_res_dir: String,
    /// `package` line for generated Kotlin sources.
    pub android_kotlin_package: String,
    /// App package that owns `R` (imported from generated Kotlin).
    pub android_app_package: String,
    /// Google DESIGN.md (Stitch / agents) — usually repo-root `DESIGN.md`.
    pub design_md_path: String,
}

impl CodegenConfig {
    /// Defaults matching the Voting Eligibility sample layout.
    pub fn sample_defaults() -> Self {
        Self {
            locales_dir: "locales".into(),
            core_generated_dir: "packages/core-ts/src/generated".into(),
            web_generated_dir: "apps/web/src/styles/generated".into(),
            ios_generated_dir: "apps/ios/Sources/TranVotingDemo/Generated".into(),
            android_kotlin_generated_dir:
                "apps/android/app/src/main/kotlin/com/tran/voting/generated".into(),
            android_res_dir: "apps/android/app/src/main/res".into(),
            android_kotlin_package: "com.tran.voting.generated".into(),
            android_app_package: "com.tran.voting".into(),
            design_md_path: "DESIGN.md".into(),
        }
    }

    /// Load JSON from `path`, rejecting unknown fields.
    pub fn load_from_path(path: &Path) -> Result<Self, String> {
        let raw = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", path.display()))
    }

    /// Load `tooling/design-tokens/codegen.json` under `workspace_root`.
    pub fn load_for_workspace(workspace_root: &Path) -> Result<Self, String> {
        let path = workspace_root.join(CODEGEN_CONFIG_RELATIVE);
        Self::load_from_path(&path)
    }

    /// Absolute paths derived from this config and the workspace root.
    pub fn resolve(&self, workspace_root: &Path) -> CodegenPaths {
        CodegenPaths {
            locales_dir: workspace_root.join(&self.locales_dir),
            core_generated_dir: workspace_root.join(&self.core_generated_dir),
            web_generated_dir: workspace_root.join(&self.web_generated_dir),
            ios_generated_dir: workspace_root.join(&self.ios_generated_dir),
            android_kotlin_generated_dir: workspace_root.join(&self.android_kotlin_generated_dir),
            android_res_dir: workspace_root.join(&self.android_res_dir),
            android_kotlin_package: self.android_kotlin_package.clone(),
            android_app_package: self.android_app_package.clone(),
            design_md_path: workspace_root.join(&self.design_md_path),
        }
    }
}

/// Absolute destinations plus Android package names for one codegen run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodegenPaths {
    pub locales_dir: PathBuf,
    pub core_generated_dir: PathBuf,
    pub web_generated_dir: PathBuf,
    pub ios_generated_dir: PathBuf,
    pub android_kotlin_generated_dir: PathBuf,
    pub android_res_dir: PathBuf,
    pub android_kotlin_package: String,
    pub android_app_package: String,
    pub design_md_path: PathBuf,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn sample_defaults_match_checked_in_json_shape() {
        let defaults = CodegenConfig::sample_defaults();
        assert_eq!(defaults.locales_dir, "locales");
        assert_eq!(
            defaults.ios_generated_dir,
            "apps/ios/Sources/TranVotingDemo/Generated"
        );
        assert_eq!(defaults.android_kotlin_package, "com.tran.voting.generated");
        assert_eq!(defaults.android_app_package, "com.tran.voting");
    }

    #[test]
    fn load_from_path_reads_json() {
        let dir = std::env::temp_dir().join(format!("tran-codegen-config-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("codegen.json");
        let mut file = fs::File::create(&path).expect("create");
        write!(
            file,
            r#"{{
  "locales_dir": "locales",
  "core_generated_dir": "packages/core-ts/src/generated",
  "web_generated_dir": "apps/web/src/styles/generated",
  "ios_generated_dir": "apps/ios/Sources/Renamed/Generated",
  "android_kotlin_generated_dir": "apps/android/app/src/main/kotlin/com/example/generated",
  "android_res_dir": "apps/android/app/src/main/res",
  "android_kotlin_package": "com.example.generated",
  "android_app_package": "com.example",
  "design_md_path": "DESIGN.md"
}}"#
        )
        .expect("write");
        let loaded = CodegenConfig::load_from_path(&path).expect("load");
        assert_eq!(
            loaded.ios_generated_dir,
            "apps/ios/Sources/Renamed/Generated"
        );
        assert_eq!(loaded.android_app_package, "com.example");
        assert_eq!(loaded.design_md_path, "DESIGN.md");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_rejects_unknown_fields() {
        let dir = std::env::temp_dir().join(format!("tran-codegen-bad-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("codegen.json");
        fs::write(&path, r#"{"locales_dir":"locales","extra":true}"#).expect("write");
        assert!(CodegenConfig::load_from_path(&path).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_joins_workspace_root() {
        let root = PathBuf::from("/tmp/tran-root");
        let paths = CodegenConfig::sample_defaults().resolve(&root);
        assert_eq!(paths.locales_dir, root.join("locales"));
        assert_eq!(
            paths.android_kotlin_generated_dir,
            root.join("apps/android/app/src/main/kotlin/com/tran/voting/generated")
        );
    }

    #[test]
    fn checked_in_codegen_json_matches_sample_defaults() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = manifest
            .parent()
            .and_then(|p| p.parent())
            .expect("workspace root");
        let loaded = CodegenConfig::load_for_workspace(root).expect("load codegen.json");
        assert_eq!(loaded, CodegenConfig::sample_defaults());
    }
}
