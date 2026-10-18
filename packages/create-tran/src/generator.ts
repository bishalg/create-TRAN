import * as path from 'node:path';
import { type CliOptions, ensureDirectory, writeTemplateFile } from './utils.js';

export async function generateTranProject(options: CliOptions): Promise<void> {
  const root = options.targetDir;
  ensureDirectory(root);

  // 1. Root package.json
  writeTemplateFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: options.projectName,
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'nx run-many -t dev',
          build: 'nx run-many -t build',
          test: 'nx run-many -t test',
          lint: 'nx run-many -t lint',
          'test:rust': 'cargo test',
          'build:rust': 'cargo build --release',
        },
        devDependencies: {
          nx: '^23.3.0',
          typescript: '^5.8.2',
          prettier: '^3.5.3',
        },
        packageManager: `${options.packageManager}@latest`,
      },
      null,
      2
    ) + '\n'
  );

  // 2. pnpm-workspace.yaml or package manager config
  writeTemplateFile(
    path.join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - 'apps/*'\n  - 'packages/*'\n`
  );

  // 3. Root Cargo.toml
  writeTemplateFile(
    path.join(root, 'Cargo.toml'),
    `[workspace]
resolver = "2"
members = [
    "crates/rust-core",
    "apps/api",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "MIT"

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.40", features = ["full"] }
axum = { version = "0.8", features = ["macros"] }
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
thiserror = "2.0"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1.10", features = ["v4", "serde"] }
rust-core = { path = "crates/rust-core" }
`
  );

  // 4. nx.json
  writeTemplateFile(
    path.join(root, 'nx.json'),
    JSON.stringify(
      {
        $schema: './node_modules/nx/schemas/nx-schema.json',
        namedInputs: {
          default: ['{projectRoot}/**/*', 'sharedGlobals'],
          sharedGlobals: [],
        },
        targetDefaults: {
          build: { cache: true, dependsOn: ['^build'] },
          test: { cache: true },
          dev: { continuous: true },
        },
        defaultBase: 'main',
      },
      null,
      2
    ) + '\n'
  );

  // 5. tsconfig.base.json
  writeTemplateFile(
    path.join(root, 'tsconfig.base.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          baseUrl: '.',
          paths: {
            '@tran/core': ['packages/core-ts/src/index.ts'],
          },
        },
      },
      null,
      2
    ) + '\n'
  );

  // 6. .gitignore
  writeTemplateFile(
    path.join(root, '.gitignore'),
    `node_modules/
dist/
target/
.expo/
.DS_Store
.env
.env.local
`
  );

  // 7. README.md
  writeTemplateFile(
    path.join(root, 'README.md'),
    `# ${options.projectName}

Generated with [create-TRAN](https://github.com/bishalg/create-TRAN).

## TRAN Stack
- **T** - TanStack Start (Web SSR & Routing)
- **R** - Rust Core (Domain Engine & Logic)
- **A** - Axum (High-performance API)
- **N** - Native Mobile (iOS & Android)

## Getting Started
\`\`\`bash
${options.packageManager} install
${options.packageManager} run dev
cargo test
\`\`\`
`
  );
}
