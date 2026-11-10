import type { CanvasWorld, EntityId } from '../host.ts';
import { createEngineClient } from './engine/client.ts';
import type { EngineClient } from './engine/protocol.ts';
import type { CompileInput } from './engine/core.ts';
import type { WireCompiled, WireDiagnostic, WireLayout } from './wire.ts';
import { readSolverConfig, scopeDigest, type PenrosePin, type PenroseScopeAspect, type ScopeSource } from './schema.ts';

interface Entry {
  digest: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  compiled?: WireCompiled;
  layout?: WireLayout;
  error?: string;
  diagnostics?: readonly WireDiagnostic[];
  pins: readonly PenrosePin[];
  startedAt: number;
  attempts: number;
  /** Transport failures retry; a DSL error does not. */
  retryable: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const invalidate = (world: CanvasWorld) => {
  (world as { invalidateComputed?(): void }).invalidateComputed?.();
};

function pinTargets(pins: readonly PenrosePin[]): { index: number; value: number }[] {
  return pins
    .filter(pin => Number.isInteger(pin.index) && pin.index >= 0 && Number.isFinite(pin.value))
    .map(pin => ({ index: pin.index, value: pin.value }));
}

/**
 * Owns the worker client and the synchronous view computed cells read.
 * Nothing here writes canonical data; async results only invalidate computed
 * cells, exactly like the previous solver's Wasm load.
 */
export class PenroseRuntime {
  readonly engine: EngineClient;
  private readonly entries = new Map<EntityId, Entry>();
  private readonly syncing = new Set<EntityId>();
  /** True while a pointer drag previews values that are not canonical. */
  dragging = false;
  /** Host repaint hook (surface.requestRender); invalidate alone may not draw. */
  onUpdate: (() => void) | undefined;

  constructor(private readonly world: CanvasWorld, engine?: EngineClient) {
    this.engine = engine ?? createEngineClient();
  }

  digest(scope: PenroseScopeAspect): string {
    return scopeDigest(scope, scope.variation);
  }

  /** Kick off compilation if the cached entry is stale; never throws. */
  private entry(scopeId: EntityId, scope: PenroseScopeAspect): Entry {
    const digest = this.digest(scope);
    let entry = this.entries.get(scopeId);
    if (!entry || entry.digest !== digest) {
      entry = { digest, status: 'idle', pins: [], startedAt: 0, attempts: 0, retryable: false };
      this.entries.set(scopeId, entry);
    }
    // Recover from a worker that never answered (reload races, transient CSP).
    if (entry.status === 'loading' && performance.now() - entry.startedAt > 10_000) {
      entry.status = 'idle';
      entry.retryable = true;
    }
    if (entry.status === 'error' && entry.retryable && entry.attempts < 2) entry.status = 'idle';
    if (entry.status === 'idle' && scope.topologyDigest !== '') this.start(scopeId, scope, entry);
    return entry;
  }

