import { createRequire } from 'node:module';
import * as path from 'node:path';
import { AGENT_SECRETS, DEFAULT_AGENT_HARNESS, DEFAULT_AGENT_SETUP } from './agents.js';
import { printBanner } from './banner.js';
import { describeCustomization, generateTranProject } from './generator.js';
import { DEFAULT_THEME_MODE } from './palette.js';
import { collectOnboardingAnswers } from './prompts.js';
import { DEFAULT_STEM } from './stem.js';
import { type CliOptions, parseArgs } from './utils.js';

/** From package.json (REQ-REL-001); `../package.json` resolves from both `src/` and `dist/`. */
export const CLI_VERSION = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.help) {
    printBanner();
    process.stdout.write(`
Usage:
  npx create-tran [project-name] [options]

Onboarding (interactive TTY):
  Press Enter to accept each default — Enter through the whole flow for a quick start.
  Primary color: Enter picks a random color from the 5 template brand swatches.
  Optional "Advanced" section: display name, default theme, git init.

Options:
  --prefix, --stem <name>         Code prefix for packages/CSS/types/env (default: ${DEFAULT_STEM})
  --primary, --color <hex>        Brand primary (skips random); e.g. #0ea5e9
  --theme <mode>                  Default theme: light|dark|black|sepia (default: ${DEFAULT_THEME_MODE})
  --display-name <text>           App display name in locales
  --pm, --package-manager <name>  Package manager (pnpm, npm, bun, yarn) [default: pnpm]
  --template <url-or-path>        Template git URL or local path
  --no-git                        Skip git repository initialization
  --no-native                     Exclude mobile apps (iOS, Android)
  --agents <setup>                Coding agents: sample|github|none (default: sample)
                                    sample: task files, runner and docs in .agents/, nothing scheduled
                                    github: the same, scheduled on GitHub Actions (draft PRs only)
  --no-agents                     Same as --agents none
  --agent-harness <name>          Default harness: claude|codex|gemini|pi (default: claude;
                                    github runs claude, codex or gemini)
  -y, --yes                       Non-interactive; defaults only (no random color)
  -v, --version                   Show version
  -h, --help                      Show this help message

Examples:
  npx create-tran
  npx create-tran my-app --prefix acme --primary '#0ea5e9' --theme light
  npx create-tran my-app --yes --no-native
  npx create-tran my-app --agents github --agent-harness codex
  pnpm create tran my-app --pm pnpm
`);
    return;
  }

  if (parsed.version) {
    process.stdout.write(`create-tran v${CLI_VERSION}\n`);
    return;
  }

  printBanner();

  const answers = await collectOnboardingAnswers({
    projectName: parsed.projectName,
    stem: parsed.stem,
    primaryColor: parsed.primaryColor,
    includeNative: parsed.includeNative,
    packageManager: parsed.packageManager,
    initGit: parsed.initGit,
    defaultTheme: parsed.defaultTheme,
    displayName: parsed.displayName,
    agentSetup: parsed.agentSetup,
    agentHarness: parsed.agentHarness,
    skipPrompts: parsed.skipPrompts,
  });

  const targetDir = path.resolve(process.cwd(), answers.projectName);

  const options: CliOptions = {
    projectName: answers.projectName,
    targetDir,
    packageManager: answers.packageManager,
    includeNative: answers.includeNative,
    initGit: answers.initGit,
    stem: answers.stem,
    primaryColor: answers.primaryColor,
    primaryColorLabel: answers.primaryColorLabel,
    defaultTheme: answers.defaultTheme,
    displayName: answers.displayName,
    agentSetup: answers.agentSetup,
    agentHarness: answers.agentHarness,
    skipPrompts: parsed.skipPrompts ?? false,
    templateUrl: parsed.templateUrl,
  };

  process.stdout.write(`\nCreating a TRAN stack project in ${targetDir}...\n\n`);
  for (const line of describeCustomization(options)) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write('\n');

  await generateTranProject(options);

  process.stdout.write('Successfully scaffolded your project.\n\n');
  process.stdout.write('Next steps:\n');
  process.stdout.write(`  cd ${options.projectName}\n`);
  process.stdout.write(`  ${options.packageManager} install\n`);
  if (
    options.primaryColor ||
    options.stem !== DEFAULT_STEM ||
    options.defaultTheme !== DEFAULT_THEME_MODE
  ) {
    process.stdout.write(
      `  ${options.packageManager} tokens:sync   # refresh generated tokens after brand edits\n`
    );
  }
  process.stdout.write(`  ${options.packageManager} run dev\n\n`);
  process.stdout.write(
    'Tip: edit crates/rust-core/src/tokens.rs then run tokens:sync to evolve the brand.\n'
  );
  for (const line of agentNextSteps(options)) {
    process.stdout.write(`${line}\n`);
  }
}

/** What to do next with the chosen agent setup; nothing for `none`. */
export function agentNextSteps(
  options: Pick<CliOptions, 'agentSetup' | 'agentHarness' | 'packageManager'>
): string[] {
  const setup = options.agentSetup ?? DEFAULT_AGENT_SETUP;
  const harness = options.agentHarness ?? DEFAULT_AGENT_HARNESS;
  if (setup === 'none') {
    return [];
  }
  const agents =
    options.packageManager === 'npm' ? 'npm run agents --' : `${options.packageManager} agents`;
  const lines = [
    '',
    `Coding agents (.agents/README.md), default harness ${harness}:`,
    `  ${agents} list                       # the tasks and when they run`,
    `  ${agents} run code-review --dry-run  # read the exact prompt; nothing starts`,
  ];
  if (setup === 'github') {
    lines.push(
      '  After pushing to GitHub, the schedules start once the key is set:',
      `  gh secret set ${AGENT_SECRETS[harness]}`,
      '  gh secret set AGENT_GITHUB_TOKEN     # optional: CI also runs on agent pull requests',
      '  gh variable set AGENTS_ENABLED --body false   # to pause them'
    );
  }
  return lines;
}
