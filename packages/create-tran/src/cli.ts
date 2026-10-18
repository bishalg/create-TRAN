import * as path from 'node:path';
import { printBanner } from './banner.js';
import { generateTranProject } from './generator.js';
import { type CliOptions, parseArgs } from './utils.js';

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.help) {
    printBanner();
    process.stdout.write(`
Usage:
  npx create-tran [project-name] [options]

Options:
  --pm, --package-manager <name>  Package manager (pnpm, npm, bun, yarn) [default: pnpm]
  --template <url-or-path>        Template git URL or local path
  --no-git                        Skip git repository initialization
  --no-native                     Exclude mobile apps (iOS, Android, legacy Expo)
  -v, --version                   Show version
  -h, --help                      Show this help message

Examples:
  npx create-tran my-tran-app
  pnpm create tran my-tran-app --pm pnpm
  npx create-tran my-app --no-native --no-git
`);
    return;
  }

  if (parsed.version) {
    process.stdout.write('create-tran v0.1.0\n');
    return;
  }

  printBanner();

  const projectName = parsed.projectName || 'my-tran-app';
  const targetDir = path.resolve(process.cwd(), projectName);

  const options: CliOptions = {
    projectName,
    targetDir,
    packageManager: parsed.packageManager || 'pnpm',
    includeNative: parsed.includeNative ?? true,
    initGit: parsed.initGit ?? true,
    templateUrl: parsed.templateUrl,
  };

  process.stdout.write(`Creating a new TRAN stack project in ${targetDir}...\n\n`);
  process.stdout.write(`  📦 Project:         ${options.projectName}\n`);
  process.stdout.write(`  ⚙️ Package Manager: ${options.packageManager}\n`);
  process.stdout.write(
    `  📱 Native Mobile:   ${options.includeNative ? 'Included' : 'Skipped'}\n\n`
  );

  await generateTranProject(options);

  process.stdout.write('🎉 Successfully scaffolded your TRAN stack project!\n\n');
  process.stdout.write('Next steps:\n');
  process.stdout.write(`  cd ${options.projectName}\n`);
  process.stdout.write(`  ${options.packageManager} install\n`);
  process.stdout.write(`  ${options.packageManager} run dev\n\n`);
}