  private start(scopeId: EntityId, scope: PenroseScopeAspect, entry: Entry): void {
    const digest = entry.digest;
    const config = readSolverConfig(scope.solverConfig);
    const cold = scope.topologyDigest === digest && scope.varyingValues.length > 0;
    entry.status = 'loading';
    entry.startedAt = performance.now();
    entry.attempts++;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (entry.digest === digest && entry.status === 'loading') this.fail(entry, digest, new Error('컴파일 시간 초과'));
    }, 8_000);
    const input: CompileInput = {
      digest,
      domain: scope.domainDsl,
      substance: scope.substanceDsl,
      style: scope.styleDsl,
      variation: scope.variation || '0',
      ...(cold ? { seeds: scope.varyingValues } : {}),
      maxSteps: config.maxSteps,
    };
    try {
      void this.engine
        .compile(scopeId, input)
        .then(compiled => {
          if (entry.digest !== digest) return undefined;
          entry.compiled = compiled;
          return this.engine.layout(scopeId).then(layout => {
            if (entry.digest !== digest) return;
            entry.layout = layout;
            entry.status = 'ready';
            entry.retryable = false;
            entry.attempts = 0;
            if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
            this.notify();
          });
        })
        .catch((error: unknown) => this.fail(entry, digest, error));
    } catch (error) {
      // A synchronous throw (e.g. the Worker cannot be created yet) used to
      // leave the entry in 'loading' forever, so the scope showed "compiling".
      this.fail(entry, digest, error);
    }
  }

  private fail(entry: Entry, digest: string, error: unknown): void {
    if (entry.digest !== digest) return;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    const details = error as { message?: string; diagnostics?: readonly WireDiagnostic[]; penroseDiagnostics?: readonly WireDiagnostic[] };
    entry.status = 'error';
    entry.error = details.message ?? String(error);
    entry.diagnostics = details.diagnostics ?? details.penroseDiagnostics;
    entry.retryable = !(entry.diagnostics && entry.diagnostics.length);
    this.notify();
  }

  private notify(): void {
    invalidate(this.world);
    try { this.onUpdate?.(); } catch { /* host render hook must not break the worker path */ }
  }

  compiled(scopeId: EntityId, scope: PenroseScopeAspect): WireCompiled | undefined {
    const entry = this.entry(scopeId, scope);
    return entry.status === 'ready' ? entry.compiled : undefined;
  }

  layout(scopeId: EntityId, scope: PenroseScopeAspect): WireLayout | undefined {
    const entry = this.entry(scopeId, scope);
    if (entry.status === 'ready' && !this.dragging && scope.topologyDigest === entry.digest && entry.layout && scope.varyingValues.length) {
      const current = entry.layout.varyingValues;
      const canonical = scope.varyingValues;
      const differs = current.length !== canonical.length || canonical.some((value, index) => value !== current[index]);
      if (differs) this.relayout(scopeId, canonical, entry);
    }
    return entry.status === 'ready' ? entry.layout : undefined;
  }

  /** Canonical inputs changed outside a drag (undo, peer edit): re-read only. */
  private relayout(scopeId: EntityId, values: readonly number[], entry: Entry): void {
    if (this.syncing.has(scopeId)) return;
    this.syncing.add(scopeId);
    const digest = entry.digest;
    void this.engine
      .layout(scopeId, values)
      .then(layout => {
        if (entry.digest !== digest) return;
        entry.layout = layout;
        if (entry.compiled) entry.compiled = { ...entry.compiled, varyingValues: layout.varyingValues };
        this.notify();
      })
      .catch(() => undefined)
      .finally(() => this.syncing.delete(scopeId));
  }

  error(scopeId: EntityId, scope: PenroseScopeAspect): { message: string; diagnostics?: readonly WireDiagnostic[] } | undefined {
    const entry = this.entry(scopeId, scope);
    if (entry.status === 'error') return { message: entry.error ?? 'Penrose 오류', ...(entry.diagnostics ? { diagnostics: entry.diagnostics } : {}) };
    if (scope.topologyDigest === '') return { message: 'DSL을 적용하지 않았습니다' };
    return undefined;
  }

  /** A fresh compile for an explicit apply (Dirty path). */
  async apply(scopeId: EntityId, source: ScopeSource, variation: string, pins: readonly PenrosePin[] = []): Promise<{ compiled: WireCompiled; layout: WireLayout }> {
    const digest = scopeDigest(source, variation);
    const compiled = await this.engine.compile(scopeId, {
      digest,
      domain: source.domainDsl,
      substance: source.substanceDsl,
      style: source.styleDsl,
      variation,
    });
    let layout = await this.engine.layout(scopeId);
    const targets = pinTargets(pins);
    if (targets.length) {
      layout = await this.engine.drag(scopeId, targets, 0);
    }
    this.entries.set(scopeId, { digest, status: 'ready', compiled: { ...compiled, varyingValues: layout.varyingValues }, layout, pins, startedAt: 0, attempts: 0, retryable: false });
    return { compiled, layout };
  }

  /** Re-converge from the stored inputs (reproject command). */
  async converge(scopeId: EntityId, scope: PenroseScopeAspect, pins: readonly PenrosePin[] = []): Promise<WireCompiled> {
    const digest = this.digest(scope);
    const config = readSolverConfig(scope.solverConfig);
    // Start from the canonical inputs, not from whatever the worker cached:
    // the button must work after reopening a document, undo, or a failed drag.
    const cold = scope.topologyDigest === digest && scope.varyingValues.length > 0;
    await this.engine.compile(scopeId, {
      digest,
      domain: scope.domainDsl,
      substance: scope.substanceDsl,
      style: scope.styleDsl,
      variation: scope.variation || '0',
      ...(cold ? { seeds: scope.varyingValues } : {}),
      maxSteps: config.maxSteps,
    });
    const compiled = await this.engine.converge(scopeId, config.maxSteps);
    const targets = pinTargets(pins);
    let layout = await this.engine.layout(scopeId);
    if (targets.length) layout = await this.engine.drag(scopeId, targets, 0);
    const result = { ...compiled, varyingValues: layout.varyingValues };
    this.entries.set(scopeId, { digest, status: 'ready', compiled: result, layout, pins, startedAt: 0, attempts: 0, retryable: false });
    return result;
  }

  async resample(scopeId: EntityId, scope: PenroseScopeAspect, pins: readonly PenrosePin[] = []): Promise<WireCompiled> {
    const digest = this.digest(scope);
    const compiled = await this.engine.resample(scopeId);
    const targets = pinTargets(pins);
    let layout = await this.engine.layout(scopeId);
    if (targets.length) layout = await this.engine.drag(scopeId, targets, 0);
    const result = { ...compiled, varyingValues: layout.varyingValues };
    this.entries.set(scopeId, { digest, status: 'ready', compiled: result, layout, pins, startedAt: 0, attempts: 0, retryable: false });
    return result;
  }

  /** End-of-drag full convergence from the current warm start. */
  /** Animate between two input vectors by re-deriving shapes each frame. */
  async animate(scopeId: EntityId, from: readonly number[], to: readonly number[], durationMs = 260): Promise<void> {
    const entry = this.entries.get(scopeId);
    if (!entry) return;
    this.dragging = true;
    const started = performance.now();
    try {
      for (;;) {
        const t = Math.min(1, (performance.now() - started) / durationMs);
        const eased = 1 - (1 - t) ** 3;
        const values = from.map((value, index) => value + ((to[index] ?? value) - value) * eased);
        const layout = await this.engine.layout(scopeId, values);
        entry.layout = layout;
        this.notify();
        if (t >= 1) break;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
    } finally {
      this.dragging = false;
    }
  }

  async polish(scopeId: EntityId, options?: { maxSteps?: number; budgetMs?: number; pins?: readonly { index: number; value: number }[] }): Promise<WireLayout> {
    const layout = await this.engine.polish(scopeId, options);
    const entry = this.entries.get(scopeId);
    if (entry) {
      entry.layout = layout;
      if (entry.compiled) entry.compiled = { ...entry.compiled, varyingValues: layout.varyingValues };
    }
    return layout;
  }

  /** Drag a projected/derived point; the worker maps 2D motion to free inputs. */
  async pointDrag(scopeId: EntityId, handleId: string, target: { x: number; y: number }, steps: number, budgetMs?: number): Promise<WireLayout> {
    const layout = await this.engine.pointDrag(scopeId, handleId, target, steps, budgetMs);
    const entry = this.entries.get(scopeId);
    if (entry) entry.layout = layout;
    return layout;
  }

  /** Drag preview: inputs are pinned to the pointer, the rest is re-optimized. */
  async drag(scopeId: EntityId, targets: readonly { index: number; value: number }[], steps: number, budgetMs?: number): Promise<WireLayout> {
    const layout = await this.engine.drag(scopeId, targets, steps, budgetMs);
    const entry = this.entries.get(scopeId);
    if (entry) entry.layout = layout;
    return layout;
  }

  /** Cancel a drag preview: re-read the committed inputs without writing. */
  async restore(scopeId: EntityId, varyingValues: readonly number[]): Promise<void> {
    const layout = await this.engine.layout(scopeId, varyingValues);
    const entry = this.entries.get(scopeId);
    if (entry) entry.layout = layout;
  }

  peek(scopeId: EntityId): WireLayout | undefined {
    return this.entries.get(scopeId)?.layout;
  }

  forget(scopeId: EntityId): void {
    this.entries.delete(scopeId);
    void this.engine.dispose(scopeId);
  }

  close(): void {
    this.engine.close();
    this.entries.clear();
  }
}
