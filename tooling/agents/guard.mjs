/** The guard (REQ-AGT-007): whether a change stays inside its task's scope, policy and line budget. */

/** `dir/` is a prefix, `**\/x` matches at any depth, `*` stays inside one path segment. */
export function globToRegExp(pattern) {
  const prefix = pattern.endsWith('/');
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${source}${prefix ? '' : '$'}`);
}
export const matchesAny = (path, patterns) =>
  patterns.some((pattern) => globToRegExp(pattern).test(path));

/** `changes`: [{ path, lines }]. Returns the problems; empty means the change may be kept. */
export function guardChanges(changes, task, policy) {
  const d = task.data;
  if (d.mode === 'read-only')
    return changes.length
      ? [`a read-only task changed files: ${changes.map((c) => c.path).join(', ')}`]
      : [];
  const errors = [];
  for (const { path } of changes) {
    if (!matchesAny(path, d.scope ?? []))
      errors.push(`${path}: outside the task's scope (${(d.scope ?? []).join(', ')})`);
    if (matchesAny(path, policy.protected) && !matchesAny(path, d.allow ?? []))
      errors.push(`${path}: protected by .agents/policy.json`);
  }
  const lines = changes.reduce((sum, change) => sum + change.lines, 0);
  const budget = d.max_changed_lines ?? policy.maxChangedLines;
  if (lines > budget) errors.push(`${lines} changed lines, over the budget of ${budget}`);
  return errors;
}

/** `git diff --numstat` lines plus untracked files; binary files count as one line. */
export function parseNumstat(numstat) {
  return numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...path] = line.split('\t');
      const count = (n) => (n === '-' ? 0 : Number(n));
      return { path: path.join('\t'), lines: Math.max(1, count(added) + count(removed)) };
    });
}
