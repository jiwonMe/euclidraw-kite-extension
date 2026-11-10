import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
