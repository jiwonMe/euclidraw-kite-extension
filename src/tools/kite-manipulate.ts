import type {
  ActivationContext, CanvasFrameScheduler, CanvasToolSurface, CanvasToolSurfaceProvider, CompiledScope, EntityId,
  GizmoHit, MemberPins, MutablePoint, ScopeProps, ScratchOverlay,
} from '../types.ts';
import { EXTENSION_ID, MEMBER_ASPECT_ID, SCOPE_ASPECT_ID } from '../manifest.ts';
import { toLocal, toWorld, scopeBox } from '../geometry.ts';
import { commitScopePatch } from './documents.ts';
import { compileCached, solveScope } from '../solver/runtime.ts';
import { layoutFor, memberPinsFrom, pointOf, radiusOf } from '../solver/solve.ts';
import { KiteDragSession } from './drag-session.ts';

const IDLE = 'root.select.core.select-suite:idle';
const POINT_PRIORITY = 45;
const POINT_HIT_PX = 8;
const DRAG_SLOP = 3.5;
const ACCENT = '#6A6CD9';

interface Gesture {
  pointer: number;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  shift: boolean;
  moved: boolean;
  scopeId: EntityId;
  scope: ScopeProps;
  compiled: CompiledScope;
  pins: MemberPins;
  box: ReturnType<typeof scopeBox> & object;
  instanceId: string;
  kind: 'point' | 'radius';
  session: KiteDragSession;
}

/**
 * Canvas → solver drag loop for Kite members.
 *
 * pointerdown adds a temporary soft pin, frames run the manifold solver inside
 * a ScratchOverlay, and pointerup writes one canonical patch in one Undo group.
 * Reading/rendering never takes this path.
 */
export class KiteManipulator {
  private readonly owner = `${EXTENSION_ID}:manipulate:${Math.random().toString(36).slice(2, 8)}`;
  private readonly disposers: (() => void)[] = [];
  private readonly gizmoDisposers: (() => void)[] = [];
  private bindAbort?: AbortController;
  private stateDisposer?: () => void;
  private scratch?: ScratchOverlay;
  private surface?: CanvasToolSurface;
  private hudSvg?: SVGSVGElement;
  private locus?: SVGPolylineElement;
  private badge?: HTMLElement;
  private gesture?: Gesture;
  private selectionKey = '';
  private composing = false;
  private compositionEnded = -Infinity;
  private disposed = false;

