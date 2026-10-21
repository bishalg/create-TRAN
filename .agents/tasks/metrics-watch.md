---
name: metrics-watch
summary: Fix one performance or size regression that pnpm metrics reports.
trigger: manual
signal: pnpm metrics
mode: edit
deliverable: pr
scope: [apps/web/, packages/, crates/, docs/LEARNINGS.md]
gates: [pnpm metrics, pnpm test, pnpm typecheck]
max_changed_lines: 150
---

The evidence is the metrics output: each failing line names the metric, its value, and the budget or the previous
record it broke.

1. Pick the failing metric with the biggest user impact: Lighthouse performance and largest contentful paint first,
   then bundle size, then the rest.
2. Find the cause before changing anything. Compare with the last record in `docs/reports/metrics.md`, and look at
   what changed since: `git log --since=<date of that record>`.
3. Fix the cause. Never raise a budget, never edit `docs/reports/`, never record a new baseline.

Put the before and after numbers in the hand-off. If the regression is an intended trade-off, make no change and
explain it so a person can accept it with `pnpm metrics --record --accept`.
