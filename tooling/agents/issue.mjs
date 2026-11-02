/**
 * The issue orchestrator (spec 020, ADR-0037 D4): one GitHub event in, one stage out. It parses
 * the event, reads the state back from labels and the runner's own markers, and runs the stage the
 * event calls for: the quality gate on `opened` and `edited` (then a plan, or under
 * `autonomy.simple: auto` the implementation), and on a comment the command it carries: `/plan`,
 * `/approve`, `/implement`; `/review` and `/screenshots` reply that they are not available yet.
 * Model stages go through `runTask`, so there is one run path, not two.
 *
 * GitHub access goes through the injected client `gh` (github.mjs); `gh` is null in a dry run,
 * which then writes the decision and the prompt but calls nothing.
 */
import {
  canCommand,
  implementationExtras,
  issueBranch,
  issuePrefix,
  planHash,
  renderPlanComment,
  selectPlan,
} from './issue-commands.mjs';
import {
  applyTriageLabel,
  byRunner,
  mergeVerdicts,
  parseJudgment,
  renderGateComment,
  rewriteSkeleton,
  setStatusLabel,
  sizeClass,
  structuralVerdict,
  templateHints,
  templateSections,
  upsertStageComment,
} from './issue-gate.mjs';
import {
  issueSettings,
  labelNames,
  parseIssueEvent,
  parseMarker,
  renderIssueEvidence,
  renderMarker,
  skipReason,
} from './issue-event.mjs';
import { runTask } from './run.mjs';
import { outDir } from './tasks.mjs';

export const GATE_TASK = 'issue-gate';
export const ISSUE_TASK = 'issue';
export const DECISION = `${outDir(GATE_TASK)}/decision.json`;
/** Roles that count as a collaborator for `issues.modelFor: collaborators` (REQ-ISS-022). */
export const TRIAGE_ACCESS = ['admin', 'maintain', 'write', 'triage'];

const harnessNote = (harness) =>
  harness === 'fake' ? ' (fake harness: canned output, no model ran)' : '';
const footer = (harness) => `_Runner · harness: ${harness}${harnessNote(harness)}_`;
const CREDENTIAL =
  'needs a harness credential (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, or the variable `AGENT_HARNESS=fake`); nothing was done.';
const withoutMarker = (body) => body.replace(/^\s*<!-- tran-agent .*? -->\n?/, '').trim();

/**
 * One event (REQ-ISS-001). `opts`: { policy, harness, tasks, taskNames, template, dryRun,
 * modelStages ('skip' without a credential), harnessOptions }. `io`: `liveIo` or a fake; `gh`:
 * the GitHub client, or null in a dry run. Returns { outcome, message, decision? } where outcome is
 * nothing | gated | replied | planned | implemented | no-change | dry-run | failed.
 */
export function runIssue(payload, opts, io, gh) {
  let event;
  try {
    event = parseIssueEvent(payload);
  } catch (error) {
    return { outcome: 'failed', message: error.message };
  }
  const nothing = (why) => ({
    outcome: 'nothing',
    message: `issue #${event.number}: nothing to do: ${why}`,
  });
  const skip = skipReason(event, opts.policy);
  if (skip) return nothing(skip);
  // A comment on a pull request arrives as an issue comment; its stages come later (WP5, WP6).
  if (event.isPullRequest) return nothing('a pull request comment');
  if (!['commented', 'opened', 'edited'].includes(event.kind))
    return nothing(`"${event.kind}" starts no stage`);

  const live = gh && !opts.dryRun ? gh : null;
  if (event.kind === 'commented' && !live)
    return {
      outcome: 'dry-run',
      message: `issue #${event.number}: dry run: /${event.command} by @${event.comment.author.login} needs GitHub for the permission check; nothing was done`,
    };
  const ctx = { event, payload, opts, io, gh: live, comments: [], runner: null };
  try {
    return event.kind === 'commented' ? command(ctx) : gate(ctx);
  } catch (error) {
    if (live) {
      // Best effort: the original error matters more than a second one from GitHub.
      try {
        setStatusLabel(live, event.number, 'failed', true, opts.policy);
        setStatusLabel(live, event.number, 'running', false, opts.policy);
      } catch {}
    }
    throw error;
  }
}

