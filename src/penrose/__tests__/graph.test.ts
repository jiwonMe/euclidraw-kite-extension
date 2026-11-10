// @vitest-environment jsdom
/**
 * Regression: the staged-layout multigraph example (AutoLabel, Label, Path
 * arrows, staged objectives) must compile, optimize and render through the
 * extension, not just through @penrose/core.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost, type Host } from '../../__tests__/harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', name), 'utf8');

suite('staged multigraph example', () => {
  it('applies the trio, converges and renders arrows and labels', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', {
      scopeId,
      domainDsl: fixture('graph.domain'),
      substanceDsl: fixture('graph.substance'),
      styleDsl: fixture('graph.style'),
    });
    await settle(host);
    const layout = host.world.getComputed(scopeId, 'computed.penrose.layout');
    expect(layout).toBeTruthy();
    expect(layout.owners.length).toBe(24);
    expect(layout.shapes.length).toBe(48); // 7 dots + 7 labels + 17 arrows + 17 pointers
    expect(layout.stages).toBe(3);
    const svg = host.compiler.compileToPureSvg(host.world);
    expect(svg).not.toContain('Penrose:');
    expect(svg).toContain('Chicago');
    expect(svg).toContain('San Francisco');
    expect(svg).toContain('<path');
  });
});
