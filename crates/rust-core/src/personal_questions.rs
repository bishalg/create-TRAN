//! Personal questions as data: optional, inclusive, and asked only for a named feature (spec 026,
//! REQ-PRV-008, ADR-0043).
//!
//! A personal question asks about the person (gender, birth date, name) rather than about the task.
//! Each one names the feature that needs it, offers "Prefer not to say" and is skippable unless
//! `required` cites the requirement that makes it necessary. The onboarding phase renders them;
//! TypeScript receives the catalogue through `pnpm tokens:sync`, native code through UniFFI, and
//! `fixtures/permissions.json` pins it on every platform.
//!
//! Verifies: REQ-PRV-008

use serde::Serialize;

/// What an answer means, so the invariants can be checked without reading its copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerKind {
    /// One of the listed choices.
    Choice,
    /// The person describes it in their own words.
    SelfDescribed,
    /// The person declines; stored as "no answer", never as a choice.
    PreferNotToSay,
}

impl AnswerKind {
    pub const ALL: [Self; 3] = [Self::Choice, Self::SelfDescribed, Self::PreferNotToSay];

    /// Stable snake_case name, matching `fixtures/permissions.json`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Choice => "choice",
            Self::SelfDescribed => "self_described",
            Self::PreferNotToSay => "prefer_not_to_say",
        }
    }
}

/// One answer a question offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Answer {
    /// Stable snake_case id, what the app stores.
    pub id: &'static str,
    pub kind: AnswerKind,
    /// Locale key of the answer's label.
    pub label: &'static str,
}

/// One personal question (REQ-PRV-008).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PersonalQuestion {
    /// Stable snake_case id.
    pub id: &'static str,
    /// Stable snake_case name of the feature that needs the answer.
    pub feature: &'static str,
    /// Locale key of the question's label.
    pub label: &'static str,
    pub answers: &'static [Answer],
    /// The requirement id that makes an answer necessary; `None` means the question is skippable.
    pub required: Option<&'static str>,
}

impl PersonalQuestion {
    /// Whether the person may go on without answering.
    pub fn is_skippable(&self) -> bool {
        self.required.is_none()
    }

    /// Every locale key the question names: its label, then each answer's.
    pub fn locale_keys(&self) -> Vec<&'static str> {
        std::iter::once(self.label)
            .chain(self.answers.iter().map(|answer| answer.label))
            .collect()
    }

    /// How many answers of `kind` it offers.
    pub fn count(&self, kind: AnswerKind) -> usize {
        self.answers.iter().filter(|a| a.kind == kind).count()
    }
}

/// Every question shares this answer, so its id and copy are the same everywhere.
pub const PREFER_NOT_TO_SAY: Answer = Answer {
    id: "prefer_not_to_say",
    kind: AnswerKind::PreferNotToSay,
    label: "common.preferNotToSay",
};

/// Gender: never two choices, always a self-described answer, never required.
pub const GENDER: PersonalQuestion = PersonalQuestion {
    id: "gender",
    feature: "profile",
    label: "common.gender.label",
    answers: &[
        Answer {
            id: "woman",
            kind: AnswerKind::Choice,
            label: "common.gender.woman",
        },
        Answer {
            id: "man",
            kind: AnswerKind::Choice,
            label: "common.gender.man",
        },
        Answer {
            id: "non_binary",
            kind: AnswerKind::Choice,
            label: "common.gender.nonBinary",
        },
        Answer {
            id: "self_described",
            kind: AnswerKind::SelfDescribed,
            label: "common.gender.selfDescribed",
        },
        PREFER_NOT_TO_SAY,
    ],
    required: None,
};