// ── State helpers ───────────────────────────────────────────────────────────────────────────────

/** Reads the comments and the runner's identity once per event (REQ-ISS-020, REQ-ISS-024). */
function load(ctx) {
  const { gh, event } = ctx;
  ctx.runner = gh.whoami();
  ctx.comments = gh.listComments(event.number);
  if (event.comment && !ctx.comments.some((c) => c.id === event.comment.id))
    ctx.comments.push(event.comment);
}

/** One comment per stage, updated in place; the cached listing follows, so a second write edits. */
function upsert(ctx, stage, body, data = {}) {
  const { gh, event, runner } = ctx;
  const result = upsertStageComment(gh, event.number, stage, body, data, ctx.comments, runner);
  const text = `${renderMarker({ stage, ...data })}\n${body}`;
  const cached = ctx.comments.find((c) => c.id === result.id);
  if (cached) cached.body = text;
  else ctx.comments.push({ id: result.id, body: text, author: { login: runner }, url: result.url });
  return result;
}

/** The runner's newest comment for `stage`, or null; never anyone else's (REQ-ISS-024). */
const ownStage = (ctx, stage) =>
  byRunner(ctx.comments, ctx.runner)
    .filter((c) => parseMarker(c.body)?.stage === stage)
    .at(-1) ?? null;

/** The issue and the people's comments as untrusted evidence: the runner's own are state. */
function evidence(ctx, task) {
  const { event, opts } = ctx;
  const people = ctx.comments.filter((c) => c.author?.login !== ctx.runner);
  const maxLines = task.data.evidence_lines ?? opts.policy.evidenceMaxLines;
  return renderIssueEvidence(event, people, { maxLines });
}

function taskNamed(opts, name) {
  const task = opts.tasks.find((t) => t.data.name === name);
  if (!task) throw new Error(`no task "${name}" in .agents/tasks/`);
  return task;
}

/** The read-only `issue-gate` task over the issue: the judgment, or a plan for `/plan`. */
function runGateTask(ctx) {
  const { event, opts, io, gh } = ctx;
  const task = taskNamed(opts, GATE_TASK);
  const text = evidence(ctx, task);
  if (gh) setStatusLabel(gh, event.number, 'running', true, opts.policy);
  return runTask(
    task,
    {
      harness: opts.harness,
      policy: opts.policy,
      dryRun: opts.dryRun,
      publish: false,
      taskNames: opts.taskNames,
      harnessOptions: opts.harnessOptions,
    },
    { ...io, runSignal: () => ({ status: 1, output: text, untrusted: true }) }
  );
}

// ── Commands (REQ-ISS-004) ──────────────────────────────────────────────────────────────────────

/** A one-line answer to a command, in the `ignored` comment (one per issue, updated in place). */
function reply(ctx, text) {
  const { event, opts } = ctx;
  upsert(ctx, 'ignored', `${text}\n\n${footer(opts.harness)}`, { command: event.command });
  return { outcome: 'replied', message: `issue #${event.number}: ${text}` };
}

/** The command on the comment's first line, acted on only for write access (REQ-ISS-004). */
function command(ctx) {
  const { event, gh } = ctx;
  load(ctx);
  const roles = new Map();
  ctx.permissionOf = (login) => {
    if (!roles.has(login)) roles.set(login, gh.permission(login));
    return roles.get(login);
  };
  const login = event.comment.author.login;
  const role = ctx.permissionOf(login);
  if (!canCommand(role))
    return reply(
      ctx,
      `ignored: \`/${event.command}\` needs write access; @${login} has ${role}. Nothing was done.`
    );
  switch (event.command) {
    case 'plan':
      return planCommand(ctx);
    case 'approve':
      return approve(ctx, null);
    case 'implement':
      return implementCommand(ctx);
    default:
      return reply(
        ctx,
        `\`/${event.command}\` is not available yet in this runner; nothing was done.`
      );
  }
}

