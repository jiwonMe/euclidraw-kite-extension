import type { ActivationContext, CanvasFrameScheduler, CanvasToolSurface, CanvasToolSurfaceProvider, EntityId } from '../host.ts';
import type { CompiledConstraint, CompiledScope } from '../dsl/compile.ts';
import type { SolvedGeometry } from '../computed-bridge.ts';
import { toWorld, type Point } from '../geometry.ts';
import { COMPUTED } from '../manifest.ts';
import { MEMBER_ASPECT, SCOPE_ASPECT, type KiteMemberAspect } from '../schema.ts';
import type { DragState } from '../tools/kite-manipulate.ts';
import { escapeXml, n } from './space1-renderer.ts';

/**
 * Space 2A (world gizmos, drawn in screen pixels above every document object):
 *
 *  • Locus guide — the 1-D manifold a hovered/dragged point can move on
 *    without breaking constraints, as a dashed #6A6CD9 path.
 *  • Constraint badges — // ⊥ = T 📌 ○ anchored to world positions.
 *  • Over-constrained heatmap — #FF4800 glow on members whose constraints
 *    carry residual stress (constraint_stress_buf).
 *  • Bi-directional highlight — the constraint the Tri-DSL cursor is on.
 *
 * Local UI state only. Painted from the host frame latch, never per event.
 */

export const LOCUS_COLOR = '#6A6CD9';
export const STRESS_COLOR = '#FF4800';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STRESS_THRESHOLD = 0.05;

const BADGE: Record<string, string> = {
  Parallel: '//', Perpendicular: '⊥', EqualLength: '=', Tangent: 'T', OnCircle: '○', OnLine: '—', Midpoint: '½',
  Distance: '↔', Coincident: '•', Horizontal: 'H', Vertical: 'V', Radius: 'r', AngleAt: '∠',
};

export interface HighlightState {
  /** Substance ids to emphasise (editor caret, hover). */
  ids: ReadonlySet<string>;
  /** Constraint lines to emphasise. */
  lines: ReadonlySet<number>;
  scopeId?: EntityId;
}

export class Space2AGizmos {
  private surface?: CanvasToolSurface;
  private svg?: SVGSVGElement;
  private drag?: DragState;
  private hover?: { scopeId: EntityId; substanceId: string };
  private highlight: HighlightState = { ids: new Set(), lines: new Set() };
  private markup = '';
  private readonly disposers: (() => void)[] = [];
  private surfaceAbort?: AbortController;

  constructor(private readonly context: ActivationContext) {
    const provider = context.services.get<CanvasToolSurfaceProvider>('canvas.active-tool-surface');
    if (provider) { this.bind(provider.get()); this.disposers.push(provider.subscribe(() => this.bind(provider.get()))); }
    const frames = context.services.get<CanvasFrameScheduler>('canvas.frames');
    if (frames) this.disposers.push(frames.subscribe(() => this.paint()));
  }

  setDrag(state: DragState | undefined): void { this.drag = state; }
  setHighlight(state: HighlightState): void { this.highlight = state; this.surface?.host.requestRender(); }
  getHover(): { scopeId: EntityId; substanceId: string } | undefined { return this.hover; }

  private bind(surface: CanvasToolSurface | undefined): void {
    if (surface === this.surface) return;
    this.svg?.remove();
    this.surfaceAbort?.abort();
    this.surface = surface;
    this.svg = undefined;
    this.markup = '';
    if (!surface) return;
    const doc = surface.surface.element.ownerDocument;
    const svg = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.dataset.role = 'kite-space2a';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';
    surface.surface.hud.append(svg);
    this.svg = svg;
    this.surfaceAbort = new (doc.defaultView?.AbortController ?? AbortController)();
    surface.surface.element.addEventListener('pointermove', event => this.track(event), { signal: this.surfaceAbort.signal, passive: true });
  }

