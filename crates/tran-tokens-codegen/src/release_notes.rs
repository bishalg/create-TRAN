//! The current version's release notes for the store listings (REQ-MOB-011): the version comes from
//! the root `package.json` and the text from its `CHANGELOG.md` section, both written by
//! `pnpm release` (ADR-0034, REQ-REL-003). This mirrors `notesFor` and `buildNumber` in
//! `tooling/release/release.mjs`; `tooling/mobile-release/metadata.test.mjs` checks the generated
//! notes against that tool, so the two cannot disagree unnoticed.

/// The version being released and, when `CHANGELOG.md` has a section for it, that section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    /// Android `versionCode` and iOS `CURRENT_PROJECT_VERSION`: names the Play changelog file.
    pub build_number: u64,
    /// `None` before the first `pnpm release`: a first store version has no "What's new".
    pub notes: Option<String>,
}

/// Reads the version from `package_json` and its section from `changelog`.
pub fn current_release(package_json: &str, changelog: &str) -> Result<Release, String> {
    let document: serde_json::Value =
        serde_json::from_str(package_json).map_err(|e| format!("parse package.json: {e}"))?;
    let version = document
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or("package.json has no `version`")?
        .to_string();
    Ok(Release {
        build_number: build_number(&version)?,
        notes: changelog_section(changelog, &version),
        version,
    })
}

/// `major × 1,000,000 + minor × 1,000 + patch`, as `release.mjs` derives it.
pub fn build_number(version: &str) -> Result<u64, String> {
    let parts: Vec<u64> = version
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<_>>()
        .filter(|parts: &Vec<u64>| parts.len() == 3)
        .ok_or_else(|| format!("\"{version}\" is not a version (major.minor.patch)"))?;
    if parts[1] >= 1000 || parts[2] >= 1000 {
        return Err(format!(
            "{version}: minor and patch must stay below 1000 for the build number"
        ));
    }
    Ok(parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2])
}

/// The body of `## <version>` up to the next `## ` heading, trimmed, like `notesFor`.
pub fn changelog_section(changelog: &str, version: &str) -> Option<String> {
    let mut lines = changelog.lines();
    lines.find(|line| {
        line.strip_prefix("## ")
            .and_then(|rest| rest.strip_prefix(version))
            .is_some_and(|after| after.is_empty() || after.starts_with(' '))
    })?;
    let body: Vec<&str> = lines.take_while(|line| !line.starts_with("## ")).collect();
    Some(body.join("\n").trim().to_string()).filter(|notes| !notes.is_empty())
}

/// `text` cut to at most `limit` characters at a line boundary, so no entry is cut in half. A
/// first line longer than the limit is cut at a character boundary and ends with `…`.
pub fn trim_to_limit(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut kept = String::new();
    for line in text.lines() {
        let candidate = if kept.is_empty() {
            line.to_string()
        } else {
            format!("{kept}\n{line}")
        };
        if candidate.chars().count() > limit {
            break;
        }
        kept = candidate;
    }
    let kept = kept.trim_end().to_string();
    if !kept.is_empty() {
        return kept;
    }
    let mut cut: String = text.chars().take(limit.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHANGELOG: &str = "# Changelog\n\nIntro.\n\n## 0.3.0 - 2026-11-01\n\n### Features\n\n- **web:** a (abc1234)\n\n## 0.2.0 - 2026-10-01\n\n### Fixes\n\n- b (def5678)\n";

    #[test]
    fn reads_the_section_of_one_version_like_release_mjs() {
        assert_eq!(
            changelog_section(CHANGELOG, "0.3.0").as_deref(),
            Some("### Features\n\n- **web:** a (abc1234)")
        );
        assert_eq!(
            changelog_section(CHANGELOG, "0.2.0").as_deref(),
            Some("### Fixes\n\n- b (def5678)")
        );
        // `0.3.0` is not the section of `0.3`, and a version without a section has no notes.
        assert_eq!(changelog_section(CHANGELOG, "0.3"), None);
        assert_eq!(changelog_section(CHANGELOG, "9.9.9"), None);
        assert_eq!(changelog_section("## 1.0.0\n\n", "1.0.0"), None);
    }

    #[test]
    fn derives_the_build_number_like_release_mjs() {
        assert_eq!(build_number("0.1.0"), Ok(1000));
        assert_eq!(build_number("2.3.4"), Ok(2_003_004));
        for bad in ["1.2", "1.2.x", "1..2", "1.2.3.4"] {
            assert!(build_number(bad).unwrap_err().contains("is not a version"));
        }
        assert!(build_number("1.1000.0").unwrap_err().contains("below 1000"));
    }

    #[test]
    fn reads_the_current_release_from_package_json() {
        let release = current_release(r#"{"version": "0.3.0"}"#, CHANGELOG).unwrap();
        assert_eq!(release.version, "0.3.0");
        assert_eq!(release.build_number, 3000);
        assert!(release.notes.unwrap().starts_with("### Features"));
        assert_eq!(
            current_release(r#"{"version": "0.4.0"}"#, CHANGELOG)
                .unwrap()
                .notes,
            None
        );
        assert!(current_release("{", "").unwrap_err().contains("parse"));
        assert!(current_release("{}", "")
            .unwrap_err()
            .contains("no `version`"));
        assert!(current_release(r#"{"version": "x"}"#, "").is_err());
    }

    #[test]
    fn trims_at_a_line_boundary() {
        let text = "### Features\n\n- one\n- two";
        assert_eq!(trim_to_limit(text, 100), text);
        assert_eq!(trim_to_limit(text, 21), "### Features\n\n- one");
        // A cut that would end on the blank line drops it.
        assert_eq!(trim_to_limit(text, 14), "### Features");
        assert_eq!(trim_to_limit("abcdef", 4), "abc…");
        assert_eq!(trim_to_limit("नमस्ते", 3).chars().count(), 3);
    }
}
