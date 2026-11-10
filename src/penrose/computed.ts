import type { ComputedAspectSpec, ComputedReadView, EntityId } from '../host.ts';
import { COMPUTED, EXTENSION_ID } from '../manifest.ts';
import { canvasBoundsToWorld, frameFor, readScopeBox } from './frame.ts';
import { hitOwner, ownerBounds, type RenderOptions } from './render.ts';
import type { PenroseRuntime } from './runtime.ts';
import { SCOPE_ASPECT, type PenroseMemberAspect, type PenroseScopeAspect } from './schema.ts';
import type { WireBounds, WireCanvas, WireComputedHandle, WireDiagnostic, WireInteractivity, WireLayout } from './wire.ts';

export interface CompiledScope {
  readonly ok: boolean;
  readonly digest: string;
  readonly owners: readonly string[];
  readonly canvas: WireCanvas;
  readonly varyingValues: readonly number[];
  readonly interactivity: WireInteractivity;
  readonly diagnostics: readonly WireDiagnostic[];
  readonly pending: boolean;
  readonly error?: string;
}

export interface SolvedLayout {
  readonly digest: string;
  readonly canvas: WireCanvas;
  readonly owners: readonly string[];
  readonly bounds: Readonly<Record<string, WireBounds>>;
  readonly shapes: WireLayout['shapes'];
  readonly computed: readonly WireComputedHandle[];
  readonly labels: Readonly<Record<string, string>>;
  readonly varyingValues: readonly number[];
  readonly energy: number;
  readonly stages: number;
}

export interface MemberGeometry {
  readonly ownerKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0;
  readonly error?: string;
}

const layoutCache = new WeakMap<WireLayout, Readonly<Record<string, WireBounds>>>();

function boundsOf(layout: WireLayout): Readonly<Record<string, WireBounds>> {
  let bounds = layoutCache.get(layout);
  if (!bounds) {
    bounds = ownerBounds(layout.shapes);
    layoutCache.set(layout, bounds);
  }
  return bounds;
}

export function readScopeView(view: Pick<ComputedReadView, 'getCanonical'>, scopeId: EntityId): PenroseScopeAspect | undefined {
  const scope = view.getCanonical<PenroseScopeAspect>(scopeId, SCOPE_ASPECT);
  if (!scope) return undefined;
  return {
    ...scope,
    schemaVersion: 2,
    domainDsl: String(scope.domainDsl ?? ''),
    substanceDsl: String(scope.substanceDsl ?? ''),
    styleDsl: String(scope.styleDsl ?? ''),
    variation: String(scope.variation ?? '0'),
    topologyDigest: String(scope.topologyDigest ?? ''),
    varyingValues: Array.isArray(scope.varyingValues) ? scope.varyingValues.filter(value => typeof value === 'number') : [],
    pins: Array.isArray(scope.pins) ? scope.pins.filter(entry => typeof entry === 'string') : [],
    entityBindings: { ...(scope.entityBindings ?? {}) },
    solverConfig: scope.solverConfig ?? { maxSteps: 4000, dragSteps: 2 },
  };
}

