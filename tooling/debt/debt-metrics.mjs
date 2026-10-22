/**
 * Metrics for the create-TRAN debt ratchet (T3):
 * Counts `as unknown as`, `eslint-disable`, `#[allow(`.
 */
export function measureDebt(content) {
  const asUnknownAs = (content.match(/as\s+unknown\s+as/g) ?? []).length;
  const eslintDisable = (content.match(/eslint-disable/g) ?? []).length;
  const allowAttr = (content.match(/#\[allow\(/g) ?? []).length;

  const counts = {};
  if (asUnknownAs > 0) counts.asUnknownAs = asUnknownAs;
  if (eslintDisable > 0) counts.eslintDisable = eslintDisable;
  if (allowAttr > 0) counts.allowAttr = allowAttr;

  return counts;
}
