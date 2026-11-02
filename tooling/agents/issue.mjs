/**
 * The issue orchestrator (spec 020, ADR-0037 D4): one GitHub event in, one stage out. It parses
 * the event, reads the state back from labels and markers, and runs the stage the event calls for.
 * This version runs the quality gate on `opened` and `edited`; commands get one reply that they are
 * not available yet. Model stages go through `runTask`, so there is one run path, not two.
 *
 * GitHub access goes through the injected client `gh` (github.mjs); `gh` is null in a dry run,
 * which then writes the decision and the prompt but calls nothing.
 */
import {
  applyTriageLabel,
  mergeVerdicts,
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
  skipReason,
} from './issue-event.mjs';
import { runTask } from './run.mjs';
import { outDir } from './tasks.mjs';

export const GATE_TASK = 'issue-gate';
export const DECISION = `${outDir(GATE_TASK)}/decision.json`;
/** Roles that count as a collaborator for `issues.modelFor: collaborators` (REQ-ISS-022). */
export const TRIAGE_ACCESS = ['admin', 'maintain', 'write', 'triage'];

const harnessNote = (harness) =>
  harness === 'fake' ? ' (fake harness: canned output, no model ran)' : '';

/**
 * One event (REQ-ISS-001). `opts`: { policy, harness, tasks, taskNames, template, dryRun,
 * modelStages ('skip' without a credential), harnessOptions }. `io`: `liveIo` or a fake; `gh`:
 * the GitHub client, or null in a dry run. Returns { outcome, message, decision? } where outcome is
 * nothing | gated | replied | failed.
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
  // A comment on a pull request arrives as an issue comment; its stages come later (WP4, WP6).
  if (event.isPullRequest) return nothing('a pull request comment');
  if (event.kind === 'commented') return replyToCommand(event, opts, gh);
  if (event.kind !== 'opened' && event.kind !== 'edited')
    return nothing(`"${event.kind}" starts no stage`);

  const live = gh && !opts.dryRun ? gh : null;
  try {
    return gate(event, opts, io, live);
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

/** Commands arrive in WP4: until then one reply per issue, updated in place, and nothing else. */
function replyToCommand(event, opts, gh) {
  const body = [
    `\`/${event.command}\` is not available yet: this runner checks issues but does not plan or implement them.`,
    'Nothing was done.',
    '',
    `_Runner · harness: ${opts.harness}${harnessNote(opts.harness)}_`,
  ].join('\n');
  if (gh && !opts.dryRun)
    upsertStageComment(gh, event.number, 'ignored', body, { command: event.command });
  return {
    outcome: 'replied',
    message: `issue #${event.number}: /${event.command} is not available yet`,
  };
}

/** What happens to the model tier, and its report when it ran (REQ-ISS-005, -016, -022). */
function judge(event, structural, comments, opts, io, gh) {
  const { policy, harness } = opts;
  if (structural.verdict !== 'ready')
    return { judgment: 'not reached: the structural check failed' };
  if (opts.modelStages === 'skip') return { judgment: 'skipped: no harness credential' };
  if (issueSettings(policy).modelFor !== 'anyone' && gh) {
    const role = gh.permission(event.author.login);
    if (!TRIAGE_ACCESS.includes(role))
      return {
        judgment: `skipped: @${event.author.login} has no triage access (issues.modelFor)`,
        outsider: true,
      };
  }
  const task = opts.tasks.find((t) => t.data.name === GATE_TASK);
  if (!task) throw new Error(`no task "${GATE_TASK}" in .agents/tasks/`);
  // The runner's own comments are state, not evidence.
  const people = comments.filter((c) => !parseMarker(c.body));
  const maxLines = task.data.evidence_lines ?? policy.evidenceMaxLines;
  const evidence = renderIssueEvidence(event, people, { maxLines });
  if (gh) setStatusLabel(gh, event.number, 'running', true, policy);
  const result = runTask(
    task,
    {
      harness,
      policy,
      dryRun: opts.dryRun,
      publish: false,
      taskNames: opts.taskNames,
      harnessOptions: opts.harnessOptions,
    },
    { ...io, runSignal: () => ({ status: 1, output: evidence, untrusted: true }) }
  );
  if (result.outcome === 'reported') return { judgment: 'ran', report: result.report };
  if (result.outcome === 'dry-run') return { judgment: `dry run: ${result.message}` };
  return { judgment: 'failed', failed: result.message.split('\n')[0] };
}

/** The next step a person reads under the verdict. */
function nextStep(verdict, size, judged, settings) {
  if (judged.outsider)
    return "The author has no triage access, so no model ran (`issues.modelFor`): a maintainer's `/plan` starts the rest.";
  if (verdict === 'human-decision-needed')
    return 'A person decides the open question, then edits the issue to run this check again.';
  if (verdict !== 'ready') return null;
  return size === 'simple' && settings.autonomy.simple === 'auto'
    ? 'Next: the implementation, without a plan (`issues.autonomy.simple: auto`).'
    : 'Next: a plan that a maintainer approves with `/approve`.';
}

/** The quality gate (REQ-ISS-005, -006, -007): verdict, size, comment, one triage label. */
function gate(event, opts, io, gh) {
  const { policy, harness } = opts;
  const settings = issueSettings(policy);
  const sections = templateSections(opts.template ?? null);
  const structural = structuralVerdict(event.body, sections);
  const comments = gh ? gh.listComments(event.number) : [];
  const judged = judge(event, structural, comments, opts, io, gh);
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
  const role = verdict === 'ready' ? 'approval-needed' : verdict;
  const comment = renderGateComment({
    verdict,
    reasons: merged.reasons,
    rewrite,
    size: sized?.size,
    sizeReasons: sized?.reasons,
    judgment: judged.failed ? `failed: ${judged.failed}` : judged.judgment,
    harness,
    next: nextStep(verdict, sized?.size, judged, settings),
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
  };
  io.writeFile(DECISION, `${JSON.stringify(decision, null, 2)}\n`);

  if (gh) {
    const marker = { verdict, size: decision.size, harness };
    upsertStageComment(gh, event.number, 'gate', comment, marker, comments);
    applyTriageLabel(gh, event.number, role, policy);
    setStatusLabel(gh, event.number, 'failed', Boolean(judged.failed), policy);
    setStatusLabel(gh, event.number, 'running', false, policy);
  }
  const summary = [
    `issue #${event.number} gate: ${verdict}${decision.size ? ` (${decision.size})` : ''}`,
    ...decision.reasons.map((r) => `- ${r}`),
    ...decision.sizeReasons.map((r) => `- size: ${r}`),
    gh
      ? `labelled ${decision.label}; judgment: ${judged.judgment}`
      : `dry run: would label ${decision.label} and post the comment in ${DECISION}`,
  ].join('\n');
  return { outcome: judged.failed ? 'failed' : 'gated', message: summary, decision };
}
