import { execFileSync } from 'node:child_process';
import { build } from 'vite';
import { readConfig, writeInstallManifest } from './install-manifest.mjs';

await readConfig();
// 1. @penrose/core worker → src/generated/penrose-worker.ts (single ES module string)
execFileSync(process.execPath, ['scripts/build-worker.mjs'], { stdio: 'inherit' });
// 2. extension entry → one self-contained ESM (worker inlined as a string)
await build({ logLevel: 'warn' });
// 3. alid.extension.json with the bundle's SHA-256
const manifest = await writeInstallManifest();
console.log(`Prepared ${manifest.id} ${manifest.version}: ${manifest.sha256}`);