  constructor(private readonly context: ActivationContext) {
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) {
      this.bind(provider.get());
      this.disposers.push(provider.subscribe(() => this.bind(provider.get())));
    } else {
      this.bind(fallbackSurface(context));
    }
    const frames = context.services.get<CanvasFrameScheduler>('canvas.frames');
    this.disposers.push(frames ? frames.subscribe(() => this.tick()) : intervalTick(this.tick, 16));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.releaseSurface();
  }

  private bind(surface: CanvasToolSurface | undefined): void {
    if (this.disposed) return;
    if (surface === this.surface) return;
    this.releaseSurface();
    this.surface = surface;
    if (!surface) return;
    this.scratch = this.context.world.createScratchOverlay(this.owner);
    const doc = surface.surface.element.ownerDocument;
    this.bindAbort = new (surface.surface.element.ownerDocument.defaultView?.AbortController ?? AbortController)();
    const signal = this.bindAbort.signal;
    surface.surface.element.addEventListener('pointerdown', this.onPointerDown, { capture: true, signal });
    surface.surface.element.addEventListener('pointermove', this.onPointerMove, { capture: true, signal });
    surface.surface.element.addEventListener('pointerup', this.onPointerUp, { capture: true, signal });
    surface.surface.element.addEventListener('pointercancel', this.onPointerCancel, { capture: true, signal });
    surface.surface.element.addEventListener('lostpointercapture', this.onPointerCancel, { capture: true, signal });
    doc.addEventListener('keydown', this.onKeyDown, { capture: true, signal });
    doc.addEventListener('compositionstart', this.onCompositionStart, { signal });
    doc.addEventListener('compositionend', this.onCompositionEnd, { signal });
    doc.defaultView?.addEventListener('blur', this.cancel, { signal });
    this.stateDisposer = surface.selection.stateMachine.mountChildState('root.select', { id: `${EXTENSION_ID}:manipulate`, onExit: () => this.cancel() });
    this.buildHud(surface);
    this.rebuildGizmos();
  }

  private releaseSurface(): void {
    this.bindAbort?.abort();
    this.bindAbort = undefined;
    this.stateDisposer?.();
    this.stateDisposer = undefined;
    for (const dispose of this.gizmoDisposers.splice(0)) dispose();
    this.scratch?.dispose();
    this.scratch = undefined;
    this.hudSvg?.remove();
    this.hudSvg = undefined;
    this.locus = undefined;
    this.badge?.remove();
    this.badge = undefined;
    this.surface = undefined;
    this.gesture = undefined;
  }

  private buildHud(surface: CanvasToolSurface): void {
    const doc = surface.surface.element.ownerDocument;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    svg.dataset.role = 'kite-locus';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:4;';
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline') as SVGPolylineElement;
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', ACCENT);
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '5 5');
    line.setAttribute('stroke-opacity', '0.85');
    svg.append(line);
    surface.surface.hud.append(svg);
    this.hudSvg = svg;
    this.locus = line;
    const badge = doc.createElement('div');
    badge.dataset.role = 'kite-snap-badge';
    badge.style.cssText = 'position:absolute;pointer-events:none;padding:4px 8px;border-radius:6px;background:rgba(17,24,39,0.92);color:#f8fafc;font:600 11px/1.35 system-ui,-apple-system,sans-serif;white-space:nowrap;display:none;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,0.25);';
    surface.surface.hud.append(badge);
    this.badge = badge;
  }

  // ── gizmos ──────────────────────────────────────────────────────────────

  private editableTarget(): { scopeId: EntityId; substanceIds: Set<string>; circles: Set<string> } | undefined {
    if (!this.surface) return undefined;
    const ids = this.surface.selection.getSelection();
    for (const id of ids) {
      const scope = this.context.world.getCanonical<ScopeProps>(id, SCOPE_ASPECT_ID);
      if (scope) {
        const compiled = compileCached(scope);
        return { scopeId: id, substanceIds: new Set([...compiled.instances.values()].filter(instance => instance.kind === 'point').map(instance => instance.id)), circles: new Set([...compiled.instances.values()].filter(instance => instance.kind === 'circle').map(instance => instance.id)) };
      }
    }
    const substanceIds = new Set<string>();
    const circles = new Set<string>();
    let scopeId: EntityId | undefined;
    for (const id of ids) {
      const member = this.context.world.getCanonical<{ scopeId?: string; substanceId?: string }>(id, MEMBER_ASPECT_ID);
      if (!member?.scopeId || !member.substanceId) continue;
      const scope = this.context.world.getCanonical<ScopeProps>(member.scopeId, SCOPE_ASPECT_ID);
      if (!scope) continue;
      scopeId = member.scopeId;
      const compiled = compileCached(scope);
      const instance = compiled.instances.get(member.substanceId);
      if (!instance) continue;
      for (const key of ['a', 'b', 'center'] as const) if (instance[key]) substanceIds.add(instance[key]!);
      for (const point of instance.points ?? []) substanceIds.add(point);
      for (const point of instance.angle ?? []) substanceIds.add(point);
      if (instance.label?.anchor.id) substanceIds.add(instance.label.anchor.id);
      if (instance.kind === 'point') substanceIds.add(instance.id);
      if (instance.kind === 'circle') circles.add(instance.id);
      if (instance.kind === 'arc') substanceIds.add(instance.center ?? '');
    }
    return scopeId ? { scopeId, substanceIds, circles } : undefined;
  }

  private rebuildGizmos(): void {
    for (const dispose of this.gizmoDisposers.splice(0)) dispose();
    const surface = this.surface;
    const target = this.editableTarget();
    if (!surface || !target) return;
    const scope = this.context.world.getCanonical<ScopeProps>(target.scopeId, SCOPE_ASPECT_ID);
    if (!scope) return;
    const compiled = compileCached(scope);
    for (const id of target.substanceIds) {
      if (!compiled.instances.has(id)) continue;
      const gizmoId = `${this.owner}|p|${target.scopeId}|${id}`;
      this.gizmoDisposers.push(surface.selection.gizmos.register({
        id: gizmoId,
        priority: POINT_PRIORITY,
        shape: 'circle',
        radiusScreenPx: POINT_HIT_PX,
        getWorldPosition: out => this.handleWorld(target.scopeId, id, undefined, out),
        onPointerDown: event => this.begin(target.scopeId, id, 'point', event),
      }));
    }
    for (const id of target.circles) {
      if (!compiled.instances.has(id)) continue;
      const gizmoId = `${this.owner}|r|${target.scopeId}|${id}`;
      this.gizmoDisposers.push(surface.selection.gizmos.register({
        id: gizmoId,
        priority: POINT_PRIORITY,
        shape: 'circle',
        radiusScreenPx: POINT_HIT_PX,
        getWorldPosition: out => this.handleWorld(target.scopeId, id, 'radius', out),
        onPointerDown: event => this.begin(target.scopeId, id, 'radius', event),
      }));
    }
  }

  private handleWorld(scopeId: EntityId, instanceId: string, kind: 'radius' | undefined, out: MutablePoint): boolean {
    const scope = this.context.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID);
    const box = scopeBox(scopeId, this.context.world.getCanonicalView());
    if (!scope || !box || this.context.world.isEntityReadOnly(scopeId)) return false;
    const compiled = compileCached(scope);
    const solved = solveScope(scope, this.context.world.getCanonicalView());
    const layout = layoutFor(compiled, solved.pins);
    layout.values.set(solved.state.values);
    if (kind === 'radius') {
      const center = pointOf(layout, compiled.instances.get(instanceId)?.center ?? '');
      const world = toWorld(box, center.x + radiusOf(layout, instanceId), center.y);
      out.x = world.x; out.y = world.y;
    } else {
      const point = pointOf(layout, instanceId);
      const world = toWorld(box, point.x, point.y);
      out.x = world.x; out.y = world.y;
    }
    return true;
  }

  // ── gesture lifecycle ──────────────────────────────────────────────────

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.gesture || event.button !== 0 || event.defaultPrevented || this.imeLocked() || this.surface?.host.isPanGesture?.(event) || this.surface?.host.isSelectionEnabled?.() === false) return;
    if (inputOwned(event)) return;
    const hit = { id: '', priority: 0, distanceScreenPx: 0 } as GizmoHit;
    if (this.surface?.selection.gizmos.hitTest(event.clientX, event.clientY, this.surface.host.worldToScreen, hit)) {
      const [, kind, scopeId, instanceId] = hit.id.split('|');
      if (hit.id.startsWith(`${this.owner}|`) && scopeId && instanceId) {
        const parsedKind = kind === 'r' ? 'radius' : 'point';
        if (this.begin(scopeId, instanceId, parsedKind, event)) return;
      }
    }
    // Hosts without a gizmo registry still get direct point dragging.
    const target = this.editableTarget();
    if (!target) return;
    const scope = this.context.world.getCanonical<ScopeProps>(target.scopeId, SCOPE_ASPECT_ID);
    const box = scopeBox(target.scopeId, this.context.world.getCanonicalView());
    if (!scope || !box) return;
    const worldPoint = { x: 0, y: 0 };
    this.surface!.host.screenToWorld(event.clientX, event.clientY, worldPoint);
    const local = toLocal(box, worldPoint.x, worldPoint.y);
    const compiled = compileCached(scope);
    const solved = solveScope(scope, this.context.world.getCanonicalView());
    const layout = layoutFor(compiled, solved.pins);
    layout.values.set(solved.state.values);
    const threshold = POINT_HIT_PX / Math.max(0.001, this.surface!.host.getZoom());
    let nearest: { id: string; distance: number } | undefined;
    for (const id of target.substanceIds) {
      const point = pointOf(layout, id);
      const distance = Math.hypot(point.x - local.x, point.y - local.y);
      if (distance <= threshold && (!nearest || distance < nearest.distance)) nearest = { id, distance };
    }
    if (nearest) this.begin(target.scopeId, nearest.id, 'point', event);
  };

  private begin(scopeId: EntityId, instanceId: string, kind: 'point' | 'radius', event: PointerEvent): boolean {
    if (!this.surface || this.gesture) return false;
    const scope = this.context.world.getCanonical<ScopeProps>(scopeId, SCOPE_ASPECT_ID);
    const box = scopeBox(scopeId, this.context.world.getCanonicalView());
    if (!scope || !box || this.context.world.isEntityReadOnly(scopeId)) return false;
    const compiled = compileCached(scope);
    if (!compiled.ok) { this.report(new Error(compiled.errors[0]?.message ?? 'Kite DSL 오류')); return false; }
    const pins = memberPinsFrom(compiled, this.context.world.getCanonicalView());
    const parsedScope: ScopeProps = { ...scope, solverConfig: { ...scope.solverConfig } };
    const session = new KiteDragSession(parsedScope, compiled, pins, instanceId, kind);
    this.gesture = {
      pointer: event.pointerId,
      clientX: event.clientX, clientY: event.clientY,
      startX: event.clientX, startY: event.clientY,
      shift: event.shiftKey, moved: false,
      scopeId, scope: parsedScope, compiled, pins, box, instanceId, kind, session,
    };
    this.surface.selection.stateMachine.transition(`root.select.${EXTENSION_ID}:manipulate`);
    this.surface.surface.element.setPointerCapture?.(event.pointerId);
    this.updateBadge();
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.clientX = event.clientX; gesture.clientY = event.clientY;
    gesture.shift = event.shiftKey;
    gesture.moved ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= DRAG_SLOP;
    this.updateBadge();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.clientX = event.clientX; gesture.clientY = event.clientY;
    gesture.moved ||= Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= DRAG_SLOP;
    if (gesture.moved) this.applyGesture();
    const result = gesture.session.finish();
    const substanceChanged = result.substanceDsl !== gesture.scope.substanceDsl;
    this.finishGesture();
    if (gesture.moved && (substanceChanged || JSON.stringify(result.seeds) !== JSON.stringify(gesture.scope.convergedSeeds))) {
      const patch: Record<string, unknown> = { convergedSeeds: result.seeds };
      if (substanceChanged) patch.substanceDsl = result.substanceDsl;
      try {
        commitScopePatch(this.context, gesture.scopeId, patch, 'manipulate');
      } catch (error) {
        this.report(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.surface?.host.requestRender();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (this.gesture && this.gesture.pointer !== event.pointerId) return;
    this.cancel();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.gesture || this.imeLocked(event)) return;
    this.cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onCompositionStart = () => { this.composing = true; };
  private readonly onCompositionEnd = () => { this.composing = false; this.compositionEnded = performance.now(); };

  private cancel = (): void => {
    if (!this.gesture) return;
    this.finishGesture();
    this.surface?.host.requestRender();
  };

  private finishGesture(): void {
    const gesture = this.gesture;
    this.gesture = undefined;
    this.scratch?.clear();
    this.locus?.setAttribute('points', '');
    if (this.badge) this.badge.style.display = 'none';
    if (this.surface) {
      try { this.surface.selection.stateMachine.transition(IDLE); } catch { /* other tool owns the state */ }
      if (gesture) {
        try { this.surface.surface.element.releasePointerCapture?.(gesture.pointer); } catch { /* already released */ }
      }
    }
  }

  private tick(): void {
    if (this.disposed || !this.surface) return;
    const key = this.surface.selection.getSelection().join(',');
    if (key !== this.selectionKey) { this.selectionKey = key; this.rebuildGizmos(); }
    if (this.gesture?.moved) this.applyGesture();
  }

  private applyGesture(): void {
    const gesture = this.gesture;
    if (!gesture || !this.surface) return;
    const worldPoint = { x: 0, y: 0 };
    this.surface.host.screenToWorld(gesture.clientX, gesture.clientY, worldPoint);
    const local = toLocal(gesture.box, worldPoint.x, worldPoint.y);
    const snap = 14 / Math.max(0.001, this.surface.host.getZoom());
    const frame = gesture.session.moveTo(local.x, local.y, gesture.shift, snap);
    this.scratch?.set(gesture.scopeId, SCOPE_ASPECT_ID, { convergedSeeds: frame.seeds });
    this.updateLocus();
    this.updateBadge();
    this.surface.host.requestRender();
  }

  private updateBadge(): void {
    const gesture = this.gesture;
    if (!this.badge || !this.surface) return;
    if (!gesture || !gesture.moved) { this.badge.style.display = 'none'; return; }
    const promotion = gesture.session.currentPromotion();
    this.badge.textContent = promotion ? promotion.text : `Kite · ${gesture.instanceId}`;
    this.badge.style.display = 'block';
    const hud = this.surface.surface.hud.getBoundingClientRect();
    const element = this.surface.surface.element.getBoundingClientRect();
    this.badge.style.left = `${gesture.clientX - (hud.width ? hud.left : element.left) + 14}px`;
    this.badge.style.top = `${gesture.clientY - (hud.width ? hud.top : element.top) - 30}px`;
    this.badge.style.color = promotion ? '#fef3c7' : '#f8fafc';
  }

  private updateLocus(): void {
    const gesture = this.gesture;
    if (!gesture || !this.locus || !this.surface) return;
    const points = locusPoints(gesture, this.surface);
    this.locus.setAttribute('points', points);
  }

  private imeLocked(event?: KeyboardEvent): boolean {
    return this.composing || Boolean(event && (event.isComposing || event.keyCode === 229 || event.key === 'Process')) || performance.now() - this.compositionEnded < 16;
  }

  private report(error: Error): void {
    this.surface?.host.onError?.(error);
  }
}

function locusPoints(gesture: Gesture, surface: CanvasToolSurface): string {
  const layout = layoutFor(gesture.compiled, gesture.pins);
  layout.values.set(gesture.session.currentState().values);
  const samples: { x: number; y: number }[] = [];
  const viewPoint = { x: 0, y: 0 };
  const hud = surface.surface.hud.getBoundingClientRect(), element = surface.surface.element.getBoundingClientRect();
  const offsetX = hud.width ? hud.left : element.left, offsetY = hud.width ? hud.top : element.top;
  const push = (local: { x: number; y: number }) => {
    const world = toWorld(gesture.box, local.x, local.y);
    surface.host.worldToScreen(world.x, world.y, viewPoint);
    samples.push({ x: viewPoint.x - offsetX, y: viewPoint.y - offsetY });
  };
  for (const constraint of gesture.compiled.constraints) {
    if (constraint.type === 'onCircle' && constraint.point === gesture.instanceId) {
      const center = pointOf(layout, gesture.compiled.instances.get(constraint.circle)?.center ?? ''), radius = radiusOf(layout, constraint.circle);
      for (let index = 0; index <= 72; index++) {
        const angle = index / 72 * Math.PI * 2;
        push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
      }
      break;
    }
    if (constraint.type === 'distance' && (constraint.a === gesture.instanceId || constraint.b === gesture.instanceId)) {
      const other = constraint.a === gesture.instanceId ? constraint.b : constraint.a;
      const center = pointOf(layout, other);
      for (let index = 0; index <= 72; index++) {
        const angle = index / 72 * Math.PI * 2;
        push({ x: center.x + Math.cos(angle) * constraint.value, y: center.y + Math.sin(angle) * constraint.value });
      }
      break;
    }
    if ((constraint.type === 'horizontal' || constraint.type === 'vertical') && !samples.length) {
      const instance = gesture.compiled.instances.get(constraint.segment);
      if (!instance || (instance.a !== gesture.instanceId && instance.b !== gesture.instanceId)) continue;
      const point = pointOf(layout, gesture.instanceId);
      if (constraint.type === 'horizontal') { push({ x: 0, y: point.y }); push({ x: gesture.box.width, y: point.y }); }
      else { push({ x: point.x, y: 0 }); push({ x: point.x, y: gesture.box.height }); }
      break;
    }
  }
  return samples.map(point => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ');
}

function fallbackSurface(context: ActivationContext): CanvasToolSurface | undefined {
  const shell = context.services.get<{ element?: HTMLElement; hud?: HTMLElement }>('canvas.surface');
  const interaction = context.services.get<{
    screenToWorld?(x: number, y: number, out: MutablePoint): void;
    worldToScreen?(x: number, y: number, out: MutablePoint): void;
    getZoom?(): number;
    requestRender?(): void;
    history?: { begin(): void; commit(): void; abort(): void };
    onSelectionChanged?(ids: readonly EntityId[]): void;
  }>('canvas.interaction');
  const suite = context.services.get<{ getSelection?(): readonly EntityId[]; select?(id: EntityId | null): void }>('canvas.selection');
  if (!shell?.element || !shell.hud) return undefined;
  return {
    surface: { element: shell.element, hud: shell.hud },
    selection: {
      stateMachine: { stateId: 'root', mountChildState: () => () => {}, transition: () => {} },
      gizmos: { register: () => () => {}, hitTest: () => false },
      getSelection: () => [...(suite?.getSelection?.() ?? [])],
      select: id => suite?.select?.(id),
    },
    host: {
      screenToWorld: (x, y, out) => interaction?.screenToWorld?.(x, y, out),
      worldToScreen: (x, y, out) => interaction?.worldToScreen?.(x, y, out),
      getZoom: () => interaction?.getZoom?.() ?? 1,
      requestRender: () => interaction?.requestRender?.(),
      history: interaction?.history ?? { begin() {}, commit() {}, abort() {} },
      onError: error => console.error('[kite]', error),
    },
  };
}

function inputOwned(event: Event): boolean {
  const blocked = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-canvas-ui],button,input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  return blocked(event.target) || event.composedPath().some(blocked);
}

function intervalTick(run: () => void, ms: number): () => void {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
}

