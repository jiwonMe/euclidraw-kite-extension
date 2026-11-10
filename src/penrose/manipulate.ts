import type { CanvasToolSurface, CanvasToolSurfaceProvider, EntityId } from '../host.ts';
import { type CompiledScope, type SolvedLayout } from './computed.ts';
import { COMPUTED } from '../manifest.ts';
import { commitDrag, readScope, selectedIds, surfaceOf, type PenroseHost } from './documents.ts';
import { frameFor, readScopeBox, toCanvas, type Frame } from './frame.ts';
import { MEMBER_ASPECT, readSolverConfig, type PenroseMemberAspect } from './schema.ts';
import type { WireInputs } from './wire.ts';

interface HandleTarget {
  readonly scopeId: EntityId;
  readonly frame: Frame;
  readonly kind: 'move' | 'scale' | 'computed' | 'rotate';
  readonly input?: WireInputs;
  readonly computedId?: string;
}

/** Point-like drags go through the worker's Jacobian instead of input re-pins. */
const isPointKind = (kind: HandleTarget['kind']): boolean => kind === 'computed' || kind === 'rotate';

interface DragSession {
  readonly target: HandleTarget;
  readonly baseline: readonly number[];
  readonly startCanvas: { x: number; y: number };
  last: { index: number; value: number }[];
  preview?: { x: number; y: number };
  inflight?: Promise<void>;
  ending: boolean;
  /** Latest pointer target and the target last sent to the worker. */
  raw?: { x: number; y: number };
  sent?: { x: number; y: number };
  ticker?: ReturnType<typeof setInterval>;
  finalizing: boolean;
  /** Rotation drag: pointer angle about `pivot` moves `base` on its circle. */
  rotate?: { pivot: { x: number; y: number }; radius: number; startAngle: number; base: { x: number; y: number } };
}

const HANDLE_PRIORITY = 45;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Paintable {
  readonly scopeId: EntityId;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly kind: 'move' | 'scale' | 'computed' | 'rotate';
  readonly path: string;
  readonly input?: WireInputs;
  readonly computedId?: string;
}

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

