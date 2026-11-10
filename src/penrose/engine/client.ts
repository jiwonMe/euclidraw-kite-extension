/**
 * Main-thread engine client. `@penrose/core` is never imported here; the engine
 * lives in the committed worker bundle (see scripts/build-worker.mjs).
 */
import { PENROSE_WORKER_SOURCE } from '../../generated/penrose-worker.ts';
import type { EngineClient, EngineRequest, EngineResponse } from './protocol.ts';
import type { WireCompiled, WireLayout } from '../wire.ts';

interface Pending {
  resolve(value: EngineResponse): void;
  reject(error: Error): void;
}

type RequestBody = EngineRequest extends infer R
  ? R extends { readonly id: number }
    ? Omit<R, 'id'>
    : never
  : never;
type OkResponse = Extract<EngineResponse, { ok: true }>;

class WorkerEngine implements EngineClient {
  private worker: Worker | undefined;
  private url: string | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('이 환경에는 Web Worker가 없습니다. 테스트는 인라인 엔진을 주입해야 합니다.');
    }
    this.url = URL.createObjectURL(new Blob([PENROSE_WORKER_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(this.url, { type: 'module', name: 'penrose.worker' });
    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      pending.resolve(response);
    };
    worker.onerror = event => {
      const error = new Error(event.message || 'Penrose worker crashed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.worker = undefined;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = undefined;
    };
    this.worker = worker;
    return worker;
  }

  private request(request: RequestBody): Promise<EngineResponse> {
    const worker = this.ensure();
    const id = this.nextId++;
    const message = { ...request, id } as EngineRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async unwrap(response: EngineResponse, what: string): Promise<OkResponse> {
    if (response.ok) return response;
    const error = new Error(`Penrose ${what} 실패: ${response.message}`) as Error & { diagnostics?: unknown };
    error.diagnostics = response.diagnostics;
    throw error;
  }

  async compile(key: string, input: Parameters<EngineClient['compile']>[1]): Promise<WireCompiled> {
    const response = await this.unwrap(await this.request({ type: 'compile', key, input }), 'compile');
    if (!response.compiled) throw new Error('Penrose compile returned no result');
    return response.compiled;
  }

  async layout(key: string, varyingValues?: readonly number[]): Promise<WireLayout> {
    const response = await this.unwrap(await this.request({ type: 'layout', key, varyingValues }), 'layout');
    if (!response.layout) throw new Error('Penrose layout returned no result');
    return response.layout;
  }

  async drag(key: string, targets: readonly { index: number; value: number }[], steps: number): Promise<WireLayout> {
    const response = await this.unwrap(await this.request({ type: 'drag', key, targets, steps }), 'drag');
    if (!response.layout) throw new Error('Penrose drag returned no result');
    return response.layout;
  }

  async converge(key: string, maxSteps?: number): Promise<WireCompiled> {
    const response = await this.unwrap(await this.request({ type: 'converge', key, maxSteps }), 'converge');
    if (!response.compiled) throw new Error('Penrose converge returned no result');
    return response.compiled;
  }

  async resample(key: string): Promise<WireCompiled> {
    const response = await this.unwrap(await this.request({ type: 'resample', key }), 'resample');
    if (!response.compiled) throw new Error('Penrose resample returned no result');
    return response.compiled;
  }

  async dispose(key: string): Promise<void> {
    if (!this.worker) return;
    await this.request({ type: 'dispose', key }).catch(() => undefined);
  }

  close(): void {
    this.worker?.terminate();
    this.worker = undefined;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error('Penrose engine closed'));
    this.pending.clear();
  }
}

export type EngineFactory = () => EngineClient;

export function createEngineClient(): EngineClient {
  // Node tests have no Web Worker; the harness injects an inline engine.
  const factory = (globalThis as { __PENROSE_ENGINE_FACTORY__?: EngineFactory }).__PENROSE_ENGINE_FACTORY__;
  if (typeof factory === 'function') return factory();
  return new WorkerEngine();
}
