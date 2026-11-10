import type { ComputedReadView, EntityId } from './host.ts';
import type { CompiledScope, StyleMap } from './dsl/compile.ts';
import type { KitePrimitiveKind } from './schema.ts';
import type { Frame } from './solver-runtime.ts';
import { PRIM_STRIDE } from './solver-runtime.ts';

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number; rotation: number }

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function readScopeBox(view: Pick<ComputedReadView, 'getCanonical'>, scopeId: EntityId): Box | undefined {
  const transform = view.getCanonical<{ x?: number; y?: number; rotation?: number }>(scopeId, 'core.transform');
  const bounds = view.getCanonical<{ width?: number; height?: number }>(scopeId, 'core.bounds');
  if (!transform || !bounds) return undefined;
  return {
    x: finite(transform.x, 0), y: finite(transform.y, 0), rotation: finite(transform.rotation, 0),
    width: Math.max(1, finite(bounds.width, 520)), height: Math.max(1, finite(bounds.height, 380)),
  };
}

/**
 * Uniform fit of the DSL canvas into the scope box. Only this matrix changes
 * when a scope is moved, resized or rotated; the solver never runs for it.
 */
export function frameFor(canvas: { width: number; height: number }, box: Box): Frame {
  const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
  return {
    cx: box.x + box.width / 2, cy: box.y + box.height / 2, scale, rotation: box.rotation,
    ox: canvas.width / 2, oy: canvas.height / 2, halfW: box.width / 2 / scale, halfH: box.height / 2 / scale,
  };
}

export function toWorld(frame: Frame, x: number, y: number): Point {
  const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  const dx = (x - frame.ox) * frame.scale, dy = (y - frame.oy) * frame.scale;
  return { x: frame.cx + dx * cos - dy * sin, y: frame.cy + dx * sin + dy * cos };
}

export function toLocal(frame: Frame, x: number, y: number): Point {
  const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  const dx = x - frame.cx, dy = y - frame.cy;
  return { x: frame.ox + (dx * cos + dy * sin) / frame.scale, y: frame.oy + (-dx * sin + dy * cos) / frame.scale };
}

// ── normalised seeds ───────────────────────────────────────────────────────

/** Seeds are stored in [-1, 1] about the DSL canvas centre (half of its larger side = 1). */
export function seedScale(canvas: { width: number; height: number }): number { return Math.max(canvas.width, canvas.height) / 2; }

const round = (value: number) => Math.round(value * 1e9) / 1e9;

export function encodePointSeed(canvas: { width: number; height: number }, x: number, y: number): number[] {
  const s = seedScale(canvas);
  return [round((x - canvas.width / 2) / s), round((y - canvas.height / 2) / s)];
}
export function decodePointSeed(canvas: { width: number; height: number }, seed: readonly number[]): [number, number] {
  const s = seedScale(canvas);
  return [canvas.width / 2 + seed[0]! * s, canvas.height / 2 + seed[1]! * s];
}
export function encodeScalarSeed(canvas: { width: number; height: number }, value: number): number[] { return [round(value / seedScale(canvas))]; }
export function decodeScalarSeed(canvas: { width: number; height: number }, seed: readonly number[]): number { return seed[0]! * seedScale(canvas); }

export function validSeed(seed: unknown, length: number): seed is number[] {
  return Array.isArray(seed) && seed.length === length && seed.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6);
}

/** Normalised seeds of every DOF-bearing member, keyed by its current EntityId. */
export function encodeSeeds(compiled: CompiledScope, dofs: ArrayLike<number>, bindings: Readonly<Record<string, EntityId>>): Record<EntityId, number[]> {
  const seeds: Record<EntityId, number[]> = {};
  for (const slot of compiled.dofs) {
    const id = bindings[slot.substanceId];
    if (!id) continue;
    seeds[id] = slot.kind === 'point' ? encodePointSeed(compiled.canvas, dofs[slot.off]!, dofs[slot.off + 1]!) : encodeScalarSeed(compiled.canvas, dofs[slot.off]!);
  }
  return seeds;
}

// ── member geometry from world_prim_buf ────────────────────────────────────

