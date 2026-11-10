// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasAlid, settle, startHost } from './harness.ts';
const suite = hasAlid ? describe : describe.skip;
const fixture = (n: string) => readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures', n), 'utf8');
const centers = (h: any, scopeId: string) => {
  const shapes = h.world.getComputed(scopeId, 'computed.penrose.layout').shapes;
  return shapes.map((s: any) => {
    const c = s.props.center ?? (s.props.points ? s.props.points[0] : s.props.start) ?? [0, 0];
    return { name: s.name, x: c[0], y: c[1] };
  });
};
suite('drag release', () => {
  it('does not jump when the pointer is released', async () => {
    const host = await startHost();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    await settle(host);
    await host.run('penrose.studio:apply-dsl', { scopeId, domainDsl: fixture('graph.domain'), substanceDsl: fixture('graph.substance'), styleDsl: fixture('graph.style') });
    await settle(host);
    host.select([scopeId]); host.paint();
    const h = host.gizmoHandles().find(x => x.id.includes(':move:`LA`.dot'))!;
    host.press(h.x, h.y);
    for (let i = 1; i <= 3; i++) { host.pointer('pointermove', h.x + i * 12, h.y); await new Promise(r => setTimeout(r, 200)); }
    host.paint();
    const before = centers(host, scopeId);
    const energyBefore = host.world.getComputed(scopeId, 'computed.penrose.layout').energy;
    host.pointer('pointerup', h.x + 36, h.y);
    await new Promise(r => setTimeout(r, 600));
    host.paint();
    const after = centers(host, scopeId);
    const map = new Map(after.map((s: any) => [s.name, s]));
    let max = 0, maxName = '';
    for (const s of before) {
      const t = map.get(s.name) as any;
      if (!t) continue;
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d > max) { max = d; maxName = s.name; }
    }
    console.log('max displacement', max.toFixed(2), maxName, 'energy', energyBefore.toFixed(1), '->', host.world.getComputed(scopeId, 'computed.penrose.layout').energy.toFixed(1));
    expect(max).toBeLessThan(10);
  });
});
