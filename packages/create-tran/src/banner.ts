export const TRAN_BANNER = `
  ████████╗██████╗  █████╗ ███╗   ██╗
  ╚══██╔══╝██╔══██╗██╔══██╗████╗  ██║
     ██║   ██████╔╝███████║██╔██╗ ██║
     ██║   ██╔══██╗██╔══██║██║╚██╗██║
     ██║   ██║  ██║██║  ██║██║ ╚████║
     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝
   TanStack Start · Rust Core · Axum · Native (Swift + Kotlin)
`;

export function printBanner(
  out: (text: string) => void = (t) => process.stdout.write(t + '\n')
): void {
  out(TRAN_BANNER);
  out(
    '  🚀 Full-stack monorepo — web, Axum API, and platform-native iOS/Android apps\n'
  );
}
