import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Smoke-test the actual generated worker bundle in a real worker thread. This
 * covers bundling, `self.onmessage`, the compile message and MathJax labels —
 * everything except the browser's Blob URL loader and the host CSP.
 */
const workerPath = resolve(process.cwd(), '.worker-build/worker.js');
const suite = existsSync(workerPath) ? describe : describe.skip;

const domain = 'type Point\ntype Circle\n';
const substance = 'Point A\nCircle c\n';
const style = `canvas {
  width = 520
  height = 380
}
forall Point p {
  p.icon = Circle {
    r: 6
  }
}
forall Circle c {
  c.icon = Circle {
    r: 96
  }
  c.eq = Equation {
    string: "x^2"
    center: (0, 150)
    fontSize: "16px"
  }
}`;

interface WorkerResponse {
  id: number;
  ok: boolean;
  compiled?: { owners: string[]; labels: Record<string, string>; varyingValues: number[] };
  message?: string;
}

suite('generated worker bundle', () => {
  it('drags a projected point or input through the bundled worker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'penrose-worker-drag-'));
    const wrapper = join(directory, 'wrapper.mjs');
    writeFileSync(wrapper, `
import { parentPort } from 'node:worker_threads';
globalThis.self = { onmessage: null, postMessage(message) { parentPort.postMessage(message); } };
parentPort.on('message', data => globalThis.self.onmessage?.({ data }));
await import(${JSON.stringify(pathToFileURL(workerPath).href)});
`);
    const worker = new Worker(wrapper);
    let nextId = 1;
    const pending = new Map<number, (value: any) => void>();
    worker.on('message', (message: any) => { const resolve = pending.get(message.id); if (resolve) { pending.delete(message.id); resolve(message); } });
    const send = (request: any) => new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      const timer = setTimeout(() => reject(new Error('worker timed out')), 20_000);
      const done = pending.get(id)!;
      pending.set(id, value => { clearTimeout(timer); done(value); });
      worker.postMessage({ ...request, id });
    });
    try {
      const domain = readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/graph.domain'), 'utf8');
      const substance = readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/graph.substance'), 'utf8');
      const style = readFileSync(resolve(process.cwd(), 'src/__tests__/fixtures/graph.style'), 'utf8');
      const compiled = await send({ type: 'compile', key: 'graph', input: { digest: 'graph', domain, substance, style, variation: '0' } });
      expect(compiled.ok).toBe(true);
      const layout = await send({ type: 'layout', key: 'graph' });
      expect(layout.layout.shapes.length).toBeGreaterThan(10);
      const inputs = compiled.compiled.interactivity.translatable as any[];
      const dot = inputs.find(input => input.path === '`LA`.dot');
      const text = inputs.find(input => input.path === '`LA`.text');
      expect(dot).toBeTruthy();
      expect(text).toBeTruthy();
      const values = layout.layout.varyingValues as number[];
      const beforeDot = { x: values[dot.center[0]]!, y: values[dot.center[1]]! };
      const beforeLabel = { x: values[text.center[0]]!, y: values[text.center[1]]! };
      const dragged = await send({
        type: 'drag',
        key: 'graph',
        targets: [{ index: dot.center[0], value: beforeDot.x + 30 }, { index: dot.center[1], value: beforeDot.y }],
        steps: 2,
        budgetMs: 20,
      });
      expect(dragged.ok).toBe(true);
      const after = dragged.layout.varyingValues as number[];
      const dotDelta = { x: (after[dot.center[0]] ?? 0) - beforeDot.x, y: (after[dot.center[1]] ?? 0) - beforeDot.y };
      const labelDelta = { x: (after[text.center[0]] ?? 0) - beforeLabel.x, y: (after[text.center[1]] ?? 0) - beforeLabel.y };
      expect(Math.abs(dotDelta.x - 30)).toBeLessThan(1);
      expect(Math.abs(labelDelta.x - dotDelta.x)).toBeLessThan(1);
    } finally {
      await worker.terminate();
    }
  });

  it('compiles a trio and returns labels', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'penrose-worker-'));
    const wrapper = join(directory, 'wrapper.mjs');
    writeFileSync(wrapper, `
import { parentPort } from 'node:worker_threads';
globalThis.self = {
  onmessage: null,
  postMessage(message) { parentPort.postMessage(message); },
};
parentPort.on('message', data => globalThis.self.onmessage?.({ data }));
await import(${JSON.stringify(pathToFileURL(workerPath).href)});
`);
    const worker = new Worker(wrapper);
    try {
      const response = await new Promise<WorkerResponse>((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error('worker timed out')), 20_000);
        worker.once('message', (message: WorkerResponse) => { clearTimeout(timer); resolvePromise(message); });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.postMessage({ id: 1, type: 'compile', key: 'test', input: { digest: 'test', domain, substance, style, variation: '0' } });
      });
      expect(response.ok).toBe(true);
      expect(response.compiled?.owners).toEqual(['A', 'c']);
      expect(response.compiled?.varyingValues.length).toBeGreaterThan(0);
      // Equation labels are pre-rendered MathJax SVG paths, not DOM.
      const label = Object.values(response.compiled?.labels ?? {})[0] ?? '';
      expect(label).toContain('<svg');
      expect(label).toContain('<path');
    } finally {
      await worker.terminate();
    }
  });
});
