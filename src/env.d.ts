declare module '*.css?inline' {
  const css: string;
  export default css;
}

// Test-only aliases resolved by vitest.config.ts to a local alid checkout.
declare module '@alid/kernel' { const kernel: any; export = kernel; }
declare module 'alid-host:*' { const host: any; export = host; }
