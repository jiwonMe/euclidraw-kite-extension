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
      entry = { digest, status: 'idle', pins: [] };
      this.entries.set(scopeId, entry);
    }
    if (entry.status === 'idle' && scope.topologyDigest !== '') this.start(scopeId, scope, entry);
    return entry;
  }

  private start(scopeId: EntityId, scope: PenroseScopeAspect, entry: Entry): void {
    const digest = entry.digest;
    const config = readSolverConfig(scope.solverConfig);
    const cold = scope.topologyDigest === digest && scope.varyingValues.length > 0;
    entry.status = 'loading';
    const input: CompileInput = {
      digest,
      domain: scope.domainDsl,
      substance: scope.substanceDsl,
      style: scope.styleDsl,
      variation: scope.variation || '0',
      ...(cold ? { seeds: scope.varyingValues } : {}),
      maxSteps: config.maxSteps,
    };
    void this.engine
      .compile(scopeId, input)
      .then(compiled => {
        if (entry.digest !== digest) return undefined;
        entry.compiled = compiled;
        return this.engine.layout(scopeId).then(layout => {
          if (entry.digest !== digest) return;
          entry.layout = layout;
          entry.status = 'ready';
          invalidate(this.world);
        });
      })
      .catch((error: unknown) => {
        if (entry.digest !== digest) return;
        const details = error as { message?: string; diagnostics?: readonly WireDiagnostic[]; penroseDiagnostics?: readonly WireDiagnostic[] };
        entry.status = 'error';
        entry.error = details.message ?? String(error);
        entry.diagnostics = details.diagnostics ?? details.penroseDiagnostics;
        invalidate(this.world);
      });
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
        invalidate(this.world);
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
    this.entries.set(scopeId, { digest, status: 'ready', compiled: { ...compiled, varyingValues: layout.varyingValues }, layout, pins });
    return { compiled, layout };
  }

  /** Re-converge from the current inputs (reproject command). */
  async converge(scopeId: EntityId, scope: PenroseScopeAspect, pins: readonly PenrosePin[] = []): Promise<WireCompiled> {
    const digest = this.digest(scope);
    const compiled = await this.engine.converge(scopeId, readSolverConfig(scope.solverConfig).maxSteps);
    const targets = pinTargets(pins);
    let layout = await this.engine.layout(scopeId);
    if (targets.length) layout = await this.engine.drag(scopeId, targets, 0);
    const result = { ...compiled, varyingValues: layout.varyingValues };
    this.entries.set(scopeId, { digest, status: 'ready', compiled: result, layout, pins });
    return result;
  }

  async resample(scopeId: EntityId, scope: PenroseScopeAspect, pins: readonly PenrosePin[] = []): Promise<WireCompiled> {
    const digest = this.digest(scope);
    const compiled = await this.engine.resample(scopeId);
    const targets = pinTargets(pins);
    let layout = await this.engine.layout(scopeId);
    if (targets.length) layout = await this.engine.drag(scopeId, targets, 0);
    const result = { ...compiled, varyingValues: layout.varyingValues };
    this.entries.set(scopeId, { digest, status: 'ready', compiled: result, layout, pins });
    return result;
  }

  /** Drag preview: inputs are pinned to the pointer, the rest is re-optimized. */
  async drag(scopeId: EntityId, targets: readonly { index: number; value: number }[], steps: number): Promise<WireLayout> {
    const layout = await this.engine.drag(scopeId, targets, steps);
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