/** `/plan`: the read-only task writes a plan; it becomes the `plan` comment (REQ-ISS-008). */
function planCommand(ctx) {
  const { event, opts, gh } = ctx;
  if (opts.modelStages === 'skip') return reply(ctx, `\`/plan\` ${CREDENTIAL}`);
  const result = runGateTask(ctx);
  const failed = (why) => {
    setStatusLabel(gh, event.number, 'failed', true, opts.policy);
    setStatusLabel(gh, event.number, 'running', false, opts.policy);
    return {
      ...reply(ctx, `\`/plan\` failed: ${why}. Comment \`/plan\` to try again.`),
      outcome: 'failed',
    };
  };
  if (result.outcome !== 'reported') return failed(result.message.split('\n')[0]);
  const judged = parseJudgment(result.report);
  if (!judged.plan) return failed("the model's report had no `PLAN:` block");
  postPlan(ctx, judged.plan);
  // A plan that needs a product or architecture decision waits for a person (REQ-ISS-013).
  const role =
    judged.verdict === 'human-decision-needed' ? 'human-decision-needed' : 'approval-needed';
  applyTriageLabel(gh, event.number, role, opts.policy);
  setStatusLabel(gh, event.number, 'failed', false, opts.policy);
  setStatusLabel(gh, event.number, 'running', false, opts.policy);
  return {
    outcome: 'planned',
    message: `issue #${event.number}: plan posted; labelled ${labelNames(opts.policy)[role]}`,
  };
}

function postPlan(ctx, plan) {
  const { harness } = ctx.opts;
  return upsert(ctx, 'plan', renderPlanComment({ plan, harness }), { harness });
}

/** `/implement`: `/approve` for a simple issue, with the gate's summary as the plan. */
function implementCommand(ctx) {
  const gateComment = ownStage(ctx, 'gate');
  const marker = gateComment && parseMarker(gateComment.body);
  if (marker?.verdict !== 'ready')
    return reply(
      ctx,
      '`/implement` needs an issue that passed the check: edit the issue so the check runs, then try again.'
    );
  if (marker.size !== 'simple')
    return reply(
      ctx,
      `\`/implement\` is for simple issues and this one is ${marker.size ?? 'not sized'}: approve its plan with \`/approve\`.`
    );
  return approve(ctx, {
    text: withoutMarker(gateComment.body),
    comment: gateComment,
    source: 'the issue check (`/implement`, no plan)',
  });
}

function planSource(chosen, ctx) {
  if (chosen.source) return chosen.source;
  if (chosen.comment.author?.login === ctx.runner) return 'the plan above';
  if (chosen.comment.id === ctx.event.comment.id) return 'the `/approve` comment';
  return `@${chosen.comment.author?.login}'s comment ${chosen.comment.url ?? ''}`.trim();
}

/**
 * `/approve` (or `/implement` with `chosen`): one pull request per issue (REQ-ISS-009), the newest
 * plan-bearing comment as the plan (REQ-ISS-021), its hash and approver in the `plan` marker.
 */
function approve(ctx, chosen) {
  const { event, opts, gh } = ctx;
  const prefix = issuePrefix(opts.policy.branchPrefix, event.number);
  const open = gh.listOpenPrs().filter((pr) => pr.headRefName?.startsWith(prefix));
  if (open.length)
    return reply(
      ctx,
      `already open: ${open.map((pr) => pr.url).join(', ')}; CI fix attempts are automatic (REQ-ISS-015)`
    );
  const plan = chosen ?? selectPlan(ctx.comments, event.comment.id, ctx.permissionOf, ctx.runner);
  if (!plan)
    return reply(
      ctx,
      'nothing to approve: no plan yet; comment `/plan` for one, or write a `## Plan` section of your own.'
    );
  if (opts.modelStages === 'skip') return reply(ctx, `\`/${event.command}\` ${CREDENTIAL}`);
  const by = event.comment.author.login;
  const approval = {
    by,
    url: event.comment.url,
    hash: planHash(plan.text),
    source: planSource(plan, ctx),
  };
  const record = (result) =>
    upsert(
      ctx,
      'plan',
      renderPlanComment({ plan: plan.text, harness: opts.harness, approval, result }),
      { harness: opts.harness, plan: approval.hash, approvedBy: by }
    );
  record(null);
  return implement(ctx, plan.text, record);
}