const round = (value: number): number => Math.round(value * 100) / 100;

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
  private paintables: Paintable[] = [];
  private overlay: SVGSVGElement | undefined;

  constructor(host: PenroseHost) {
    this.host = host;
    const { context } = host;
    const frames = context.services.get<{ subscribe(paint: () => void): () => void }>('canvas.frames');
    if (frames) this.listeners.push(frames.subscribe(() => { this.refresh(); this.paintOverlay(); }));
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
    this.overlay?.remove();
    this.overlay = undefined;
    this.paintables = [];
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
    key += `selection:${selectedIds(context).slice().sort().join(',')}`;
    if (key !== this.lastKey) { this.lastKey = key; this.rebuild(); }
  }

  private rebuild(): void {
    if (this.session) return;
    this.clearHandles();
    this.paintables = [];
    const { context } = this.host;
    const surface = this.surface ?? surfaceOf(context);
    if (!surface) return;
    const registry = surface.selection.gizmos;
    // Gizmos are an affordance for the current selection only.
    const selectedScopes = new Set<EntityId>();
    const selectedOwners = new Map<EntityId, Set<string>>();
    for (const id of selectedIds(context)) {
      if (context.world.getCanonical(id, 'penrose.scope')) { selectedScopes.add(id); continue; }
      const member = context.world.getCanonical<PenroseMemberAspect>(id, MEMBER_ASPECT);
      if (!member?.scopeId || !member.ownerKey) continue;
      const owners = selectedOwners.get(member.scopeId) ?? new Set<string>();
      owners.add(member.ownerKey);
      selectedOwners.set(member.scopeId, owners);
    }
    if (!selectedScopes.size && !selectedOwners.size) return;
    for (const scopeId of this.scopes()) {
      if (context.world.isEntityReadOnly(scopeId)) continue;
      const showAll = selectedScopes.has(scopeId);
      const owners = selectedOwners.get(scopeId);
      if (!showAll && !owners?.size) continue;
      const scope = readScope(context.world, scopeId);
      const compiled = context.world.getComputed<CompiledScope>(scopeId, COMPUTED.compiled);
      const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
      const box = readScopeBox(this.previewView(), scopeId);
      if (!scope || !compiled || !layout || !box) continue;
      const pinned = new Set(scope.pins.map(pin => pin.index));
      const translatable = new Set(compiled.interactivity.translatable.map(input => input.path));
      const scalable = new Set(compiled.interactivity.scalable.map(input => input.path));
      const inputs = new Map<string, WireInputs>();
      for (const input of [...compiled.interactivity.translatable, ...compiled.interactivity.scalable]) inputs.set(input.path, input);
      for (const input of inputs.values()) {
        if (!input.owner) continue;
        if (!showAll && !owners?.has(input.owner)) continue;
        // Pinned inputs are not free: no handle until the pin is released.
        if (indexesOf(input).some(index => pinned.has(index))) continue;
        if (translatable.has(input.path)) this.addHandle(scopeId, layout.canvas, input, 'move', layout.varyingValues, registry);
        if (scalable.has(input.path)) this.addHandle(scopeId, layout.canvas, input, 'scale', layout.varyingValues, registry);
      }
      // Projected points: not direct inputs, but movable through their free
      // inputs. The worker owns the Jacobian; the main thread only drags.
      for (const handle of layout.computed) {
        if (!showAll && !(handle.owner && owners?.has(handle.owner))) continue;
        this.addComputedHandle(scopeId, layout.canvas, handle, registry);
      }
    }
    this.paintOverlay();
  }

  private addComputedHandle(
    scopeId: EntityId,
    canvas: { readonly width: number; readonly height: number },
    handle: { id: string; x: number; y: number; pivot?: { x: number; y: number } },
    registry: CanvasToolSurface['selection']['gizmos'],
  ): void {
    const handleId = handle.id;
    const off = registry.register({
      id: `penrose:${scopeId}:computed:${handleId}`,
      priority: HANDLE_PRIORITY - 1,
      shape: 'circle',
      radiusScreenPx: 6,
      getWorldPosition: out => {
        const frame = this.liveFrame(scopeId);
        const point = this.computedPoint(scopeId, handleId);
        if (!frame || !point) return false;
        const world = this.worldOfCanvas(frame, point);
        out.x = world.x; out.y = world.y;
        return true;
      },
      onPointerDown: event => {
        const surface = this.surface ?? surfaceOf(this.host.context);
        const frame = this.liveFrame(scopeId);
        if (!surface || !frame) return false;
        event.preventDefault();
        this.begin(scopeId, frame, { kind: 'computed', computedId: handleId }, event, surface);
        return true;
      },
    });
    this.disposeHandles.push(off);
    this.paintables.push({ scopeId, canvas, kind: 'computed', path: handleId, computedId: handleId });
    if (!handle.pivot) return;
    // Angular points get a second grip that rotates around the pivot instead of
    // translating: for a ray/arrow tip the underlying DOF is an angle.
    const rotation = registry.register({
      id: `penrose:${scopeId}:rotate:${handleId}`,
      priority: HANDLE_PRIORITY - 2,
      shape: 'circle',
      radiusScreenPx: 5,
      getWorldPosition: out => {
        const frame = this.liveFrame(scopeId);
        const live = this.computedHandle(scopeId, handleId);
        const anchor = live ? this.rotateAnchor(live) : undefined;
        if (!frame || !anchor) return false;
        const world = this.worldOfCanvas(frame, anchor);
        out.x = world.x; out.y = world.y;
        return true;
      },
      onPointerDown: event => {
        const surface = this.surface ?? surfaceOf(this.host.context);
        const frame = this.liveFrame(scopeId);
        if (!surface || !frame) return false;
        event.preventDefault();
        this.begin(scopeId, frame, { kind: 'rotate', computedId: handleId }, event, surface);
        return true;
      },
    });
    this.disposeHandles.push(rotation);
    this.paintables.push({ scopeId, canvas, kind: 'rotate', path: `${handleId}#rotate`, computedId: handleId });
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

  /** Transforms can live in a host ScratchOverlay while the user drags the scope. */
  private previewView() {
    const { context } = this.host;
    return context.world.getPreviewView?.() ?? context.world.getCanonicalView();
  }

  private liveValues(scopeId: EntityId): readonly number[] | undefined {
    return this.host.context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout)?.varyingValues;
  }

  private computedPoint(scopeId: EntityId, handleId: string): { x: number; y: number } | undefined {
    const handle = this.computedHandle(scopeId, handleId);
    return handle ? { x: handle.x, y: handle.y } : undefined;
  }

  private computedHandle(scopeId: EntityId, handleId: string) {
    return this.host.context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout)?.computed.find(entry => entry.id === handleId);
  }

  /** Centre of a rotation grip: between the point and its pivot. */
  private rotateAnchor(handle: { x: number; y: number; pivot?: { x: number; y: number } }): { x: number; y: number } | undefined {
    if (!handle.pivot) return undefined;
    return { x: (handle.x + handle.pivot.x) / 2, y: (handle.y + handle.pivot.y) / 2 };
  }

  private handlePoint(input: WireInputs, kind: 'move' | 'scale', values: readonly number[]): { x: number; y: number } | undefined {
    const anchor = this.canvasPoint(input, values);
    if (!anchor) return undefined;
    if (kind === 'move') return anchor;
    const offset = this.scaleOffset(input, values);
    return { x: anchor.x + offset.x, y: anchor.y + offset.y };
  }

  /** The scope frame is derived from the live canonical transform, never cached. */
  private liveFrame(scopeId: EntityId): Frame | undefined {
    const { context } = this.host;
    const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
    const box = readScopeBox(this.previewView(), scopeId);
    return layout && box ? frameFor(layout.canvas, box) : undefined;
  }

  private addHandle(
    scopeId: EntityId,
    canvas: { readonly width: number; readonly height: number },
    input: WireInputs,
    kind: 'move' | 'scale',
    values: readonly number[],
    registry: CanvasToolSurface['selection']['gizmos'],
  ): void {
    if (!this.canvasPoint(input, values)) return;
    const off = registry.register({
      id: `penrose:${scopeId}:${kind}:${input.path}`,
      priority: HANDLE_PRIORITY,
      shape: 'circle',
      radiusScreenPx: 6,
      getWorldPosition: out => {
        const frame = this.liveFrame(scopeId);
        const values = this.liveValues(scopeId);
        if (!frame || !values) return false;
        const point = this.handlePoint(input, kind, values);
        if (!point) return false;
        const world = this.worldOfCanvas(frame, point);
        out.x = world.x; out.y = world.y;
        return true;
      },
      onPointerDown: event => {
        const surface = this.surface ?? surfaceOf(this.host.context);
        const frame = this.liveFrame(scopeId);
        if (!surface || !frame) return false;
        event.preventDefault();
        this.begin(scopeId, frame, { kind, input }, event, surface);
        return true;
      },
    });
    this.disposeHandles.push(off);
    this.paintables.push({ scopeId, canvas, kind, path: input.path, input });
  }

  /** World gizmos are painted in screen pixels into the host HUD, never the document. */
  private paintOverlay(): void {
    const surface = this.surface ?? surfaceOf(this.host.context);
    if (!surface) return;
    const hud = surface.surface.hud;
    if (this.overlay && this.overlay.parentElement !== hud) {
      this.overlay.remove();
      this.overlay = undefined;
    }
    if (!this.overlay) {
      const doc = hud.ownerDocument;
      const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.dataset.role = 'penrose-gizmos';
      svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';
      hud.append(svg);
      this.overlay = svg;
    }
    const active = this.session;
    const screen = { x: 0, y: 0 };
    // `worldToScreen` returns client coordinates; the overlay lives inside the
    // HUD, so subtract its client origin or every handle drifts outside the scope.
    const hudRect = hud.getBoundingClientRect();
    const frames = new Map<EntityId, Frame | undefined>();
    const valuesOf = new Map<EntityId, readonly number[] | undefined>();
    const frameOf = (scopeId: EntityId) => {
      if (!frames.has(scopeId)) frames.set(scopeId, this.liveFrame(scopeId));
      return frames.get(scopeId);
    };
    const parts: string[] = [];
    for (const paintable of this.paintables) {
      const halfW = paintable.canvas.width / 2, halfH = paintable.canvas.height / 2;
      const isActive = !!active && active.target.scopeId === paintable.scopeId
        && active.target.kind === paintable.kind
        && (isPointKind(paintable.kind)
          ? active.target.computedId === paintable.computedId
          : active.target.input?.path === paintable.path);
      let point: { x: number; y: number } | undefined;
      if (paintable.kind === 'rotate') {
        const live = this.computedHandle(paintable.scopeId, paintable.computedId!);
        const current = isActive && active?.preview && active.rotate
          ? { x: active.preview.x, y: active.preview.y, pivot: active.rotate.pivot }
          : live;
        point = current ? this.rotateAnchor(current) : undefined;
      } else if (paintable.kind === 'computed') {
        // The dragged projected point follows the pointer immediately; others
        // come from the latest layout the worker produced.
        point = isActive && active?.preview ? active.preview : this.computedPoint(paintable.scopeId, paintable.computedId!);
      } else {
        if (!valuesOf.has(paintable.scopeId)) valuesOf.set(paintable.scopeId, this.liveValues(paintable.scopeId));
        let values = valuesOf.get(paintable.scopeId);
        if (!values || !paintable.input) continue;
        if (isActive && active) {
          const preview = [...values];
          for (const target of active.last) if (target.index >= 0 && target.index < preview.length) preview[target.index] = target.value;
          values = preview;
        }
        point = this.handlePoint(paintable.input, paintable.kind, values);
      }
      if (!point || Math.abs(point.x) > halfW || Math.abs(point.y) > halfH) continue;
      const frame = frameOf(paintable.scopeId);
      if (!frame) continue;
      const world = this.worldOfCanvas(frame, point);
      surface.host.worldToScreen(world.x, world.y, screen);
      const x = round(screen.x - hudRect.left);
      const y = round(screen.y - hudRect.top);
      // Round handles in the host's selection palette. Rotation grips are an
      // open dashed ring so they read differently from the solid move dots.
      parts.push(
        paintable.kind === 'rotate'
          ? `<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="var(--alid-accent,#008FF0)" stroke-width="1.25" stroke-dasharray="2 2" data-kind="rotate"/>`
          : `<circle cx="${x}" cy="${y}" r="4" ` +
            `fill="${isActive ? 'var(--alid-accent,#008FF0)' : '#ffffff'}" stroke="var(--alid-accent,#008FF0)" ` +
            `stroke-width="1.25" data-kind="${paintable.kind}"/>`,
      );
    }
    this.overlay.innerHTML = parts.join('');
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
    target: { kind: HandleTarget['kind']; input?: WireInputs; computedId?: string },
    event: PointerEvent,
    surface: CanvasToolSurface,
  ): void {
    this.cancel();
    const { context } = this.host;
    const layout = context.world.getComputed<SolvedLayout>(scopeId, COMPUTED.layout);
    if (!layout) return;
    const start = { x: 0, y: 0 };
    surface.host.screenToWorld(event.clientX, event.clientY, start);
    const startCanvas = this.canvasOfWorld(frame, start);
    const session: DragSession = {
      target: { scopeId, frame, ...target },
      baseline: [...layout.varyingValues],
      startCanvas,
      last: [],
      ending: false,
      raw: { ...startCanvas },
      sent: { ...startCanvas },
      finalizing: false,
    };
    if (target.kind === 'rotate' && target.computedId) {
      const handle = layout.computed.find(entry => entry.id === target.computedId);
      if (handle?.pivot) {
        const pivot = { ...handle.pivot };
        session.rotate = {
          pivot,
          radius: Math.hypot(handle.x - pivot.x, handle.y - pivot.y),
          startAngle: Math.atan2(startCanvas.y - pivot.y, startCanvas.x - pivot.x),
          base: { x: handle.x, y: handle.y },
        };
        session.preview = { x: handle.x, y: handle.y };
      }
    }
    this.session = session;
    this.host.runtime.dragging = true;

    const onMove = (move: PointerEvent) => {
      if (this.session !== session) return;
      const world = { x: 0, y: 0 };
      surface.host.screenToWorld(move.clientX, move.clientY, world);
      session.raw = this.canvasOfWorld(frame, world);
    };
    const onUp = (up: PointerEvent) => {
      if (this.session !== session) return;
      const world = { x: 0, y: 0 };
      surface.host.screenToWorld(up.clientX, up.clientY, world);
      session.raw = this.canvasOfWorld(frame, world);
      session.ending = true;
      void finalize();
    };
    const finalize = async () => {
        if (session.finalizing) return;
        session.finalizing = true;
        if (session.ticker) clearInterval(session.ticker);
        // The drop position is the pointer, not the eased preview.
        if (session.raw) {
          if (isPointKind(session.target.kind)) session.preview = this.pointerTarget(session);
          else session.last = this.targetsFor(session, session.raw);
        }
        {
        if (session.inflight) await session.inflight;
        const result = isPointKind(session.target.kind) && session.target.computedId
          ? await this.host.runtime.pointDrag(scopeId, session.target.computedId, session.preview ?? session.startCanvas, 0, 0)
          : await this.host.runtime.drag(scopeId, session.last, 0, 0);
        // One full re-convergence after release hardens what the capped-weight
        // drag frames left slightly soft.
        let values = result.varyingValues;
        try {
          const pins = isPointKind(session.target.kind) ? [] : session.last;
          // The drag stage already unions the geometry and arrow stages, so a
          // short pass on the same stage hardens `disjoint` without re-running
          // constraints the staged solve abandoned (which made the layout jump).
          const polished = await this.host.runtime.polish(scopeId, { budgetMs: 120, pins });
          values = polished.varyingValues;
          if (isPointKind(session.target.kind) && session.target.computedId) {
            const snapped = await this.host.runtime.pointDrag(scopeId, session.target.computedId, session.preview ?? session.startCanvas, 0, 0);
            values = snapped.varyingValues;
          }
          session.last = [];
          session.preview = undefined;
        } catch (error) {
          console.error('[penrose] post-drag polish failed', error);
        }
        if (this.session !== session) return;
        commitDrag(this.host, scopeId, values);
        this.session = undefined;
        this.host.runtime.dragging = false;
        cleanup();
        (context.world as { invalidateComputed?(): void }).invalidateComputed?.();
        this.rebuild();
        }
    };
    const onCancel = () => {
      if (this.session !== session) return;
      const saved = session.baseline;
      this.session = undefined;
      this.host.runtime.dragging = false;
      if (session.ticker) clearInterval(session.ticker);
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

    // Coalesce pointer events into frames. The target is the pointer itself:
    // no smoothing, so the shape tracks the cursor 1:1.
    session.ticker = setInterval(() => {
      if (this.session !== session || !session.raw || session.ending) return;
      const moved = !session.sent || Math.hypot(session.raw.x - session.sent.x, session.raw.y - session.sent.y) > 0.02;
      if (moved) {
        session.sent = { ...session.raw };
        if (isPointKind(session.target.kind)) session.preview = this.pointerTarget(session);
        else session.last = this.targetsFor(session, session.raw);
      }
      // Keep converging even while the pointer holds still: the optimizer needs
      // several bounded frames to move neighbours aside, and only reacting to
      // pointer deltas left the dropped shape overlapping them.
      void this.flush(session);
    }, 16);
  }

  /**
   * Where a point-like drag should send its derived point. A rotation grip
   * keeps the point on its circle around the pivot, so only the angle changes.
   */
  private pointerTarget(session: DragSession): { x: number; y: number } {
    const raw = session.raw ?? session.startCanvas;
    const rotate = session.rotate;
    if (!rotate) return { ...raw };
    const delta = Math.atan2(raw.y - rotate.pivot.y, raw.x - rotate.pivot.x) - rotate.startAngle;
    const cos = Math.cos(delta), sin = Math.sin(delta);
    const vx = rotate.base.x - rotate.pivot.x, vy = rotate.base.y - rotate.pivot.y;
    return { x: rotate.pivot.x + vx * cos - vy * sin, y: rotate.pivot.y + vx * sin + vy * cos };
  }

  private targetsFor(session: DragSession, canvas: { x: number; y: number }): { index: number; value: number }[] {
    const { input, kind } = session.target;
    const { baseline, startCanvas } = session;
    if (!input || isPointKind(kind)) return [];
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
    const sent = isPointKind(session.target.kind) ? session.preview : session.last;
    session.inflight = (async () => {
      const scope = readScope(this.host.context.world, session.target.scopeId);
      const config = scope ? readSolverConfig(scope.solverConfig) : { dragSteps: 2, dragBudgetMs: 0 };
      const steps = config.dragSteps;
      const budgetMs = config.dragBudgetMs;
      try {
        if (isPointKind(session.target.kind) && session.target.computedId) {
          await this.host.runtime.pointDrag(session.target.scopeId, session.target.computedId, session.preview ?? session.startCanvas, steps, budgetMs);
        } else {
          await this.host.runtime.drag(session.target.scopeId, session.last, steps, budgetMs);
        }
      } catch (error) {
        console.error('[penrose] drag failed', error);
      }
      (this.host.context.world as { invalidateComputed?(): void }).invalidateComputed?.();
    })();
    await session.inflight;
    session.inflight = undefined;
    const changed = isPointKind(session.target.kind)
      ? session.preview !== sent
      : session.last !== sent;
    if (this.session === session && !session.ending && changed) void this.flush(session);
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