export interface MemberGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0;
  readonly kind: KitePrimitiveKind;
  readonly substanceId: string;
  readonly scopeId: EntityId;
  readonly style: StyleMap;
  /** World-space coordinates; meaning depends on `kind` (see `memberGeometry`). */
  readonly points: readonly Point[];
  readonly radius: number;
  readonly start: number;
  readonly end: number;
  readonly text?: string;
  readonly textAt?: Point;
  readonly fontSize: number;
  readonly scale: number;
  /** Right-angle corner marks and equal-length ticks resolved from constraints. */
  readonly squares: readonly { readonly o: Point; readonly u: Point; readonly v: Point }[];
  readonly ticks: number;
  readonly pinned: boolean;
  readonly stress: number;
  /** Card labels are laid out by markdown-card; Kite only positions them. */
  readonly card: boolean;
}

const LINE_KINDS = new Set<KitePrimitiveKind>(['segment', 'line', 'ray']);

export function primSlice(prims: readonly number[], index: number): readonly number[] {
  return prims.slice(index * PRIM_STRIDE, index * PRIM_STRIDE + PRIM_STRIDE);
}

export function textWidth(text: string, size: number): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    width += code >= 0x2e80 ? 1 : code === 0x20 ? 0.3 : /[A-Z]/.test(character) ? 0.66 : 0.56;
  }
  return width * size;
}

export interface SolvedLike {
  readonly frame: Frame;
  readonly dofs: readonly number[];
  readonly prims: readonly number[];
  readonly poly: readonly number[];
  readonly stress: readonly number[];
}

