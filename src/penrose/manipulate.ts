import type { CanvasToolSurface, CanvasToolSurfaceProvider, EntityId } from '../host.ts';
import { type CompiledScope, type SolvedLayout } from './computed.ts';
import { COMPUTED } from '../manifest.ts';
import { commitDrag, readScope, surfaceOf, type PenroseHost } from './documents.ts';
import { frameFor, readScopeBox, toCanvas, type Frame } from './frame.ts';
import { readSolverConfig } from './schema.ts';
import type { WireInputs } from './wire.ts';

interface HandleTarget {
  readonly scopeId: EntityId;
  readonly frame: Frame;
  readonly input: WireInputs;
  readonly kind: 'move' | 'scale';
}

interface DragSession {
  readonly target: HandleTarget;
  readonly baseline: readonly number[];
  readonly startCanvas: { x: number; y: number };
  last: { index: number; value: number }[];
  inflight?: Promise<void>;
  ending: boolean;
}

const HANDLE_PRIORITY = 45;

/** Every optimization input index of one style path, matching runtime order. */
function indexesOf(input: WireInputs): number[] {
  const out: number[] = [];
  if (input.center) out.push(input.center[0], input.center[1]);
  if (input.start) out.push(input.start[0], input.start[1]);
  if (input.end) out.push(input.end[0], input.end[1]);
  for (const point of input.points ?? []) out.push(point[0], point[1]);
  for (const index of [input.r, input.rx, input.ry, input.width, input.height]) if (index !== undefined) out.push(index);
  return out;
}

/**
 * Free-degree gizmos. Handles exist only for properties Penrose reports as
 * optimization inputs (`interactivityInfo`), and a drag writes nothing until
 * the pointer is released.
 */
export class PenroseManipulator {
  private readonly host: PenroseHost;
  private readonly disposeHandles: (() => void)[] = [];
  private readonly listeners: (() => void)[] = [];
  private session: DragSession | undefined;
  private surface: CanvasToolSurface | undefined;
  private lastKey = '';