// ── Implementation (REQ-ISS-009, REQ-ISS-010) ───────────────────────────────────────────────────

/** Push, then update the branch's open pull request or open a draft one: never two (REQ-ISS-009). */
function publishPr(gh, base, { branch, title, body }) {
  gh.pushBranch(branch);
  const open = gh.listOpenPrs().find((pr) => pr.headRefName === branch);
  return open
    ? gh.updatePr(open.number, { title, body }).url
    : gh.createPr({ head: branch, base, title, body, draft: true }).url;
}

/**
 * The `issue` edit task on `agent/issue-<n>-<slug>`, from the default branch (in Actions a comment
 * event may start detached, and the pull request needs a branch as its base). `record(result)`
 * writes the outcome into the `plan` comment; null when there is none (`autonomy.simple: auto`).
 */
function implement(ctx, plan, record, note) {
  const { event, payload, opts, io, gh } = ctx;
  const { policy, harness } = opts;
  const task = taskNamed(opts, ISSUE_TASK);
  const settings = issueSettings(policy);
  const base = payload.repository?.default_branch || io.currentBranch();
  io.useBranch(base);
  const text = evidence(ctx, task);
  setStatusLabel(gh, event.number, 'running', true, policy);
  let url = null;
  const result = runTask(
    task,
    {
      harness,
      policy,
      publish: true,
      taskNames: opts.taskNames,
      harnessOptions: opts.harnessOptions,
      branch: issueBranch(policy.branchPrefix, event.number, event.title),
      prMatch: issuePrefix(policy.branchPrefix, event.number),
      extraEvidence: implementationExtras({
        plan,
        note,
        specFirst: io.exists('docs/specs'),
        requireTests: settings.requireTests,
      }),
      requireTests: settings.requireTests,
      closes: event.number,
    },
    {
      ...io,
      runSignal: () => ({ status: 1, output: text, untrusted: true }),
      openPrs: () => gh.listOpenPrs(),
      publish: (pr) => (url = publishPr(gh, base, pr)),
    }
  );
  const first = result.message.split('\n')[0];
  const outcome =
    {
      published: 'implemented',
      'no-change': 'no-change',
      failed: 'failed',
    }[result.outcome] ?? result.outcome;
  if (result.outcome === 'published') applyTriageLabel(gh, event.number, 'review-needed', policy);
  setStatusLabel(gh, event.number, 'failed', outcome === 'failed', policy);
  setStatusLabel(gh, event.number, 'running', false, policy);
  record?.(
    url
      ? `Draft pull request: ${url}`
      : outcome === 'failed'
        ? `Failed: ${first}. The run's artifact holds the prompt, log and verification; comment \`/approve\` to try again.`
        : `${result.outcome}: ${first}`
  );
  return { outcome, message: `issue #${event.number}: ${result.message}` };
}

// ── The quality gate (REQ-ISS-005, -006, -007) ──────────────────────────────────────────────────

/** What happens to the model tier, and its report when it ran (REQ-ISS-005, -016, -022). */
function judge(ctx, structural) {
  const { event, opts, gh } = ctx;
  if (structural.verdict !== 'ready')
    return { judgment: 'not reached: the structural check failed' };
  if (opts.modelStages === 'skip') return { judgment: 'skipped: no harness credential' };
  if (issueSettings(opts.policy).modelFor !== 'anyone' && gh) {
    const role = gh.permission(event.author.login);
    if (!TRIAGE_ACCESS.includes(role))
      return {
        judgment: `skipped: @${event.author.login} has no triage access (issues.modelFor)`,
        outsider: true,
      };
  }
  const result = runGateTask(ctx);
  if (result.outcome === 'reported') return { judgment: 'ran', report: result.report };
  if (result.outcome === 'dry-run') return { judgment: `dry run: ${result.message}` };
  return { judgment: 'failed', failed: result.message.split('\n')[0] };
}