/** World geometry of one member; pure, deterministic, no DOM. */
export function memberGeometry(compiled: CompiledScope, solved: SolvedLike, scopeId: EntityId, substanceId: string, pinnedDofs: readonly number[] = []): MemberGeometry | undefined {
  const instance = compiled.instances[substanceId];
  const index = compiled.primIndex[substanceId];
  if (!instance || index === undefined) return undefined;
  const p = primSlice(solved.prims, index);
  const style = compiled.styles[substanceId] ?? {};
  const scale = solved.frame.scale;
  const kind = instance.kind;
  const points: Point[] = [];
  let radius = 0, start = 0, end = 0, text: string | undefined, textAt: Point | undefined;
  const fontSize = finite(style.fontSize, kind === 'label-anchor' ? 15 : 14);
  const label = style.label === true ? substanceId : typeof style.label === 'string' && style.label !== 'none' ? style.label : undefined;
  switch (kind) {
    case 'point': {
      points.push({ x: p[1]!, y: p[2]! });
      if (label) { text = label; textAt = { x: p[1]! + 11, y: p[2]! - 11 }; }
      break;
    }
    case 'segment': case 'line': case 'ray': {
      const a = { x: p[1]!, y: p[2]! }, b = { x: p[3]!, y: p[4]! };
      points.push(a, b);
      if (label) {
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        text = label; textAt = { x: (a.x + b.x) / 2 - dy / length * 13, y: (a.y + b.y) / 2 + dx / length * 13 };
      }
      break;
    }
    case 'circle': case 'arc': {
      points.push({ x: p[1]!, y: p[2]! });
      radius = p[5]!; start = p[6]!; end = p[7]!;
      if (label) { text = label; textAt = { x: p[1]!, y: p[2]! - radius - 12 }; }
      break;
    }
    case 'polygon': {
      const offset = p[3]!, count = p[4]!;
      for (let vertex = 0; vertex < count; vertex++) points.push({ x: solved.poly[offset + vertex * 2]!, y: solved.poly[offset + vertex * 2 + 1]! });
      if (label) { text = label; textAt = { x: p[1]!, y: p[2]! }; }
      break;
    }
    case 'angle-mark': {
      const o = { x: p[1]!, y: p[2]! }, u = { x: p[3]!, y: p[4]! }, v = { x: p[5]!, y: p[6]! };
      const shortest = p[7]!;
      radius = Math.max(6, Math.min(finite(style.radius, 22), shortest * 0.42));
      points.push(o, u, v);
      start = Math.atan2(u.y, u.x);
      let sweep = Math.atan2(v.y, v.x) - start;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      end = start + sweep;
      if (style.label === true || typeof style.label === 'string' && style.label !== 'none') {
        const degrees = Math.round(Math.abs(sweep) * 180 / Math.PI);
        text = style.label === true ? `${degrees}°` : String(style.label);
        const bx = u.x + v.x, by = u.y + v.y, length = Math.hypot(bx, by) || 1;
        textAt = { x: o.x + bx / length * (radius + 13), y: o.y + by / length * (radius + 13) };
      }
      break;
    }
    case 'label-anchor': {
      const anchor = { x: p[1]!, y: p[2]! }, normal = { x: p[3]!, y: p[4]! };
      points.push(anchor);
      const offset = instance.offset;
      const cos = Math.cos(solved.frame.rotation), sin = Math.sin(solved.frame.rotation);
      let at: Point;
      if (offset?.mode === 'vector') at = { x: anchor.x + (offset.x * cos - offset.y * sin) * scale, y: anchor.y + (offset.x * sin + offset.y * cos) * scale };
      else at = { x: anchor.x + normal.x * (offset?.d ?? 12) * scale, y: anchor.y + normal.y * (offset?.d ?? 12) * scale };
      text = instance.text; textAt = at;
      break;
    }
  }
  // Right-angle marks: perpendicular segments that share an endpoint.
  const squares: { o: Point; u: Point; v: Point }[] = [];
  let ticks = 0;
  if (LINE_KINDS.has(kind)) {
    for (const constraint of compiled.constraints) {
      if (constraint.predicate === 'EqualLength' && constraint.args.includes(substanceId)) ticks++;
      if (constraint.predicate !== 'Perpendicular' || constraint.args[0] !== substanceId) continue;
      const first = compiled.instances[constraint.args[0]!], second = compiled.instances[constraint.args[1]!];
      const shared = first && second ? [first.a, first.b].find(end => end === second.a || end === second.b) : undefined;
      if (!first || !second || !shared) continue;
      const other = (line: typeof first) => line.a === shared ? line.b! : line.a!;
      const local = (id: string) => { const slot = compiled.dofs.find(entry => entry.substanceId === id)!; return toWorld(solved.frame, solved.dofs[slot.off]!, solved.dofs[slot.off + 1]!); };
      const o = local(shared), a = local(other(first)), b = local(other(second));
      const unit = (from: Point, to: Point) => { const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1; return { x: dx / length, y: dy / length }; };
      squares.push({ o, u: unit(o, a), v: unit(o, b) });
    }
  }
  if (kind === 'angle-mark') {
    const u = points[1]!, v = points[2]!;
    if (Math.abs(u.x * v.x + u.y * v.y) < 0.0175 && style.square !== false) squares.push({ o: points[0]!, u, v });
  }
  // Stress: the worst normalised residual among constraints touching this member.
  let stress = 0;
  for (const constraint of compiled.constraints) {
    if (constraint.soft || !constraint.touches.includes(substanceId)) continue;
    stress = Math.max(stress, solved.stress[constraint.index] ?? 0);
  }
  const slot = compiled.dofs.find(entry => entry.substanceId === substanceId);
  const pinned = Boolean(slot?.fixed) || pinnedDofs.length > 0;
  const bounds = boundsOf(kind, points, radius, start, end, text, textAt, fontSize, finite(style.r, 4.5), finite(style.width, 2));
  return { ...bounds, rotation: 0, kind, substanceId, scopeId, style, points, radius, start, end, ...(text ? { text } : {}), ...(textAt ? { textAt } : {}), fontSize, scale, squares, ticks, pinned, stress, card: Boolean(instance.card) };
}