/// Every personal question the apps may ask.
pub const PERSONAL_QUESTIONS: [PersonalQuestion; 1] = [GENDER];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{missing_in_locales, spec_requirement_ids};
    use std::collections::BTreeSet;

    /// The rule REQ-PRV-008 sets for every question; `known` are the spec's requirement ids.
    fn violations(question: &PersonalQuestion, known: &BTreeSet<String>) -> Vec<String> {
        let mut out = Vec::new();
        if question.count(AnswerKind::PreferNotToSay) != 1 {
            out.push(format!(
                "`{}` must offer \"Prefer not to say\" once",
                question.id
            ));
        }
        if let Some(id) = question.required {
            if !known.contains(id) {
                out.push(format!(
                    "`{}` is required by `{id}`, no spec's",
                    question.id
                ));
            }
        }
        if question.id == "gender"
            && (question.count(AnswerKind::SelfDescribed) == 0
                || question.count(AnswerKind::Choice) <= 2)
        {
            out.push(format!(
                "`{}` needs a self-described answer and more than two choices",
                question.id
            ));
        }
        let mut ids = BTreeSet::new();
        for answer in question.answers {
            if !ids.insert(answer.id) {
                out.push(format!("`{}` offers `{}` twice", question.id, answer.id));
            }
        }
        out
    }

    #[test]
    fn every_question_keeps_the_rule() {
        // Verifies: REQ-PRV-008
        let known = spec_requirement_ids();
        let mut ids = BTreeSet::new();
        for question in PERSONAL_QUESTIONS {
            assert!(ids.insert(question.id), "`{}` twice", question.id);
            assert_eq!(violations(&question, &known), Vec::<String>::new());
            assert!(question.is_skippable());
            assert!(!question.feature.is_empty());
        }
    }

    #[test]
    fn a_required_question_must_cite_a_spec_requirement() {
        // Verifies: REQ-PRV-008
        let known = spec_requirement_ids();
        // Built at run time, so `pnpm spec:check` does not read it as a citation.
        let invented = format!("REQ-{}-999", "NOPE");
        let invented: &'static str = Box::leak(invented.into_boxed_str());
        let uncited = PersonalQuestion {
            required: Some(invented),
            ..GENDER
        };
        assert!(!uncited.is_skippable());
        assert_eq!(violations(&uncited, &known).len(), 1);
        let cited = PersonalQuestion {
            required: Some("REQ-PRV-008"),
            ..GENDER
        };
        assert!(violations(&cited, &known).is_empty());
    }

    #[test]
    fn a_question_without_prefer_not_to_say_or_a_binary_gender_is_rejected() {
        // Verifies: REQ-PRV-008
        let known = spec_requirement_ids();
        let no_opt_out = PersonalQuestion {
            answers: &GENDER.answers[..4],
            ..GENDER
        };
        assert_eq!(violations(&no_opt_out, &known).len(), 1);
        const BINARY: &[Answer] = &[GENDER.answers[0], GENDER.answers[1], PREFER_NOT_TO_SAY];
        let binary = PersonalQuestion {
            answers: BINARY,
            ..GENDER
        };
        assert_eq!(violations(&binary, &known).len(), 1);
        let twice = PersonalQuestion {
            id: "other",
            answers: &[PREFER_NOT_TO_SAY, PREFER_NOT_TO_SAY],
            ..GENDER
        };
        assert_eq!(violations(&twice, &known).len(), 2);
    }

    #[test]
    fn the_gender_question_is_inclusive() {
        // Verifies: REQ-PRV-008
        let ids: Vec<&str> = GENDER.answers.iter().map(|a| a.id).collect();
        assert_eq!(
            ids,
            [
                "woman",
                "man",
                "non_binary",
                "self_described",
                "prefer_not_to_say"
            ]
        );
        assert_eq!(GENDER.count(AnswerKind::Choice), 3);
    }

    #[test]
    fn every_key_exists_in_every_locale() {
        // Verifies: REQ-PRV-008
        for question in PERSONAL_QUESTIONS {
            let missing = missing_in_locales(question.locale_keys());
            assert!(missing.is_empty(), "{}: {missing:?}", question.id);
        }
        assert_eq!(missing_in_locales(["common.gender.nope"]).len(), 3);
    }

    #[test]
    fn answer_kinds_are_snake_case() {
        // Verifies: REQ-PRV-008
        for kind in AnswerKind::ALL {
            assert_eq!(serde_json::to_value(kind).unwrap(), kind.as_str());
        }
        assert_eq!(
            AnswerKind::ALL.map(AnswerKind::as_str),
            ["choice", "self_described", "prefer_not_to_say"]
        );
    }
}
