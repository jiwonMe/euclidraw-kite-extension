import type { ActivationContext, CanvasFrameScheduler, CanvasToolSurface, CanvasToolSurfaceProvider, EntityId, GizmoHit, MutablePoint, ScratchOverlay } from '../host.ts';
import type { CompiledScope } from '../dsl/compile.ts';
import type { SolvedGeometry } from '../computed-bridge.ts';
import { handleWorld } from '../aspect-specs.ts';
import { commitDrag, readScope, selectedIds } from '../documents.ts';
import { readScopeBox, toLocal } from '../geometry.ts';
import { COMPUTED, EXTENSION_ID } from '../manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, readSolverConfig, type KiteMemberAspect } from '../schema.ts';
import { DragSession, type DragTarget } from './drag-session.ts';
import type { SnapCandidate } from './snap.ts';

/**
 * PRD §5.1 / §7.1: canvas → solver drag loop.
 *
 * Registers point and radius handles as gizmos above select-suite's own
 * (priority 45 > resize 10). A press enters `root.select.kite.studio:manipulate`,
 * moves only a ScratchOverlay patch of `kite.scope.convergedSeeds` from the
 * host's single frame latch, and commits once on release. Escape, blur,
 * pointercancel and capture loss discard the overlay without writing.
 */

export const MANIPULATE_STATE = `${EXTENSION_ID}:manipulate`;
const IDLE = 'root.select.core.select-suite:idle';
const HANDLE_PRIORITY = 45;
const HANDLE_RADIUS_PX = 8;
const SLOP_PX = 3.5;

export interface ManipulatorEvents {
  /** Fired every frame of a drag and when it ends (Space 2A gizmos read it). */
  onFrame?(state: DragState | undefined): void;
  onError?(error: Error): void;
}

export interface DragState {
  readonly scopeId: EntityId;
  readonly compiled: CompiledScope;
  readonly dofs: Float64Array;
  readonly frame: SolvedGeometry['frame'];
  readonly primary: string;
  readonly snap: SnapCandidate | undefined;
  readonly residual: number;
  readonly elapsedMs: number;
  readonly pointer: { x: number; y: number };
}

interface Gesture {
  readonly pointer: number;
  readonly scopeId: EntityId;
  readonly startClient: { x: number; y: number };
  client: { x: number; y: number };
  shift: boolean;
  moved: boolean;
  session: DragSession;
  last?: DragState;
}

export class KiteManipulator {
  private readonly owner = `${EXTENSION_ID}:manipulate:${Math.random().toString(36).slice(2, 8)}`;
  private readonly disposers: (() => void)[] = [];
  private readonly handleDisposers: (() => void)[] = [];
  private surface?: CanvasToolSurface;
  private surfaceAbort?: AbortController;
  private stateOff?: () => void;
  private scratch?: ScratchOverlay;
  private gesture?: Gesture;
  private handleKey = '';
  private composing = false;
  private compositionEnded = -Infinity;
  private disposed = false;
  private readonly hit: GizmoHit = { id: '', priority: 0, distanceScreenPx: 0 };