function boundsOf(kind: KitePrimitiveKind, points: readonly Point[], radius: number, start: number, end: number, text: string | undefined, textAt: Point | undefined, fontSize: number, pointRadius: number, strokeWidth: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  if (kind === 'circle') { const c = points[0]!; include(c.x - radius, c.y - radius); include(c.x + radius, c.y + radius); }
  else if (kind === 'arc' || kind === 'angle-mark') {
    const c = points[0]!;
    include(c.x + Math.cos(start) * radius, c.y + Math.sin(start) * radius);
    include(c.x + Math.cos(end) * radius, c.y + Math.sin(end) * radius);
    const low = Math.min(start, end), high = Math.max(start, end);
    for (let k = Math.ceil(low / (Math.PI / 2)); k * Math.PI / 2 <= high; k++) include(c.x + Math.cos(k * Math.PI / 2) * radius, c.y + Math.sin(k * Math.PI / 2) * radius);
    if (kind === 'angle-mark') include(c.x, c.y);
  } else if (kind !== 'label-anchor') for (const point of points) include(point.x, point.y);
  if (text && textAt) {
    const half = textWidth(text, fontSize) / 2 + 2;
    include(textAt.x - half, textAt.y - fontSize * 0.7);
    include(textAt.x + half, textAt.y + fontSize * 0.7);
  }
  if (!Number.isFinite(minX)) { const p = points[0] ?? { x: 0, y: 0 }; minX = maxX = p.x; minY = maxY = p.y; }
  const pad = kind === 'point' ? pointRadius + 1.5 : Math.max(1, strokeWidth / 2 + 1);
  return { x: minX - pad, y: minY - pad, width: Math.max(1, maxX - minX + pad * 2), height: Math.max(1, maxY - minY + pad * 2) };
}

// ── hit testing (world units) ──────────────────────────────────────────────

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function angleWithin(angle: number, start: number, end: number): boolean {
  const low = Math.min(start, end), high = Math.max(start, end);
  let value = angle;
  while (value < low) value += Math.PI * 2;
  while (value > low + Math.PI * 2) value -= Math.PI * 2;
  return value <= high;
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Nonnegative world distance from `point` to the member's painted geometry. */
export function hitDistance(geometry: MemberGeometry, point: Point): number {
  const width = finite(geometry.style.width, 2) / 2;
  switch (geometry.kind) {
    case 'point': return Math.max(0, Math.hypot(point.x - geometry.points[0]!.x, point.y - geometry.points[0]!.y) - finite(geometry.style.r, 4.5));
    case 'segment': case 'line': case 'ray': return Math.max(0, distanceToSegment(point, geometry.points[0]!, geometry.points[1]!) - width);
    case 'circle': return Math.max(0, Math.abs(Math.hypot(point.x - geometry.points[0]!.x, point.y - geometry.points[0]!.y) - geometry.radius) - width);
    case 'arc': case 'angle-mark': {
      const c = geometry.points[0]!;
      const angle = Math.atan2(point.y - c.y, point.x - c.x);
      return angleWithin(angle, geometry.start, geometry.end) ? Math.max(0, Math.abs(Math.hypot(point.x - c.x, point.y - c.y) - geometry.radius) - width) : Infinity;
    }
    case 'polygon': {
      const fill = geometry.style.fill;
      if (fill && fill !== 'none' && pointInPolygon(point, geometry.points)) return 0;
      let best = Infinity;
      for (let i = 0; i < geometry.points.length; i++) best = Math.min(best, distanceToSegment(point, geometry.points[i]!, geometry.points[(i + 1) % geometry.points.length]!));
      return Math.max(0, best - width);
    }
    case 'label-anchor': {
      if (!geometry.textAt || !geometry.text) return Infinity;
      const half = textWidth(geometry.text, geometry.fontSize) / 2, dy = geometry.fontSize * 0.7;
      const dx = Math.max(0, Math.abs(point.x - geometry.textAt.x) - half), dz = Math.max(0, Math.abs(point.y - geometry.textAt.y) - dy);
      return Math.hypot(dx, dz);
    }
  }
}

// ── vector path helpers (baking) ───────────────────────────────────────────

export interface Cubic { p0: Point; c1: Point; c2: Point; p3: Point }

/** Split an arc into ≤ 90° cubic Bézier segments. */
export function arcCubics(c: Point, r: number, start: number, end: number): Cubic[] {
  const sweep = end - start;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / count, k = 4 / 3 * Math.tan(step / 4);
  const at = (angle: number) => ({ x: c.x + Math.cos(angle) * r, y: c.y + Math.sin(angle) * r });
  const out: Cubic[] = [];
  for (let index = 0; index < count; index++) {
    const a0 = start + step * index, a1 = a0 + step;
    const p0 = at(a0), p3 = at(a1);
    out.push({ p0, c1: { x: p0.x - Math.sin(a0) * r * k, y: p0.y + Math.cos(a0) * r * k }, c2: { x: p3.x + Math.sin(a1) * r * k, y: p3.y - Math.cos(a1) * r * k }, p3 });
  }
  return out;
}
