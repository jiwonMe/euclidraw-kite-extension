// @vitest-environment jsdom
/**
 * Opening, reading, painting and exporting a Penrose scope must never write to
 * the document, and a peer must render the same SVG from the stored inputs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost, type Host } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;
let host: Host | undefined;
afterEach(() => { host?.dispose(); host = undefined; });

const scopeOf = (h: Host) => h.world.listEntityIds().find((id: string) => h.world.getCanonical(id, 'penrose.scope'))!;
const bindings = (h: Host, scopeId: string) => h.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>;

suite('zero write on read (real kernel + Loro core)', () => {
  it('cold-reads a stored scope from varyingValues without writing', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const layout = host.world.getComputed(scopeId, 'computed.penrose.layout');
    expect(layout.shapes.length).toBeGreaterThan(0);
    expect(layout.varyingValues.length).toBeGreaterThan(0);

    const snapshot = host.wasm.get_canonical_json();
    const reopened = await startHost();
    reopened.world.replaceCanonicalSnapshot(snapshot);
    await settle(reopened);
    const commitsBefore = reopened.commits(), groupsBefore = reopened.groups(), jsonlBefore = reopened.jsonl();
    const cold = reopened.world.getComputed(scopeId, 'computed.penrose.layout');
    expect(cold.digest).toBe(layout.digest);
    expect(cold.varyingValues).toEqual(layout.varyingValues);

    for (const id of Object.values(bindings(reopened, scopeId))) {
      expect(reopened.world.getComputed(id, 'computed.penrose.member')).toBeTruthy();
      expect(reopened.world.getComputed(id, 'computed.layoutBounds')).toBeTruthy();
    }
    for (let frame = 0; frame < 6; frame++) reopened.paint();
    const first = reopened.compiler.compileToPureSvg(reopened.world);
    expect(reopened.compiler.compileToPureSvg(reopened.world)).toBe(first);
    expect(reopened.commits()).toBe(commitsBefore);
    expect(reopened.groups()).toBe(groupsBefore);
    expect(reopened.jsonl()).toBe(jsonlBefore);
    reopened.dispose();
  });

  it('moves, resizes and rotates a scope by transform only', async () => {
    host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    const before = JSON.stringify(host.world.getCanonical(scopeId, 'penrose.scope').varyingValues);
    const memberId = bindings(host, scopeId).A!;
    const beforeBox = host.world.getComputed(memberId, 'computed.penrose.member');
    host.world.applyCanonicalTransaction('test:move', [
      { id: scopeId, aspect: 'core.transform', patch: { x: 1000, y: 500, rotation: Math.PI / 2 } },
      { id: scopeId, aspect: 'core.bounds', patch: { width: 1040, height: 760 } },
    ]);
    host.paint();
    expect(JSON.stringify(host.world.getCanonical(scopeId, 'penrose.scope').varyingValues)).toBe(before);
    const afterBox = host.world.getComputed(memberId, 'computed.penrose.member');
    expect(Math.hypot(afterBox.x - beforeBox.x, afterBox.y - beforeBox.y)).toBeGreaterThan(100);
  });

  it('renders byte-identical SVG across peers', async () => {
    host = await startHost();
    await host.run('penrose.studio:insert-scope');
    await settle(host);
    const other = await startHost();
    other.world.replaceCanonicalSnapshot(host.wasm.get_canonical_json());
    await settle(other);
    expect(other.compiler.compileToPureSvg(other.world)).toBe(host.compiler.compileToPureSvg(host.world));
    other.dispose();
  });
});

export { scopeOf };
