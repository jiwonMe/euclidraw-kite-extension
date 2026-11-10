import { defineConfig } from 'vitest/config';
import { alidAliases, hasAlid } from './alid-checkout.ts';

export default defineConfig({
  resolve: { alias: alidAliases },
  define: { __HAS_ALID__: JSON.stringify(hasAlid), __ALID_CORE_WASM__: JSON.stringify(alidAliases['alid-host:core-wasm']) },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000 },
});
