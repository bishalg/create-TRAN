//! Identifier folding shared by every target: one dictionary key, one name per platform.

/// `sepia` → `Sepia`, `high-contrast` → `HighContrast`.
pub fn pascal_case(mode: &str) -> String {
    mode.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            let first = chars
                .next()
                .unwrap_or_default()
                .to_uppercase()
                .collect::<String>();
            first + chars.as_str()
        })
        .collect()
}

pub fn full_key(module: &str, relative: &str) -> String {
    format!("{module}.{relative}")
}

/// `welcome.title` → `welcomeTitle`; the member name shared by the Swift and Kotlin accessors.
pub fn member_name(relative: &str) -> String {
    let mut out = String::new();
    for (index, part) in relative.split('.').enumerate() {
        if index == 0 {
            out.push_str(part);
        } else {
            out.push_str(&pascal_case(part));
        }
    }
    out
}

/// `native.checkOffline` → `native_check_offline` (Android resource names are lowercase snake_case).
pub fn android_resource_name(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 8);
    for character in key.chars() {
        match character {
            '.' => out.push('_'),
            'A'..='Z' => {
                out.push('_');
                out.push(character.to_ascii_lowercase());
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pascal_case_joins_words_and_drops_separators() {
        assert_eq!(pascal_case("sepia"), "Sepia");
        assert_eq!(pascal_case("high-contrast"), "HighContrast");
        assert_eq!(pascal_case("--a__b"), "AB");
        assert_eq!(pascal_case(""), "");
    }

    #[test]
    fn member_names_fold_paths_to_camel_case() {
        assert_eq!(member_name("welcome.title"), "welcomeTitle");
        assert_eq!(member_name("table.countryCode"), "tableCountryCode");
        assert_eq!(member_name("theme.light"), "themeLight");
        assert_eq!(member_name("title"), "title");
    }

    #[test]
    fn android_resource_names_are_lowercase_snake_case() {
        assert_eq!(
            android_resource_name("eligibility.age.label"),
            "eligibility_age_label"
        );
        assert_eq!(
            android_resource_name("shell.theme.sepia"),
            "shell_theme_sepia"
        );
        assert_eq!(android_resource_name("common.appName"), "common_app_name");
        assert_eq!(full_key("common", "appName"), "common.appName");
    }
}
