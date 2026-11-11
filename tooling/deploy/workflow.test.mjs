// Verifies: REQ-DEP-004, REQ-DEP-007, REQ-DEP-008
// .github/workflows/deploy.yml and image.yml, read as a parsed job graph (yaml.mjs), not as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { unpinnedActions } from '../supply-chain/supply-chain.mjs';
import { ROOT } from './fake-host.mjs';
import { parseYaml } from './yaml.mjs';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const deployText = read('.github/workflows/deploy.yml');
const deploy = parseYaml(deployText);
const image = parseYaml(read('.github/workflows/image.yml'));
const jobs = deploy.jobs;

/** Every job `name` needs, directly or through other jobs. */
function ancestors(name, graph = jobs) {
  const needs = [graph[name].needs ?? []].flat();
  return new Set(needs.flatMap((need) => [need, ...ancestors(need, graph)]));
}
const steps = (job) => jobs[job].steps ?? [];
const uses = (job, action) => steps(job).filter((s) => s.uses?.startsWith(`${action}@`));
const scripts = (job) => steps(job).map((s) => s.run ?? '');

describe('the image is built once and promoted by digest (REQ-DEP-004)', () => {
  it('REQ-DEP-004 only a tag push builds, once, with an SBOM, provenance and build arguments', () => {
    assert.deepEqual(deploy.on.push, { tags: ['v*'] });
    const builders = Object.keys(jobs).filter(
      (job) => uses(job, 'docker/build-push-action').length
    );
    assert.deepEqual(builders, ['build-image']);
    assert.equal(jobs['build-image'].if, "github.event_name == 'push'");
    const build = uses('build-image', 'docker/build-push-action')[0].with;
    assert.equal(build.file, 'apps/api/Dockerfile');
    assert.equal(build.provenance, 'mode=max');
    assert.equal(build.sbom, true);
    assert.match(build['build-args'], /^VERSION=\$\{\{ steps\.names\.outputs\.version \}\}$/m);
    assert.match(build['build-args'], /^COMMIT=\$\{\{ github\.sha \}\}$/m);
    assert.deepEqual(ancestors('build-image'), new Set(['image-smoke']));
  });

  it('REQ-DEP-004 staging deploys the full reference by digest the build published', () => {
    assert.deepEqual(ancestors('deploy-staging'), new Set(['build-image', 'image-smoke']));
    const reference = steps('build-image').find((s) => s.id === 'reference');
    assert.match(reference.run, /image=\$NAME@\$DIGEST/);
    assert.match(reference.run, /\^sha256:\[0-9a-f\]\{64\}\$/);
    assert.equal(jobs['build-image'].outputs.image, '${{ steps.reference.outputs.image }}');
    const step = steps('deploy-staging').find((s) => s.run?.includes('deploy/remote.sh'));
    assert.equal(step.env.IMAGE, '${{ needs.build-image.outputs.image }}');
    assert.equal(step.run, 'bash deploy/remote.sh staging "$IMAGE"');
  });

  it('REQ-DEP-004 production depends on no build and deploys the given digest from the registry', () => {
    assert.equal(jobs['deploy-production'].needs, undefined);
    assert.deepEqual(ancestors('deploy-production'), new Set());
    const input = deploy.on.workflow_dispatch.inputs.image_digest;
    assert.equal(input.required, true);
    const [check, , run] = steps('deploy-production');
    assert.equal(check.env.DIGEST, '${{ inputs.image_digest }}');
    assert.match(check.run, /\^sha256:\[0-9a-f\]\{64\}\$/);
    assert.equal(run.run, 'bash deploy/remote.sh production "ghcr.io/${REPOSITORY,,}/api@$DIGEST"');
  });

  it('REQ-DEP-004 publishing and deploying are switched by configuration, with a notice when off', () => {
    const login = uses('build-image', 'docker/login-action')[0];
    assert.equal(login.if, "vars.DEPLOY_ENABLED == 'true'");
    assert.equal(
      uses('build-image', 'docker/build-push-action')[0].with.push,
      "${{ vars.DEPLOY_ENABLED == 'true' }}"
    );
    for (const job of ['deploy-staging', 'deploy-production'])
      assert.match(jobs[job].if, /&& vars\.DEPLOY_ENABLED == 'true'$/, job);
    assert.equal(jobs['deploy-off'].if, "vars.DEPLOY_ENABLED != 'true'");
    assert.match(
      scripts('deploy-off')[0],
      /::notice::.*TODO\(credentials\): DEPLOY_ENABLED, DEPLOY_HOST/
    );
  });
});

