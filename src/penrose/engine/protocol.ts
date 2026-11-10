import type { CompileInput } from './core.ts';
import type { WireCompiled, WireDiagnostic, WireLayout } from '../wire.ts';

export type EngineRequest =
  | { readonly id: number; readonly type: 'compile'; readonly key: string; readonly input: CompileInput }
  | { readonly id: number; readonly type: 'layout'; readonly key: string; readonly varyingValues?: readonly number[] }
  | { readonly id: number; readonly type: 'drag'; readonly key: string; readonly targets: readonly { index: number; value: number }[]; readonly steps: number }
  | { readonly id: number; readonly type: 'point-drag'; readonly key: string; readonly handleId: string; readonly target: { readonly x: number; readonly y: number }; readonly steps: number }
  | { readonly id: number; readonly type: 'converge'; readonly key: string; readonly maxSteps?: number }
  | { readonly id: number; readonly type: 'resample'; readonly key: string }
  | { readonly id: number; readonly type: 'dispose'; readonly key: string };

export type EngineResponse =
  | { readonly id: number; readonly ok: true; readonly compiled?: WireCompiled; readonly layout?: WireLayout }
  | { readonly id: number; readonly ok: false; readonly message: string; readonly diagnostics?: readonly WireDiagnostic[] };

/** Same surface on the worker RPC and on the Node test engine. */
export interface EngineClient {
  compile(key: string, input: CompileInput): Promise<WireCompiled>;
  layout(key: string, varyingValues?: readonly number[]): Promise<WireLayout>;
  drag(key: string, targets: readonly { index: number; value: number }[], steps: number): Promise<WireLayout>;
  pointDrag(key: string, handleId: string, target: { x: number; y: number }, steps: number): Promise<WireLayout>;
  converge(key: string, maxSteps?: number): Promise<WireCompiled>;
  resample(key: string): Promise<WireCompiled>;
  dispose(key: string): Promise<void>;
  close(): void;
}