  private track(event: PointerEvent): void {
    const surface = this.surface;
    if (!surface || this.drag) return;
    const world = { x: 0, y: 0 };
    surface.host.screenToWorld(event.clientX, event.clientY, world);
    const zoom = Math.max(surface.host.getZoom(), 1e-3), radius = 9 / zoom;
    let found: { scopeId: EntityId; substanceId: string } | undefined;
    for (const id of surface.selection.getSelection()) {
      const scopeId = this.context.world.getCanonical(id, SCOPE_ASPECT) ? id : this.context.world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT)?.scopeId;
      if (!scopeId) continue;
      const view = this.context.world.getPreviewView();
      const compiled = view.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm), solved = view.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
      if (!compiled || !solved) continue;
      for (const slot of compiled.dofs) {
        if (slot.kind !== 'point') continue;
        const p = toWorld(solved.frame, solved.dofs[slot.off]!, solved.dofs[slot.off + 1]!);
        if (Math.hypot(p.x - world.x, p.y - world.y) <= radius) { found = { scopeId, substanceId: slot.substanceId }; break; }
      }
      if (found) break;
    }
    if (found?.substanceId !== this.hover?.substanceId || found?.scopeId !== this.hover?.scopeId) { this.hover = found; surface.host.requestRender(); }
  }

  /** Scopes worth drawing: the dragged one, the selection's, the highlighted one. */
  private scopes(): EntityId[] {
    const world = this.context.world, ids = new Set<EntityId>();
    if (this.drag) ids.add(this.drag.scopeId);
    if (this.highlight.scopeId) ids.add(this.highlight.scopeId);
    for (const id of this.surface?.selection.getSelection() ?? []) {
      if (world.getCanonical(id, SCOPE_ASPECT)) ids.add(id);
      const member = world.getCanonical<KiteMemberAspect>(id, MEMBER_ASPECT);
      if (member?.scopeId) ids.add(member.scopeId);
    }
    return [...ids];
  }

  paint(): void {
    const surface = this.surface, svg = this.svg;
    if (!surface || !svg) return;
    const parts: string[] = [];
    const screen = (p: Point) => { const out = { x: 0, y: 0 }; surface.host.worldToScreen(p.x, p.y, out); const rect = surface.surface.hud.getBoundingClientRect(); return { x: out.x - rect.left, y: out.y - rect.top }; };
    for (const scopeId of this.scopes()) {
      const view = this.context.world.getPreviewView();
      const compiled = this.drag?.scopeId === scopeId ? this.drag.compiled : view.getComputed<CompiledScope>(scopeId, COMPUTED.compiledVm);
      const solved = view.getComputed<SolvedGeometry>(scopeId, COMPUTED.solvedGeometry);
      if (!compiled?.ok || !solved) continue;
      const dofs = this.drag?.scopeId === scopeId ? this.drag.dofs : solved.dofs;
      const frame = solved.frame;
      const pointOf = (id: string): Point | undefined => {
        const slot = compiled.dofs.find(entry => entry.substanceId === id && entry.kind === 'point');
        return slot ? toWorld(frame, dofs[slot.off]!, dofs[slot.off + 1]!) : undefined;
      };
      const radiusOf = (id: string) => { const slot = compiled.dofs.find(entry => entry.substanceId === id && entry.kind === 'scalar'); return slot ? dofs[slot.off]! * frame.scale : 0; };
      const focus = this.drag?.scopeId === scopeId ? this.drag.primary : this.hover?.scopeId === scopeId ? this.hover.substanceId : undefined;
      if (focus) parts.push(locus(compiled, focus, pointOf, radiusOf, screen, frame, dofs));
      // Over-constrained heatmap.
      for (const constraint of compiled.constraints) {
        const stress = solved.stress[constraint.index] ?? 0;
        if (constraint.soft || stress < STRESS_THRESHOLD) continue;
        const where = anchorOf(compiled, constraint, pointOf);
        if (!where) continue;
        const p = screen(where), opacity = Math.min(0.85, 0.25 + stress * 0.3);
        parts.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(10 + Math.min(10, stress * 4))}" fill="${STRESS_COLOR}" fill-opacity="${n(opacity * 0.25)}" stroke="${STRESS_COLOR}" stroke-opacity="${n(opacity)}" stroke-width="2"/>`);
      }
      // Badges.
      const placed: Point[] = [];
      for (const constraint of compiled.constraints) {
        const glyph = BADGE[constraint.predicate];
        const where = anchorOf(compiled, constraint, pointOf);
        if (!glyph || !where || constraint.implicit && constraint.predicate === 'OnCircle' && !focus) continue;
        let p = screen(where);
        p = { x: p.x + 12, y: p.y - 12 };
        while (placed.some(other => Math.hypot(other.x - p.x, other.y - p.y) < 16)) p = { x: p.x + 16, y: p.y };
        placed.push(p);
        const highlighted = this.highlight.scopeId === scopeId && (this.highlight.lines.has(constraint.line) || constraint.touches.some(id => this.highlight.ids.has(id)));
        const stressed = (solved.stress[constraint.index] ?? 0) >= STRESS_THRESHOLD && !constraint.soft;
        const fill = stressed ? STRESS_COLOR : highlighted ? LOCUS_COLOR : '#0f172a';
        parts.push(`<g data-kite-badge="${escapeXml(constraint.text)}"><rect x="${n(p.x - 8)}" y="${n(p.y - 8)}" width="16" height="16" rx="4" fill="${fill}" fill-opacity="${highlighted || stressed ? 1 : 0.78}"/><text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="#fff">${escapeXml(glyph)}</text></g>`);
      }
      // Pins.
      for (const slot of compiled.dofs) {
        const member = this.context.world.getCanonical<KiteMemberAspect>(compiled.bindings[slot.substanceId] ?? '', MEMBER_ASPECT);
        if (slot.kind !== 'point' || (!slot.fixed && !(member?.pinnedDofs?.length))) continue;
        const p = screen(pointOf(slot.substanceId)!);
        parts.push(`<text x="${n(p.x - 12)}" y="${n(p.y + 14)}" font-size="11" text-anchor="middle" data-kite-pin="${escapeXml(slot.substanceId)}">📌</text>`);
      }
      // Highlighted members (editor caret ↔ canvas).
      if (this.highlight.scopeId === scopeId) for (const id of this.highlight.ids) {
        const p = pointOf(id);
        if (p) { const s = screen(p); parts.push(`<circle cx="${n(s.x)}" cy="${n(s.y)}" r="9" fill="none" stroke="${LOCUS_COLOR}" stroke-width="2"/>`); }
      }
      // Snap promotion badge.
      if (this.drag?.scopeId === scopeId && this.drag.snap) {
        const p = screen(this.drag.pointer);
        const text = this.drag.snap.badge;
        const width = Math.max(120, text.length * 6.4 + 16);
        parts.push(`<g data-kite-snap="${escapeXml(this.drag.snap.statement)}"><rect x="${n(p.x + 14)}" y="${n(p.y - 32)}" width="${n(width)}" height="22" rx="6" fill="#111827" fill-opacity="0.92"/><text x="${n(p.x + 22)}" y="${n(p.y - 21)}" dominant-baseline="central" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="#fef3c7">${escapeXml(text)}</text></g>`);
      }
    }
    const markup = parts.join('');
    if (markup !== this.markup) { this.markup = markup; svg.innerHTML = markup; }
  }

  dispose(): void {
    for (const off of this.disposers.splice(0).reverse()) off();
    this.surfaceAbort?.abort();
    this.svg?.remove();
    this.svg = undefined;
    this.surface = undefined;
  }
}

