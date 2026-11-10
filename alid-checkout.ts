import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Host integration tests run against a local alid checkout ($ALID or ~/Workspace/alid).
 * The kernel is not published to npm; without a checkout those suites are skipped.
 */
export const alidRoot = process.env.ALID ?? join(homedir(), 'Workspace', 'alid');
export const hasAlid = existsSync(join(alidRoot, 'packages', 'kernel', 'src', 'index.ts'));
const absent = fileURLToPath(new URL('src/__tests__/alid-absent.ts', import.meta.url));
const host = (path: string) => hasAlid ? join(alidRoot, path) : absent;

export const alidAliases: Record<string, string> = {
  '@alid/kernel': host('packages/kernel/src/index.ts'),
  'alid-host:repository-plugins': host('apps/playground/src/repository-plugins.ts'),
  'alid-host:effective-bounds': host('packages/builtins/src/effective-bounds.ts'),
  'alid-host:clipboard': host('packages/extensions/clipboard/src/install.ts'),
  'alid-host:select-suite': host('packages/extensions/select-suite/src/index.ts'),
  'alid-host:minibuffer': host('packages/extensions/minibuffer/src/index.ts'),
  'alid-host:markdown-card': host('packages/extensions/markdown-card/src/index.ts'),
  'alid-host:vector-path': host('packages/extensions/vector-path/src/index.ts'),
  'alid-host:core': host('crates/ecanvas-core/pkg/ecanvas_core.js'),
  'alid-host:core-wasm': hasAlid ? join(alidRoot, 'crates', 'ecanvas-core', 'pkg', 'ecanvas_core_bg.wasm') : absent,
};
