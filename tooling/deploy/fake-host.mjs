/**
 * A fake host for the deploy script tests: `docker`, `curl`, `sleep` and `ssh` executables first on
 * PATH that record every call (with the slot image variables) and can be told to fail, so the real
 * Compose branch of scripts/deploy.sh and deploy/remote.sh runs without Docker, a network or a host.
 *
 * - FAKE_FAIL="<words>": docker or ssh exits 1 when its arguments contain those words
 * - FAKE_READY=now | never | after:<n>: curl succeeds at once, never, or after n failures
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEPLOY = join(ROOT, 'scripts/deploy.sh');
export const REMOTE = join(ROOT, 'deploy/remote.sh');
export const COMPOSE = `compose --project-name tran-staging --file ${join(ROOT, 'deploy/compose.yaml')}`;

/** A full image reference by digest; `n` picks a distinct digest. */
export const image = (n) => `ghcr.io/acme/tran/api@sha256:${String(n).repeat(64).slice(0, 64)}`;

const FAILS = `if [[ -n "\${FAKE_FAIL:-}" && " $* " == *" $FAKE_FAIL "* ]]; then exit 1; fi`;

const TOOLS = {
  docker: `printf 'docker\\t%s\\t%s\\t%s\\n' "\${API_BLUE_IMAGE:-}" "\${API_GREEN_IMAGE:-}" "$*" >>"$FAKE_LOG"
${FAILS}
exit 0`,
  curl: `printf 'curl\\t\\t\\t%s\\n' "\${*: -1}" >>"$FAKE_LOG"
count=$(( $(cat "$FAKE_DIR/curl.count" 2>/dev/null || echo 0) + 1 ))
echo "$count" >"$FAKE_DIR/curl.count"
case "\${FAKE_READY:-now}" in
  now) exit 0 ;;
  never) exit 22 ;;
  after:*) if (( count > \${FAKE_READY#after:} )); then exit 0; else exit 22; fi ;;
esac`,
  sleep: `printf 'sleep\\t\\t\\t%s\\n' "$*" >>"$FAKE_LOG"`,
  ssh: `call=$(( $(wc -l <"$FAKE_LOG") + 1 ))
cat >"$FAKE_DIR/ssh.stdin.$call"
printf 'ssh\\t%s\\t\\t%s\\n' "$call" "$*" >>"$FAKE_LOG"
${FAILS}
exit 0`,
};

let sharedBin = '';
/**
 * The fake executables, written once per process: macOS scans a new executable on its first run,
 * which made a fresh copy per test slow. They keep no state; each host passes its own log and folder.
 */
function fakeBin() {
  if (sharedBin) return sharedBin;
  sharedBin = mkdtempSync(join(tmpdir(), 'tran-deploy-bin-'));
  for (const [name, body] of Object.entries(TOOLS)) {
    writeFileSync(join(sharedBin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(sharedBin, name), 0o755);
  }
  process.on('exit', () => rmSync(sharedBin, { recursive: true, force: true }));
  return sharedBin;
}

/** A fresh fake host; `cleanup()` removes it. */
export function fakeHost() {
  const dir = mkdtempSync(join(tmpdir(), 'tran-deploy-'));
  const bin = fakeBin();
  const log = join(dir, 'calls.log');
  const state = join(dir, 'state');
  mkdirSync(join(state, 'staging'), { recursive: true });
  writeFileSync(join(state, 'staging/app.env'), 'APP_ENV=staging\n');

  const env = (extra) => ({
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    FAKE_LOG: log,
    FAKE_DIR: dir,
    DEPLOY_STATE_DIR: state,
    DEPLOY_READY_INTERVAL: '1',
    DEPLOY_READY_TIMEOUT: '3',
    ...extra,
  });

  return {
    dir,
    state,
    /** Runs `script` with `args`; returns `{ status, out, calls }` for this run only. */
    run(script, args, extra = {}) {
      writeFileSync(log, '');
      rmSync(join(dir, 'curl.count'), { force: true });
      const result = spawnSync('bash', [script, ...args], { env: env(extra), encoding: 'utf8' });
      return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        calls: readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [tool, blue, green, args] = line.split('\t');
            return { tool, blue, green, args };
          }),
      };
    },
    /** What an ssh call received on stdin (its number is recorded in the `blue` column). */
    stdin: (call) => readFileSync(join(dir, `ssh.stdin.${call.blue}`)),
    read(path) {
      try {
        return readFileSync(join(state, path), 'utf8').trim();
      } catch {
        return null;
      }
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The Compose sub-command of a recorded docker call, without the project and file flags. */
export function composeCommand(call) {
  if (call.tool !== 'docker') return `${call.tool} ${call.args}`;
  if (!call.args.startsWith(`${COMPOSE} `))
    throw new Error(`not the staging compose: ${call.args}`);
  return call.args.slice(COMPOSE.length + 1);
}