export function createComputedSpecs(runtime: PenroseRuntime): {
  compiled: ComputedAspectSpec<CompiledScope>;
  layout: ComputedAspectSpec<SolvedLayout>;
} {
  const compiled: ComputedAspectSpec<CompiledScope> = {
    id: COMPUTED.compiled,
    symbol: `${EXTENSION_ID}:compile`,
    dependsOnCanonical: [SCOPE_ASPECT],
    compute(scopeId, view) {
      const scope = readScopeView(view, scopeId);
      if (!scope) return undefined;
      const error = runtime.error(scopeId, scope);
      if (error) {
        return {
          ok: false,
          digest: runtime.digest(scope),
          owners: [], canvas: { width: 1, height: 1 }, varyingValues: [], interactivity: { translatable: [], scalable: [] },
          diagnostics: error.diagnostics ?? [], pending: false, error: error.message,
        };
      }
      const result = runtime.compiled(scopeId, scope);
      if (!result) {
        return {
          ok: false,
          digest: runtime.digest(scope),
          owners: [], canvas: { width: 1, height: 1 }, varyingValues: [], interactivity: { translatable: [], scalable: [] },
          diagnostics: [], pending: true,
        };
      }
      return {
        ok: true,
        digest: result.digest,
        owners: result.owners,
        canvas: result.canvas,
        varyingValues: result.varyingValues,
        interactivity: result.interactivity,
        diagnostics: result.diagnostics,
        pending: false,
      };
    },
    equals(previous, next) {
      return previous.digest === next.digest && previous.ok === next.ok && previous.pending === next.pending;
    },
  };

  const layout: ComputedAspectSpec<SolvedLayout> = {
    id: COMPUTED.layout,
    symbol: `${EXTENSION_ID}:layout`,
    dependsOnCanonical: [SCOPE_ASPECT],
    dependsOnComputed: [COMPUTED.compiled],
    compute(scopeId, view) {
      const scope = readScopeView(view, scopeId);
      if (!scope) return undefined;
      const result = runtime.layout(scopeId, scope);
      if (!result) return undefined;
      return {
        digest: result.digest,
        canvas: result.canvas,
        owners: result.owners,
        bounds: boundsOf(result),
        shapes: result.shapes,
        computed: result.computed,
        labels: result.labels,
        varyingValues: result.varyingValues,
        energy: result.energy,
        stages: result.stages,
      };
    },
    equals(previous, next) {
      return previous.digest === next.digest && previous.varyingValues === next.varyingValues && previous.shapes === next.shapes;
    },
  };

  return { compiled, layout };
}

export function memberGeometry(
  member: PenroseMemberAspect,
  scopeId: EntityId,
  view: ComputedReadView,
): MemberGeometry | undefined {
  const box = readScopeBox(view, scopeId);
  const layout = view.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
  if (!box || !layout) return undefined;
  const bounds = layout.bounds[member.ownerKey];
  if (!bounds) {
    return { ownerKey: member.ownerKey, x: box.x, y: box.y, width: 1, height: 1, rotation: 0, error: `${member.ownerKey}: 도형 없음` };
  }
  const frame = frameFor(layout.canvas, box);
  const world = canvasBoundsToWorld(frame, bounds);
  return { ownerKey: member.ownerKey, x: world.x, y: world.y, width: world.width, height: world.height, rotation: 0 };
}

/** Selection hit test for one owner; world coordinates in, canvas distance out. */
export function memberHit(
  member: PenroseMemberAspect,
  scopeId: EntityId,
  view: ComputedReadView,
  x: number,
  y: number,
  zoom: number,
): number {
  const box = readScopeBox(view, scopeId);
  const layout = view.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
  if (!box || !layout) return Infinity;
  const frame = frameFor(layout.canvas, box);
  const screen = {
    x: layout.canvas.width / 2 + ((x - frame.cx) * Math.cos(frame.rotation) + (y - frame.cy) * Math.sin(frame.rotation)) / frame.scale,
    y: layout.canvas.height / 2 + (-(x - frame.cx) * Math.sin(frame.rotation) + (y - frame.cy) * Math.cos(frame.rotation)) / frame.scale,
  };
  const canvasPoint = { x: screen.x - layout.canvas.width / 2, y: layout.canvas.height / 2 - screen.y };
  const slop = 4 / Math.max(zoom * frame.scale, 1e-3);
  const distance = hitOwner(layout.shapes, member.ownerKey, canvasPoint.x, canvasPoint.y, slop);
  // Selection contributions report Infinity for a miss; the renderer reports a
  // signed distance so the caller can rank near misses.
  return distance <= 0 ? distance : Infinity;
}

export function renderOptions(layout: SolvedLayout, idPrefix: string): RenderOptions {
  return { canvas: layout.canvas, labels: layout.labels, idPrefix };
}

export { boundsOf };