  constructor(private readonly context: ActivationContext, private readonly events: ManipulatorEvents = {}) {
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) {
      this.bind(provider.get());
      this.disposers.push(provider.subscribe(() => this.bind(provider.get())));
    }
    const frames = context.services.get<CanvasFrameScheduler>('canvas.frames');
    if (frames) this.disposers.push(frames.subscribe(() => this.frame()));
    this.disposers.push(context.world.subscribe(() => { this.handleKey = ''; }));
  }

  /** The scope whose solved geometry comes from the overlay this frame. */
  interactiveScope(): EntityId | undefined { return this.gesture?.moved ? this.gesture.scopeId : undefined; }
  get dragging(): boolean { return Boolean(this.gesture); }
  /** Wasm solve time of the last interactive frame (ms), for diagnostics/benchmarks. */
  lastSolveMs = 0;

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    for (const off of this.disposers.splice(0).reverse()) off();
    this.unbind();
  }

  private bind(surface: CanvasToolSurface | undefined): void {
    if (this.disposed || surface === this.surface) return;
    this.cancel();
    this.unbind();
    this.surface = surface;
    if (!surface) return;
    const element = surface.surface.element, doc = element.ownerDocument;
    this.surfaceAbort = new (doc.defaultView?.AbortController ?? AbortController)();
    const signal = this.surfaceAbort.signal;
    element.addEventListener('pointermove', this.onMove, { capture: true, signal });
    element.addEventListener('pointerup', this.onUp, { capture: true, signal });
    element.addEventListener('pointercancel', this.onCancel, { capture: true, signal });
    element.addEventListener('lostpointercapture', this.onCancel, { capture: true, signal });
    doc.addEventListener('keydown', this.onKey, { capture: true, signal });
    doc.addEventListener('keyup', this.onModifier, { capture: true, signal });
    doc.addEventListener('compositionstart', () => { this.composing = true; this.cancel(); }, { capture: true, signal });
    doc.addEventListener('compositionend', () => { this.composing = false; this.compositionEnded = now(); }, { capture: true, signal });
    doc.defaultView?.addEventListener('blur', () => this.cancel(), { signal });
    this.scratch = this.context.world.createScratchOverlay(this.owner);
    try {
      this.stateOff = surface.selection.stateMachine.mountChildState('root.select', {
        id: MANIPULATE_STATE,
        onExit: () => { if (this.gesture) this.cancel(); },
        onModifiersChanged: (_context, modifiers) => { if (this.gesture) this.gesture.shift = modifiers.shift; },
      });
    } catch { this.stateOff = undefined; }
    this.handleKey = '';
  }

  private unbind(): void {
    for (const off of this.handleDisposers.splice(0)) off();
    this.surfaceAbort?.abort();
    this.surfaceAbort = undefined;
    this.stateOff?.();
    this.stateOff = undefined;
    this.scratch?.dispose();
    this.scratch = undefined;
    this.surface = undefined;
  }

  // ── handles ─────────────────────────────────────────────────────────────

  /** Members (and their defining points) the current selection exposes. */
  private editable(): { scopeId: EntityId; ids: Set<string> } | undefined {
    if (!this.surface) return undefined;
    const world = this.context.world;
    let scopeId: EntityId | undefined;
    const ids = new Set<string>();
    for (const id of this.surface.selection.getSelection()) {
      const member = world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      const scope = member ? member.scopeId : world.getCanonical(id, SCOPE_ASPECT) ? id : undefined;
      if (!scope || (scopeId && scope !== scopeId)) continue;
      scopeId = scope;
      const compiled = world.getComputed<CompiledScope>(scope, COMPUTED.compiledVm);
      if (!compiled?.ok) continue;
      if (!member) { for (const slot of compiled.dofs) ids.add(slot.substanceId); continue; }
      const instance = compiled.instances[member.substanceId];
      if (!instance) continue;
      if (instance.kind === 'point' || instance.kind === 'circle' || instance.kind === 'arc') ids.add(instance.id);
      for (const ref of [instance.a, instance.b, instance.center, instance.through, ...(instance.vertices ?? []), ...(instance.angle ?? [])]) if (ref) ids.add(ref);
    }
    return scopeId && ids.size ? { scopeId, ids } : undefined;
  }

  private rebuildHandles(): void {
    const surface = this.surface;
    const target = this.editable();
    const key = target ? `${target.scopeId}:${[...target.ids].sort().join(',')}` : '';
    if (key === this.handleKey) return;
    this.handleKey = key;
    for (const off of this.handleDisposers.splice(0)) off();
    if (!surface || !target || this.context.world.isEntityReadOnly(target.scopeId)) return;
    for (const substanceId of target.ids) {
      this.handleDisposers.push(surface.selection.gizmos.register({
        id: `${this.owner}|${target.scopeId}|${substanceId}`,
        priority: HANDLE_PRIORITY,
        shape: 'circle',
        radiusScreenPx: HANDLE_RADIUS_PX,
        getWorldPosition: (out: MutablePoint) => this.handlePosition(target.scopeId, substanceId, out),
        onPointerDown: (event: PointerEvent) => this.begin(target.scopeId, substanceId, event),
      }));
    }
  }

  private handlePosition(scopeId: EntityId, substanceId: string, out: MutablePoint): boolean {
    const view = this.context.world.getPreviewView();
    const compiled = view.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
    const solved = view.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
    const point = compiled && solved ? handleWorld(compiled, solved, substanceId) : undefined;
    if (!point) return false;
    out.x = point.x; out.y = point.y;
    return true;
  }

  /** Programmatic hit test for hosts whose gizmo dispatch is not wired (tests, embeds). */
  hitHandle(clientX: number, clientY: number, event: PointerEvent): boolean {
    const surface = this.surface;
    if (!surface) return false;
    this.rebuildHandles();
    if (!surface.selection.gizmos.hitTest(clientX, clientY, surface.host.worldToScreen, this.hit) || !this.hit.id.startsWith(`${this.owner}|`)) return false;
    const [, scopeId, substanceId] = this.hit.id.split('|');
    return Boolean(scopeId && substanceId && this.begin(scopeId, substanceId, event));
  }

  // ── gesture ─────────────────────────────────────────────────────────────

  private imeLocked(event?: KeyboardEvent | PointerEvent): boolean {
    return this.composing || now() - this.compositionEnded < 16 || Boolean(event && 'isComposing' in event && (event.isComposing || (event as KeyboardEvent).keyCode === 229 || (event as KeyboardEvent).key === 'Process'));
  }

  begin(scopeId: EntityId, substanceId: string, event: PointerEvent): boolean {
    const surface = this.surface;
    const world = this.context.world;
    if (!surface || this.gesture || event.button !== 0 || this.imeLocked() || event.getModifierState?.('AltGraph')) return false;
    if (surface.host.isSelectionEnabled?.() === false || surface.host.isPanGesture?.(event) || world.isEntityReadOnly(scopeId)) return false;
    const view = world.getCanonicalView();
    const compiled = view.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
    const solved = view.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
    const scope = readScope(world, scopeId);
    if (!compiled?.ok || !solved || !scope) return false;
    const pointer = { x: 0, y: 0 };
    surface.host.screenToWorld(event.clientX, event.clientY, pointer);
    const local = toLocal(solved.frame, pointer.x, pointer.y);
    // Multi-selection drags every selected point together (rigid translation
    // as far as the constraints allow); otherwise just the grabbed DOF.
    const targets: DragTarget[] = [];
    const selected = this.selectedPoints(scopeId, compiled);
    const pinsOf = (id: string) => world.getCanonical<KiteMemberAspect>(compiled.bindings[id] ?? '', MEMBER_ASPECT);
    const ids = selected.includes(substanceId) ? selected : [substanceId];
    for (const id of ids.slice(0, 8)) {
      const slot = compiled.dofs.find(entry => entry.substanceId === id);
      if (!slot || slot.fixed) continue;
      const member = pinsOf(id);
      if ((member?.pinnedDofs?.length ?? 0) >= (slot.kind === 'point' ? 2 : 1)) continue;
      const grab = slot.kind === 'point'
        ? { x: local.x - solved.dofs[slot.off]!, y: local.y - solved.dofs[slot.off + 1]! }
        : { x: radiusGrab(compiled, solved, id, local), y: 0 };
      targets.push({ substanceId: id, kind: slot.kind, grab, slackWeight: Number(member?.slackWeight) > 0 ? Number(member!.slackWeight) : 1 });
    }
    if (!targets.length) return false;
    const pins: number[] = [];
    for (const slot of compiled.dofs) for (const local of pinsOf(slot.substanceId)?.pinnedDofs ?? []) if (Number.isInteger(local) && local >= 0 && local < (slot.kind === 'point' ? 2 : 1)) pins.push(slot.off + local);
    const config = readSolverConfig(scope.solverConfig);
    const session = new DragSession(compiled, solved.frame, solved.dofs, pins, targets, config.maxSubstepsPerFrame, config.damping, pointer);
    this.gesture = { pointer: event.pointerId, scopeId, startClient: { x: event.clientX, y: event.clientY }, client: { x: event.clientX, y: event.clientY }, shift: event.shiftKey && config.autoPromoteSnap, moved: false, session };
    try { surface.selection.stateMachine.transition(`root.select.${MANIPULATE_STATE}`); } catch { /* host without this slot */ }
    try { surface.surface.element.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  private selectedPoints(scopeId: EntityId, compiled: CompiledScope): string[] {
    const world = this.context.world;
    const out: string[] = [];
    for (const id of selectedIds(this.context)) {
      const member = world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (member?.scopeId === scopeId && compiled.dofs.some(slot => slot.substanceId === member.substanceId)) out.push(member.substanceId);
    }
    return out;
  }

  private readonly onMove = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.client = { x: event.clientX, y: event.clientY };
    const config = readSolverConfig(readScope(this.context.world, gesture.scopeId)?.solverConfig);
    gesture.shift = event.shiftKey && config.autoPromoteSnap;
    gesture.moved ||= Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) >= SLOP_PX;
    // Input only records the target; solving happens in the frame latch.
    this.surface?.host.requestRender();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    gesture.client = { x: event.clientX, y: event.clientY };
    gesture.moved ||= Math.hypot(event.clientX - gesture.startClient.x, event.clientY - gesture.startClient.y) >= SLOP_PX;
    if (gesture.moved) this.advance(gesture);
    const result = gesture.session.finish();
    this.end(gesture);
    if (gesture.moved && (result.changed || result.promoted)) {
      try { commitDrag(this.context, gesture.scopeId, result.seeds, result.promoted); }
      catch (error) { this.report(error); }
    }
    this.surface?.host.requestRender();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onCancel = (event: PointerEvent) => { if (this.gesture?.pointer === event.pointerId) this.cancel(); };

  private readonly onKey = (event: KeyboardEvent) => {
    if (!this.gesture || this.imeLocked(event)) return;
    if (event.key === 'Escape') { this.cancel(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    this.onModifier(event);
  };

  private readonly onModifier = (event: KeyboardEvent) => {
    if (!this.gesture || this.imeLocked(event) || event.getModifierState?.('AltGraph')) return;
    this.gesture.shift = event.shiftKey;
    this.surface?.host.requestRender();
  };

  cancel(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    gesture.session.dispose();
    this.end(gesture);
    this.surface?.host.requestRender();
  }

  private end(gesture: Gesture): void {
    this.gesture = undefined;
    this.scratch?.clear();
    try { this.surface?.surface.element.releasePointerCapture?.(gesture.pointer); } catch { /* released */ }
    try { if (this.surface?.selection.stateMachine.stateId.endsWith(MANIPULATE_STATE)) this.surface.selection.stateMachine.transition(IDLE); } catch { /* idle not mounted */ }
    this.events.onFrame?.(undefined);
  }

  /** Host frame latch: solve, write the overlay, notify the gizmo planes. */
  frame(): void {
    if (this.disposed) return;
    if (!this.gesture) { this.rebuildHandles(); return; }
    if (this.gesture.moved) this.advance(this.gesture);
  }

  private advance(gesture: Gesture): void {
    const surface = this.surface;
    if (!surface) return;
    const pointer = { x: 0, y: 0 };
    surface.host.screenToWorld(gesture.client.x, gesture.client.y, pointer);
    gesture.session.update(pointer, gesture.shift);
    let result;
    try { result = gesture.session.frameStep(); }
    catch (error) { this.report(error); this.cancel(); return; }
    this.lastSolveMs = result.elapsedMs;
    this.scratch?.set(gesture.scopeId, SCOPE_ASPECT, { convergedSeeds: result.seeds });
    gesture.last = {
      scopeId: gesture.scopeId, compiled: gesture.session.compiled, dofs: Float64Array.from(result.dofs),
      frame: frameOf(this.context, gesture.scopeId, gesture.session.compiled), primary: gesture.session.targets[0]!.substanceId,
      snap: result.snap, residual: result.residual, elapsedMs: result.elapsedMs, pointer,
    };
    this.events.onFrame?.(gesture.last);
  }

  private report(error: unknown): void {
    const value = error instanceof Error ? error : new Error(String(error));
    this.events.onError?.(value);
    this.surface?.host.onError?.(value);
  }
}

function radiusGrab(compiled: CompiledScope, solved: SolvedGeometry, id: string, local: { x: number; y: number }): number {
  const instance = compiled.instances[id]!;
  const centre = compiled.dofs.find(entry => entry.substanceId === instance.center);
  const radius = compiled.dofs.find(entry => entry.substanceId === id);
  if (!centre || !radius) return 0;
  return Math.hypot(local.x - solved.dofs[centre.off]!, local.y - solved.dofs[centre.off + 1]!) - solved.dofs[radius.off]!;
}

function frameOf(context: ActivationContext, scopeId: EntityId, compiled: CompiledScope): SolvedGeometry['frame'] {
  const solved = context.world.getCanonicalView().getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
  if (solved) return solved.frame;
  const box = readScopeBox(context.world.getCanonicalView(), scopeId)!;
  const scale = Math.min(box.width / compiled.canvas.width, box.height / compiled.canvas.height);
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, scale, rotation: box.rotation, ox: compiled.canvas.width / 2, oy: compiled.canvas.height / 2, halfW: box.width / 2 / scale, halfH: box.height / 2 / scale };
}

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
