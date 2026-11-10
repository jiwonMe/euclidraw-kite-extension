// @vitest-environment jsdom
/**
 * Reload must recover on its own: a transient worker failure on the first
 * compile used to leave the scope pending ("컴파일 중") until another canonical
 * write (e.g. duplicating the scope) forced a re-read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInlineEngine } from '../penrose/engine/inline.ts';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

suite('reload recovery', () => {
  it('retries a transient worker failure and renders without duplication', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const snapshot = host.wasm.get_canonical_json();

    let calls = 0;
    const flaky = () => {
      const inner = createInlineEngine();
      return {
        ...inner,
        compile: (...args: Parameters<typeof inner.compile>) => {
          calls++;
          if (calls === 1) throw new Error('worker not ready');
          return inner.compile(...args);
        },
      };
    };
    const reloaded = await startHost({ engineFactory: flaky });
    reloaded.world.replaceCanonicalSnapshot(snapshot);
    reloaded.select([scopeId]);

    // First read starts the compile and fails synchronously.
    reloaded.paint();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toBeGreaterThanOrEqual(1);
    // The next computed read retries; no canonical write is involved.
    reloaded.paint();
    await new Promise(resolve => setTimeout(resolve, 300));
    reloaded.paint();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(reloaded.commits()).toBe(0);
    expect(reloaded.world.getComputed(scopeId, 'computed.penrose.layout')).toBeTruthy();
    const svg = reloaded.compiler.compileToPureSvg(reloaded.world);
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('컴파일 중');
    reloaded.dispose();
  });
});
