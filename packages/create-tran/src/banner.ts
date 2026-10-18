export const TRAN_BANNER = `
  ████████╗██████╗  █████╗ ███╗   ██╗
  ╚══██╔══╝██╔══██╗██╔══██╗████╗  ██║
     ██║   ██████╔╝███████║██╔██╗ ██║
     ██║   ██╔══██╗██╔══██║██║╚██╗██║
     ██║   ██║  ██║██║  ██║██║ ╚████║
     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝
   TanStack Start · Rust Core · Axum · Native
`;

export function printBanner(
  out: (text: string) => void = (t) => process.stdout.write(t + '\n')
): void {
  out(TRAN_BANNER);
  out('  🚀 Modern, high-performance full-stack & cross-platform monorepo template\n');
}