/** The next step a person reads under the verdict. */
function nextStep(verdict, judged, { plan, auto }) {
  if (judged.outsider)
    return "The author has no triage access, so no model ran (`issues.modelFor`): a maintainer's `/plan` starts the rest.";
  if (verdict === 'human-decision-needed')
    return 'A person decides the open question, then edits the issue to run this check again.';
  if (verdict !== 'ready') return null;
  if (auto) return 'Next: the implementation, without a plan (`issues.autonomy.simple: auto`).';
  if (plan)
    return 'Next: the plan below; a maintainer approves it with `/approve`, or first comments a `## Plan` of their own.';
  return 'Next: a maintainer comments `/plan` for a plan (it needs a harness credential), then `/approve`.';
}

/**
 * The quality gate (REQ-ISS-005, -006, -007): verdict, size, comment, one triage label. A ready
 * issue then gets a plan (REQ-ISS-008), or under `autonomy.simple: auto` a simple one is built.
 */
function gate(ctx) {
  const { event, opts, io, gh } = ctx;
  const { policy, harness } = opts;
  const settings = issueSettings(policy);
  const sections = templateSections(opts.template ?? null);
  const structural = structuralVerdict(event.body, sections);
  if (gh) load(ctx);
  const judged = judge(ctx, structural);
  const merged = judged.failed
    ? { verdict: 'human-decision-needed', reasons: [`the judgment tier failed: ${judged.failed}`] }
    : mergeVerdicts(structural, judged.report);
  const { verdict } = merged;
  const sized =
    verdict === 'ready'
      ? sizeClass(event, settings.complexWhen, policy.maxChangedLines, merged.modelSize)
      : null;
  const rewrite =
    verdict === 'needs-detail'
      ? (merged.rewrite ?? rewriteSkeleton(event, sections, templateHints(opts.template ?? null)))
      : null;
  if (rewrite && settings.applyRewrite)
    io.log('issues.applyRewrite is not supported by this runner yet; the rewrite stays a comment');
  const ready = verdict === 'ready' && !judged.outsider;
  const auto =
    ready &&
    sized.size === 'simple' &&
    settings.autonomy.simple === 'auto' &&
    judged.judgment === 'ran';
  const plan = ready && !auto && judged.report ? parseJudgment(judged.report).plan : null;
  const role = verdict === 'ready' ? 'approval-needed' : verdict;
  const comment = renderGateComment({
    verdict,
    reasons: merged.reasons,
    rewrite,
    size: sized?.size,
    sizeReasons: sized?.reasons,
    judgment: judged.failed ? `failed: ${judged.failed}` : judged.judgment,
    harness,
    next: nextStep(verdict, judged, { plan: Boolean(plan), auto }),
  });
  const decision = {
    issue: event.number,
    verdict,
    reasons: merged.reasons,
    size: sized?.size ?? null,
    sizeReasons: sized?.reasons ?? [],
    label: labelNames(policy)[role],
    judgment: judged.judgment,
    harness,
    comment,
    plan,
  };
  io.writeFile(DECISION, `${JSON.stringify(decision, null, 2)}\n`);

  if (gh) {
    upsert(ctx, 'gate', comment, { verdict, size: decision.size, harness });
    if (plan) postPlan(ctx, plan);
    applyTriageLabel(gh, event.number, role, policy);
    setStatusLabel(gh, event.number, 'failed', Boolean(judged.failed), policy);
    setStatusLabel(gh, event.number, 'running', false, policy);
  }
  const summary = [
    `issue #${event.number} gate: ${verdict}${decision.size ? ` (${decision.size})` : ''}`,
    ...decision.reasons.map((r) => `- ${r}`),
    ...decision.sizeReasons.map((r) => `- size: ${r}`),
    gh
      ? `labelled ${decision.label}; judgment: ${judged.judgment}${plan ? '; plan posted' : ''}`
      : `dry run: would label ${decision.label} and post the comment in ${DECISION}`,
  ].join('\n');
  if (gh && auto) {
    const built = implement(
      ctx,
      comment,
      null,
      'No person approved a plan: the policy builds simple issues directly (`issues.autonomy.simple: auto`). The plan is the issue check below; the issue in the evidence is the specification.'
    );
    return { ...built, message: `${summary}\n${built.message}`, decision };
  }
  return { outcome: judged.failed ? 'failed' : 'gated', message: summary, decision };
}