function anchorOf(compiled: CompiledScope, constraint: CompiledConstraint, pointOf: (id: string) => Point | undefined): Point | undefined {
  const lineMid = (id: string) => { const instance = compiled.instances[id]; const a = instance?.a && pointOf(instance.a), b = instance?.b && pointOf(instance.b); return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined; };
  const first = constraint.args[0]!;
  const instance = compiled.instances[first];
  if (!instance) return undefined;
  if (instance.kind === 'point') return pointOf(first);
  if (instance.kind === 'segment' || instance.kind === 'line' || instance.kind === 'ray') return lineMid(first);
  if (instance.kind === 'circle' && instance.center) return pointOf(instance.center);
  return undefined;
}

/**
 * The 1-D manifold through the focused point, sampled from its constraints:
 * circle (OnCircle / Distance), line (OnLine, Horizontal, Vertical), or the
 * Thales circle when the point is the right-angle vertex of a Perpendicular.
 */
function locus(compiled: CompiledScope, focus: string, pointOf: (id: string) => Point | undefined, radiusOf: (id: string) => number, screen: (p: Point) => Point, frame: SolvedGeometry['frame'], dofs: ArrayLike<number>): string {
  const paths: string[] = [];
  const circle = (c: Point, r: number) => {
    let d = '';
    for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2, s = screen({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }); d += `${k ? 'L' : 'M'}${n(s.x)} ${n(s.y)}`; }
    paths.push(d);
  };
  const line = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, reach = Math.max(frame.halfW, frame.halfH) * frame.scale * 2.5;
    const p = screen({ x: a.x - dx / length * reach, y: a.y - dy / length * reach }), q = screen({ x: a.x + dx / length * reach, y: a.y + dy / length * reach });
    paths.push(`M${n(p.x)} ${n(p.y)}L${n(q.x)} ${n(q.y)}`);
  };
  const here = pointOf(focus);
  void dofs;
  for (const constraint of compiled.constraints) {
    if (!constraint.touches.includes(focus)) continue;
    const [a0, a1] = constraint.args;
    switch (constraint.predicate) {
      case 'OnCircle': if (a0 === focus) { const c = compiled.instances[a1!]?.center; const centre = c && pointOf(c); if (centre) circle(centre, radiusOf(a1!)); } break;
      case 'Distance': { const other = a0 === focus ? a1 : a0; const o = other && pointOf(other); if (o && (a0 === focus || a1 === focus)) circle(o, constraint.value * frame.scale); break; }
      case 'OnLine': if (a0 === focus) { const target = compiled.instances[a1!]; const p = target?.a && pointOf(target.a), q = target?.b && pointOf(target.b); if (p && q) line(p, q); } break;
      case 'Horizontal': case 'Vertical': {
        const target = compiled.instances[a0!];
        if (here && (target?.a === focus || target?.b === focus)) {
          const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
          line(here, constraint.predicate === 'Horizontal' ? { x: here.x + cos, y: here.y + sin } : { x: here.x - sin, y: here.y + cos });
        }
        break;
      }
      case 'Perpendicular': {
        const first = compiled.instances[a0!], second = compiled.instances[a1!];
        const shared = first && second ? [first.a, first.b].find(end => end === second.a || end === second.b) : undefined;
        if (shared === focus && first && second) {
          const p = pointOf(first.a === shared ? first.b! : first.a!), q = pointOf(second.a === shared ? second.b! : second.a!);
          if (p && q) circle({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, Math.hypot(p.x - q.x, p.y - q.y) / 2);
        }
        break;
      }
      default: break;
    }
  }
  return paths.map(d => `<path data-kite-locus="${escapeXml(focus)}" d="${d}" fill="none" stroke="${LOCUS_COLOR}" stroke-width="1.5" stroke-dasharray="5 5" stroke-opacity="0.9"/>`).join('');
}
