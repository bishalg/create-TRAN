# Release tooling only (spec 025, ADR-0042): development, tests and CI gates do not need Ruby.
# Run lanes through `bundle exec` (`pnpm ios:lane <lane>`, `pnpm android:lane <lane>`) so the version in
# Gemfile.lock is the one that runs; Dependabot bumps it (REQ-MOB-001).
source "https://rubygems.org"

gem "fastlane", "~> 2.241"
