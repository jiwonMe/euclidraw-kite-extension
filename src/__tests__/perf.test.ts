// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasAlid, settle, startHost } from './harness.ts';

const suite = hasAlid ? describe : describe.skip;

suite('perf probe', () => {
  it('measures compile, cold open and drag frame', async () => {
    const t0 = performance.now();
    const host = await startHost();
    const t1 = performance.now();
    const scopeId = await host.run<string>('penrose.studio:insert-scope');
    const t2 = performance.now();
    await settle(host);
    const t3 = performance.now();
    const memberId = (host.world.getCanonical(scopeId, 'penrose.scope').entityBindings as Record<string, string>).A!;
    host.select([memberId]); host.paint();
    const box = host.world.getComputed(memberId, 'computed.penrose.member');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    host.press(x, y);
    const frames: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = performance.now();
      host.pointer('pointermove', x + i * 3, y + i * 2);
      await new Promise(r => setTimeout(r, 0));
      host.paint();
      frames.push(performance.now() - s);
    }
    host.pointer('pointerup', x + 60, y + 40);
    await settle(host);
    frames.sort((a, b) => a - b);
    // P4 budget from PLAN.md: a medium example must stay under 50 ms p95.
    expect(frames[18]!).toBeLessThan(50);
    console.log(JSON.stringify({
      bootMs: Math.round(t1 - t0),
      insertMs: Math.round(t2 - t1),
      insertSettleMs: Math.round(t3 - t2),
      dragMedianMs: Math.round(frames[10]! * 100) / 100,
      dragP95Ms: Math.round(frames[18]! * 100) / 100,
    }));
  });
});
