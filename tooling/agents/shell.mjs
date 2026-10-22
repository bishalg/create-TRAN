/** Process helpers the signals, the runner and the CLI share: shell commands, git, JSON files. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const sh = (root, command, env = {}) => {
  const result = spawnSync('sh', ['-c', command], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};
export const readJson = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;

export function defaultBranch(root) {
  const head = sh(root, 'git symbolic-ref --short refs/remotes/origin/HEAD');
  return head.status === 0 ? head.output.trim() : 'origin/main';
}

export function git(root, args, input) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}