  constructor(host: PenroseHost) {
    this.host = host;
    const { context } = host;
    const frames = context.services.get<{ subscribe(paint: () => void): () => void }>('canvas.frames');
    if (frames) this.listeners.push(frames.subscribe(() => this.refresh()));
    this.listeners.push(context.world.subscribe(() => this.rebuild()));
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) this.listeners.push(provider.subscribe(() => { this.surface = provider.get(); this.rebuild(); }));
    this.surface = surfaceOf(context);
    this.rebuild();
  }

  dispose(): void {
    this.cancel();
    for (const off of this.listeners.splice(0)) off();
    this.clearHandles();
  }

  private clearHandles(): void {
    for (const off of this.disposeHandles.splice(0)) off();
  }

  private scopes(): EntityId[] {
    const { context } = this.host;
    return context.world
      .listEntityIds()
      .filter(id => context.world.getCanonical(id, 'penrose.scope'))
      .sort();
  }

  /** Rebuild when any rendered layout changed (selection does not gate handles). */
  private refresh(): void {
    const { context } = this.host;
    let key = '';
    for (const scopeId of this.scopes()) {
      const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
      const values = layout?.varyingValues ?? [];
      let checksum = 0;
      for (let index = 0; index < values.length; index += 7) checksum = (checksum * 31 + values[index]!) % 1_000_003;
      key += `${scopeId}:${layout?.digest ?? ''}:${values.length}:${checksum};`;
    }
    if (key !== this.lastKey) { this.lastKey = key; this.rebuild(); }
  }

  private rebuild(): void {
    if (this.session) return;
    this.clearHandles();
    const { context } = this.host;
    const surface = this.surface ?? surfaceOf(context);
    if (!surface) return;
    const registry = surface.selection.gizmos;
    for (const scopeId of this.scopes()) {
      if (context.world.isEntityReadOnly(scopeId)) continue;
      const scope = readScope(context.world, scopeId);
      const compiled = context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled);
      const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
      const box = readScopeBox(context.world.getCanonicalView(), scopeId);
      if (!scope || !compiled || !layout || !box) continue;
      const frame = frameFor(layout.canvas, box);
      const pinned = new Set(scope.pins.map(pin => pin.index));
      const translatable = new Set(compiled.interactivity.translatable.map(input => input.path));
      const scalable = new Set(compiled.interactivity.scalable.map(input => input.path));
      const inputs = new Map<string, WireInputs>();
      for (const input of [...compiled.interactivity.translatable, ...compiled.interactivity.scalable]) inputs.set(input.path, input);
      for (const input of inputs.values()) {
        if (!input.owner) continue;
        // Pinned inputs are not free: no handle until the pin is released.
        if (indexesOf(input).some(index => pinned.has(index))) continue;
        if (translatable.has(input.path)) this.addHandle(scopeId, frame, input, 'move', layout.varyingValues, registry);
        if (scalable.has(input.path)) this.addHandle(scopeId, frame, input, 'scale', layout.varyingValues, registry);
      }
    }
  }

  private canvasPoint(input: WireInputs, values: readonly number[]): { x: number; y: number } | undefined {
    const at = (index: number) => values[index] ?? 0;
    if (input.center) return { x: at(input.center[0]), y: at(input.center[1]) };
    if (input.start && input.end) {
      return { x: (at(input.start[0]) + at(input.end[0])) / 2, y: (at(input.start[1]) + at(input.end[1])) / 2 };
    }
    if (input.points?.length) {
      const sum = input.points.reduce((acc, point) => ({ x: acc.x + at(point[0]), y: acc.y + at(point[1]) }), { x: 0, y: 0 });
      return { x: sum.x / input.points.length, y: sum.y / input.points.length };
    }
    return undefined;
  }

  private addHandle(
    scopeId: EntityId,
    frame: Frame,
    input: WireInputs,
    kind: 'move' | 'scale',
    values: readonly number[],
    registry: CanvasToolSurface['selection']['gizmos'],
  ): void {
    const anchor = this.canvasPoint(input, values);
    if (!anchor) return;
    const offset = kind === 'scale' ? this.scaleOffset(input, values) : { x: 0, y: 0 };
    const position = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    const off = registry.register({
      id: `penrose:${scopeId}:${kind}:${input.path}`,
      priority: HANDLE_PRIORITY,
      shape: 'circle',
      radiusScreenPx: kind === 'move' ? 5 : 6,
      getWorldPosition: out => {
        const world = this.worldOfCanvas(frame, position);
        out.x = world.x; out.y = world.y;
        return true;
      },
      onPointerDown: event => {
        const surface = this.surface ?? surfaceOf(this.host.context);
        if (!surface) return false;
        event.preventDefault();
        this.begin(scopeId, frame, input, kind, event, surface);
        return true;
      },
    });
    this.disposeHandles.push(off);
  }

  private scaleOffset(input: WireInputs, values: readonly number[]): { x: number; y: number } {
    const at = (index: number | undefined) => (index === undefined ? 0 : values[index] ?? 0);
    const radius = input.r !== undefined ? at(input.r) : input.rx !== undefined ? at(input.rx) : input.width !== undefined ? at(input.width) / 2 : 0;
    if (radius) return { x: radius, y: 0 };
    return { x: 0, y: 24 };
  }

  private worldOfCanvas(frame: Frame, point: { x: number; y: number }): { x: number; y: number } {
    const screen = { x: frame.canvas.width / 2 + point.x, y: frame.canvas.height / 2 - point.y };
    const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
    const dx = (screen.x - frame.canvas.width / 2) * frame.scale;
    const dy = (screen.y - frame.canvas.height / 2) * frame.scale;
    return { x: frame.cx + dx * cos - dy * sin, y: frame.cy + dx * sin + dy * cos };
  }

  private canvasOfWorld(frame: Frame, point: { x: number; y: number }): { x: number; y: number } {
    const screen = toCanvas(frame, point.x, point.y);
    return { x: screen.x - frame.canvas.width / 2, y: frame.canvas.height / 2 - screen.y };
  }

  private begin(
    scopeId: EntityId,
    frame: Frame,
    input: WireInputs,
    kind: 'move' | 'scale',
    event: PointerEvent,
    surface: CanvasToolSurface,
  ): void {
    this.cancel();
    const { context } = this.host;
    const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
    if (!layout) return;
    const start = { x: 0, y: 0 };
    surface.host.screenToWorld(event.clientX, event.clientY, start);
    const session: DragSession = {
      target: { scopeId, frame, input, kind },
      baseline: [...layout.varyingValues],
      startCanvas: this.canvasOfWorld(frame, start),
      last: [],
      ending: false,
    };
    this.session = session;
    this.host.runtime.dragging = true;

    const onMove = (move: PointerEvent) => {
      if (this.session !== session) return;
      const world = { x: 0, y: 0 };
      surface.host.screenToWorld(move.clientX, move.clientY, world);
      session.last = this.targetsFor(session, this.canvasOfWorld(frame, world));
      void this.flush(session);
    };
    const onUp = (up: PointerEvent) => {
      if (this.session !== session) return;
      onMove(up);
      session.ending = true;
      const finish = async () => {
        if (session.inflight) await session.inflight;
        const result = await this.host.runtime.drag(scopeId, session.last, 0);
        if (this.session !== session) return;
        commitDrag(this.host, scopeId, result.varyingValues);
        this.session = undefined;
        this.host.runtime.dragging = false;
        cleanup();
        (context.world as { invalidateComputed?(): void }).invalidateComputed?.();
        this.rebuild();
      };
      void finish();
    };
    const onCancel = () => {
      if (this.session !== session) return;
      const saved = session.baseline;
      this.session = undefined;
      this.host.runtime.dragging = false;
      cleanup();
      void this.host.runtime.restore(scopeId, saved).then(() => {
        (context.world as { invalidateComputed?(): void }).invalidateComputed?.();
        this.rebuild();
      });
    };
    const onKey = (key: KeyboardEvent) => { if (key.key === 'Escape') onCancel(); };
    const onBlur = () => onCancel();
    // IME composition takes over the keyboard; never fight it.
    const onComposition = () => onCancel();

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('compositionstart', onComposition);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('compositionstart', onComposition);
  }

  private targetsFor(session: DragSession, canvas: { x: number; y: number }): { index: number; value: number }[] {
    const { input, kind } = session.target;
    const { baseline, startCanvas } = session;
    if (kind === 'move') {
      const dx = canvas.x - startCanvas.x, dy = canvas.y - startCanvas.y;
      const pairs: [number, number][] = [];
      if (input.center) pairs.push([input.center[0], input.center[1]]);
      if (input.start) pairs.push([input.start[0], input.start[1]]);
      if (input.end) pairs.push([input.end[0], input.end[1]]);
      for (const point of input.points ?? []) pairs.push([point[0], point[1]]);
      const targets: { index: number; value: number }[] = [];
      for (const [ix, iy] of pairs) {
        targets.push({ index: ix, value: (baseline[ix] ?? 0) + dx });
        targets.push({ index: iy, value: (baseline[iy] ?? 0) + dy });
      }
      return targets;
    }
    const anchor = this.canvasPoint(input, baseline) ?? startCanvas;
    const radius = Math.max(2, Math.hypot(canvas.x - anchor.x, canvas.y - anchor.y));
    const targets: { index: number; value: number }[] = [];
    if (input.r !== undefined) targets.push({ index: input.r, value: radius });
    if (input.rx !== undefined) targets.push({ index: input.rx, value: radius });
    if (input.ry !== undefined) targets.push({ index: input.ry, value: radius });
    if (input.width !== undefined) targets.push({ index: input.width, value: radius * 2 });
    if (input.height !== undefined) targets.push({ index: input.height, value: radius * 2 });
    return targets;
  }

  private async flush(session: DragSession): Promise<void> {
    if (this.session !== session) return;
    if (session.inflight) return;
    const sent = session.last;
    session.inflight = (async () => {
      const scope = readScope(this.host.context.world, session.target.scopeId);
      const steps = scope ? readSolverConfig(scope.solverConfig).dragSteps : 2;
      try {
        await this.host.runtime.drag(session.target.scopeId, sent, steps);
      } catch (error) {
        console.error('[penrose] drag failed', error);
      }
      (this.host.context.world as { invalidateComputed?(): void }).invalidateComputed?.();
    })();
    await session.inflight;
    session.inflight = undefined;
    if (this.session === session && !session.ending && session.last !== sent) void this.flush(session);
  }

  private cancel(): void {
    if (!this.session) return;
    const session = this.session;
    this.session = undefined;
    this.host.runtime.dragging = false;
    void this.host.runtime.restore(session.target.scopeId, session.baseline).then(() => {
      (this.host.context.world as { invalidateComputed?(): void }).invalidateComputed?.();
      this.rebuild();
    });
  }
}

export type { HandleTarget };
