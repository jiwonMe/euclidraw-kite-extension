import { build } from 'vite';
import { buildWasm } from './build-wasm.mjs';
import { readConfig, writeInstallManifest } from './install-manifest.mjs';

await readConfig();
// 1. crate-kite-solver → src/generated/kite-solver-wasm.ts (incremental, hash-checked)
buildWasm();
// 2. TypeScript → one self-contained ESM (Wasm inlined as base64)
await build({ logLevel: 'warn' });
// 3. alid.extension.json with the bundle's SHA-256
const manifest = await writeInstallManifest();
console.log(`Prepared ${manifest.id} ${manifest.version}: ${manifest.sha256}`);