describe('production deploys are deliberate and gated (REQ-DEP-008)', () => {
  it('REQ-DEP-008 never on a pull request; production only by dispatch, in its environment', () => {
    assert.deepEqual(Object.keys(deploy.on).sort(), ['push', 'workflow_dispatch']);
    assert.equal(
      jobs['deploy-production'].if.startsWith("github.event_name == 'workflow_dispatch'"),
      true
    );
    assert.equal(jobs['deploy-production'].environment, 'production');
    assert.equal(jobs['deploy-staging'].environment, 'staging');
  });

  it('REQ-DEP-008 one deploy per environment at a time, never cancelled half way', () => {
    for (const [job, group] of [
      ['deploy-staging', 'deploy-staging'],
      ['deploy-production', 'deploy-production'],
    ])
      assert.deepEqual(jobs[job].concurrency, { group, 'cancel-in-progress': false });
  });

  it('REQ-DEP-008 least privilege: nothing at workflow level, packages: write only for the build', () => {
    assert.deepEqual(deploy.permissions, {});
    for (const [name, job] of Object.entries(jobs)) {
      const permissions = job.permissions ?? {};
      assert.ok(!('id-token' in permissions), name);
      if (name !== 'build-image') assert.notEqual(permissions.packages, 'write', name);
    }
    assert.deepEqual(jobs['build-image'].permissions, { contents: 'read', packages: 'write' });
  });

  it('REQ-DEP-008 credentials come from the environment, through env:, never expanded in a script', () => {
    for (const job of Object.keys(jobs))
      for (const script of scripts(job))
        assert.doesNotMatch(script, /\$\{\{/, `${job} expands an expression inside run:`);
    for (const job of ['deploy-staging', 'deploy-production']) {
      const env = steps(job).find((s) => s.run?.includes('deploy/remote.sh')).env;
      assert.equal(env.DEPLOY_SSH_KEY, '${{ secrets.DEPLOY_SSH_KEY }}');
      assert.equal(env.DEPLOY_HOST, '${{ vars.DEPLOY_HOST }}');
      assert.equal(env.DEPLOY_KNOWN_HOSTS, '${{ vars.DEPLOY_KNOWN_HOSTS }}');
    }
  });

  it('REQ-DEP-008 every action is pinned to a commit with a version comment', () => {
    assert.deepEqual(unpinnedActions(deployText), []);
    assert.deepEqual(unpinnedActions(read('.github/workflows/image.yml')), []);
  });
});

describe('the image smoke runs in CI (REQ-DEP-007)', () => {
  it('REQ-DEP-007 image.yml runs the deploy checks and the smoke, on changes and before every build', () => {
    assert.ok('workflow_call' in image.on);
    assert.ok(image.on.pull_request.paths.includes('apps/api/**'));
    assert.ok(image.on.pull_request.paths.includes('.dockerignore'));
    const runs = image.jobs.image.steps.map((s) => s.run).filter(Boolean);
    assert.ok(runs.includes('pnpm run deploy:check'));
    assert.ok(runs.includes('pnpm run deploy:smoke'));
    assert.equal(jobs['image-smoke'].uses, './.github/workflows/image.yml');
  });

  it('REQ-DEP-007 deploy:smoke has its own config, not the one that boots the web and cargo run', () => {
    const scriptsOf = JSON.parse(read('package.json')).scripts;
    assert.equal(
      scriptsOf['deploy:smoke'],
      'pnpm --filter e2e exec playwright test -c playwright.image.config.ts'
    );
    const config = read('e2e/playwright.image.config.ts');
    assert.doesNotMatch(config, /webServer/);
    assert.match(read('e2e/playwright.metrics.config.ts'), /testIgnore: 'image\.spec\.ts'/);
  });
});
