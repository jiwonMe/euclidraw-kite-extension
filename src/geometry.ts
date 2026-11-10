import type {
  CompiledScope, ComputedReadView, DerivedGeometry, EntityId, MemberPins, Point,
  SolvedState, SolvedScope, SubstanceInstance,
} from './types.ts';
import { clamp, finite, positive } from './dsl/tokens.ts';
import { layoutFor, pointOf, radiusOf } from './solver/solve.ts';

export interface Box { x: number; y: number; width: number; height: number; rotation: number }

export function scopeBox(scopeId: EntityId, view: ComputedReadView): Box | undefined {
  const transform = view.getCanonical<{ x?: number; y?: number; rotation?: number }>(scopeId, 'core.transform');
  const bounds = view.getCanonical<{ width?: number; height?: number }>(scopeId, 'core.bounds');
  if (!transform || !bounds) return undefined;
  return {
    x: finite(transform.x, 0),
    y: finite(transform.y, 0),
    width: positive(bounds.width, 520),
    height: positive(bounds.height, 360),
    rotation: finite(transform.rotation, 0),
  };
}

export function scopeLocalBox(box: Box): Box {
  return { x: 0, y: 0, width: box.width, height: box.height, rotation: 0 };
}

export function toWorld(box: Box, x: number, y: number): Point {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = x - box.width / 2, dy = y - box.height / 2;
  const cos = Math.cos(box.rotation), sin = Math.sin(box.rotation);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function toLocal(box: Box, x: number, y: number): Point {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = x - cx, dy = y - cy;
  const cos = Math.cos(-box.rotation), sin = Math.sin(-box.rotation);
  return { x: box.width / 2 + dx * cos - dy * sin, y: box.height / 2 + dx * sin + dy * cos };
}

export function localDirection(box: Box, dx: number, dy: number): Point {
  const cos = Math.cos(box.rotation), sin = Math.sin(box.rotation);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

export function layoutValues(compiled: CompiledScope, state: SolvedState, pins?: MemberPins) {
  const layout = layoutFor(compiled, pins);
  if (state.values.length === layout.values.length) layout.values.set(state.values);
  return layout;
}

export function projectMember(
  compiled: CompiledScope,
  solved: SolvedScope,
  box: Box,
  memberProps: { substanceId: string; pinnedDofs?: number[] },
  pins: MemberPins,
): DerivedGeometry | undefined {
  const instance = compiled.instances.get(memberProps.substanceId);
  if (!instance) return undefined;
  const layout = layoutValues(compiled, solved.state, pins);
  const style = compiled.styles.get(instance.id) ?? {};
  const local: Point[] = [];
  let centerLocal: Point | undefined;
  let radius = 0;
  let startAngle: number | undefined;
  let endAngle: number | undefined;
  let explicitText: string | undefined;
  let textLocal: Point | undefined;
  let textSize = finite(style.fontSize, 14);
  const styledLabel = styledLabelText(style.label, instance.id);

  if (instance.kind === 'point') {
    const point = pointOf(layout, instance.id);
    local.push(point);
    if (styledLabel) {
      textLocal = { x: point.x + 10, y: point.y - 10 };
      textSize = finite(style.fontSize, 14);
    }
  } else if (instance.kind === 'segment' || instance.kind === 'line' || instance.kind === 'ray') {
    const segment = segmentPoints(layout, instance);
    if (!segment) return undefined;
    if (instance.kind === 'segment') local.push(segment[0], segment[1]);
    else {
      const clipped = clipToBox(segment[0], segment[1], { x: 0, y: 0, width: box.width, height: box.height }, instance.kind === 'ray');
      local.push(clipped[0], clipped[1]);
    }
    if (styledLabel) {
      const mid = { x: (segment[0].x + segment[1].x) / 2, y: (segment[0].y + segment[1].y) / 2 };
      const dx = segment[1].x - segment[0].x, dy = segment[1].y - segment[0].y;
      const length = Math.hypot(dx, dy) || 1;
      textLocal = { x: mid.x - dy / length * 13, y: mid.y + dx / length * 13 };
      textSize = finite(style.fontSize, 14);
    }
  } else if (instance.kind === 'circle') {
    centerLocal = pointOf(layout, instance.center ?? '');
    radius = radiusOf(layout, instance.id);
    if (styledLabel) {
      textLocal = { x: centerLocal.x, y: centerLocal.y - radius - 12 };
      textSize = finite(style.fontSize, 14);
    }
  } else if (instance.kind === 'arc') {
    centerLocal = pointOf(layout, instance.center ?? '');
    radius = radiusOf(layout, instance.id);
    startAngle = instance.startAngle ?? 0;
    endAngle = instance.endAngle ?? Math.PI;
    local.push(
      { x: centerLocal.x + Math.cos(startAngle) * radius, y: centerLocal.y + Math.sin(startAngle) * radius },
      { x: centerLocal.x + Math.cos(endAngle) * radius, y: centerLocal.y + Math.sin(endAngle) * radius },
    );
    if (styledLabel) {
      textLocal = { x: centerLocal.x, y: centerLocal.y - radius - 12 };
      textSize = finite(style.fontSize, 14);
    }
  } else if (instance.kind === 'polygon') {
    const points = instance.points ?? [];
    for (const id of points) local.push(pointOf(layout, id));
    if (styledLabel && local.length) {
      const centroid = local.reduce((sum, value) => ({ x: sum.x + value.x / local.length, y: sum.y + value.y / local.length }), { x: 0, y: 0 });
      textLocal = { x: centroid.x, y: centroid.y - 12 };
      textSize = finite(style.fontSize, 14);
    }
  } else if (instance.kind === 'angle-mark') {
    const [aId, vertexId, bId] = instance.angle ?? [];
    if (!aId || !vertexId || !bId) return undefined;
    const a = pointOf(layout, aId), vertex = pointOf(layout, vertexId), b = pointOf(layout, bId);
    local.push(a, vertex, b);
    const mark = angleMark(a, vertex, b, finite(style.radius, 22));
    centerLocal = vertex;
    radius = mark.radius;
    startAngle = mark.start;
    endAngle = mark.end;
    if (styledLabel) {
      const bisector = bisectorUnit(a, vertex, b);
      textLocal = { x: vertex.x + bisector.x * (mark.radius + 14), y: vertex.y + bisector.y * (mark.radius + 14) };
      explicitText = style.label === true ? `${Math.round(mark.degrees)}°` : styledLabel;
      textSize = finite(style.fontSize, 13);
    }
  } else if (instance.kind === 'label-anchor') {
    const label = instance.label;
    if (!label) return undefined;
    const anchor = labelAnchor(layout, compiled, label.anchor);
    if (!anchor) return undefined;
    const offset = labelOffset(layout, compiled, label);
    explicitText = label.text;
    textLocal = { x: anchor.point.x + offset.x, y: anchor.point.y + offset.y };
    textSize = finite(style.fontSize, 15);
  }

  const text = explicitText ?? styledLabel;
  const worldPoints = local.map(point => toWorld(box, point.x, point.y));
  const worldCenter = centerLocal ? toWorld(box, centerLocal.x, centerLocal.y) : undefined;
  const worldText = textLocal ? toWorld(box, textLocal.x, textLocal.y) : undefined;
  const worldRadius = radius;
  const worldStart = startAngle === undefined ? undefined : startAngle + box.rotation;
  const worldEnd = endAngle === undefined ? undefined : endAngle + box.rotation;
  const squares = rightAngleSquares(compiled, layout, instance, box);
  const boxResult = boundsOf({
    kind: instance.kind,
    points: worldPoints,
    ...(worldCenter ? { center: worldCenter } : {}),
    radius: instance.kind === 'circle' || instance.kind === 'arc' || instance.kind === 'angle-mark' ? worldRadius : 0,
    ...(text ? { text } : {}),
    ...(worldText ? { textPoint: worldText } : {}),
    textSize,
    style,
  });
  const ticks = compiled.badges.ticks.get(instance.id) ?? 0;
  const rightAngle = compiled.badges.rightAngles.some(entry => entry.a === instance.id || entry.b === instance.id);
  const pinned = compiled.pinned.has(instance.id) || (memberProps.pinnedDofs?.length ?? 0) > 0;
  const onCircle = compiled.badges.onCircle.has(instance.id);
  return {
    ...boxResult,
    kind: instance.kind,
    name: instance.id,
    style,
    points: worldPoints,
    ...(worldCenter ? { center: worldCenter } : {}),
    ...(worldRadius > 0 ? { radius: worldRadius } : {}),
    ...(worldStart !== undefined ? { startAngle: worldStart } : {}),
    ...(worldEnd !== undefined ? { endAngle: worldEnd } : {}),
    ...(text ? { text } : {}),
    ...(worldText ? { textX: worldText.x, textY: worldText.y } : {}),
    textSize,
    squares,
    stress: solved.state.stress.get(instance.id) ?? 0,
    badges: { ticks, rightAngle, pinned, onCircle },
  };
}

function rightAngleSquares(compiled: CompiledScope, layout: ReturnType<typeof layoutFor>, instance: SubstanceInstance, box: Box) {
  const squares: { x: number; y: number; ax: number; ay: number; bx: number; by: number; size: number }[] = [];
  const dir = (from: Point, to: Point) => normalize({ x: to.x - from.x, y: to.y - from.y });
  if (instance.kind === 'angle-mark' && instance.angle) {
    const [aId, vertexId, bId] = instance.angle;
    const a = pointOf(layout, aId), vertex = pointOf(layout, vertexId), b = pointOf(layout, bId);
    const da = dir(vertex, a), db = dir(vertex, b);
    if (Math.abs(da.x * db.x + da.y * db.y) < 0.02) {
      const world = toWorld(box, vertex.x, vertex.y), wa = localDirection(box, da.x, da.y), wb = localDirection(box, db.x, db.y);
      squares.push({ x: world.x, y: world.y, ax: wa.x, ay: wa.y, bx: wb.x, by: wb.y, size: 9 });
    }
    return squares;
  }
  if (instance.kind !== 'segment' && instance.kind !== 'line' && instance.kind !== 'ray') return squares;
  for (const badge of compiled.badges.rightAngles) {
    if (badge.a !== instance.id && badge.b !== instance.id) continue;
    const first = compiled.instances.get(badge.a), second = compiled.instances.get(badge.b);
    const s1 = first ? segmentPoints(layout, first) : undefined, s2 = second ? segmentPoints(layout, second) : undefined;
    if (!first || !second || !s1 || !s2) continue;
    const shared = [first.a, first.b].find(point => point === second.a || point === second.b);
    if (!shared) continue;
    const otherA = first.a === shared ? first.b : first.a;
    const otherB = second.a === shared ? second.b : second.a;
    if (!otherA || !otherB) continue;
    const vertex = pointOf(layout, shared), otherPointA = pointOf(layout, otherA), otherPointB = pointOf(layout, otherB);
    const da = dir(vertex, otherPointA), db = dir(vertex, otherPointB);
    const world = toWorld(box, vertex.x, vertex.y), wa = localDirection(box, da.x, da.y), wb = localDirection(box, db.x, db.y);
    squares.push({ x: world.x, y: world.y, ax: wa.x, ay: wa.y, bx: wb.x, by: wb.y, size: 9 });
  }
  return squares;
}

function styledLabelText(value: unknown, id: string): string | undefined {
  if (value === true) return id;
  if (typeof value === 'string' && value && value !== 'none' && value !== 'false') return value;
  return undefined;
}

function segmentPoints(layout: ReturnType<typeof layoutFor>, instance: SubstanceInstance): [Point, Point] | undefined {
  if (!instance.a || !instance.b) return undefined;
  return [pointOf(layout, instance.a), pointOf(layout, instance.b)];
}

function labelAnchor(layout: ReturnType<typeof layoutFor>, compiled: CompiledScope, anchor: { kind: 'point' | 'center' | 'midpoint'; id: string }): { point: Point; direction: Point } | undefined {
  const instance = compiled.instances.get(anchor.id);
  if (!instance) return undefined;
  if (anchor.kind === 'point') return { point: pointOf(layout, anchor.id), direction: { x: 0, y: -1 } };
  if (anchor.kind === 'center') {
    if (instance.kind === 'circle' || instance.kind === 'arc') return { point: pointOf(layout, instance.center ?? ''), direction: { x: 0, y: -1 } };
    if (instance.kind === 'polygon') {
      const points = (instance.points ?? []).map(id => pointOf(layout, id));
      if (!points.length) return undefined;
      const point = points.reduce((sum, value) => ({ x: sum.x + value.x / points.length, y: sum.y + value.y / points.length }), { x: 0, y: 0 });
      return { point, direction: { x: 0, y: -1 } };
    }
    return undefined;
  }
  const segment = segmentPoints(layout, instance);
  if (!segment) return undefined;
  const point = { x: (segment[0].x + segment[1].x) / 2, y: (segment[0].y + segment[1].y) / 2 };
  const dx = segment[1].x - segment[0].x, dy = segment[1].y - segment[0].y;
  const length = Math.hypot(dx, dy) || 1;
  return { point, direction: { x: -dy / length, y: dx / length } };
}

function labelOffset(layout: ReturnType<typeof layoutFor>, compiled: CompiledScope, label: NonNullable<SubstanceInstance['label']>): Point {
  if (label.offsetMode === 'vector') return { x: label.offsetX ?? 0, y: label.offsetY ?? 0 };
  const anchor = labelAnchor(layout, compiled, label.anchor);
  const direction = anchor?.direction ?? { x: 0, y: -1 };
  const distance = label.offset ?? 12;
  return { x: direction.x * distance, y: direction.y * distance };
}

function angleMark(a: Point, vertex: Point, b: Point, requested: number) {
  const d1 = normalize({ x: a.x - vertex.x, y: a.y - vertex.y });
  const d2 = normalize({ x: b.x - vertex.x, y: b.y - vertex.y });
  const radius = Math.max(6, Math.min(positive(requested, 22), Math.min(Math.hypot(a.x - vertex.x, a.y - vertex.y), Math.hypot(b.x - vertex.x, b.y - vertex.y)) * 0.42));
  const start = Math.atan2(d1.y, d1.x);
  const raw = Math.atan2(d2.y, d2.x) - start;
  const delta = Math.abs(normalizeAngle(raw));
  const end = start + (raw >= 0 ? delta : -delta);
  return { radius, start, end, degrees: delta * 180 / Math.PI };
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y) || 1;
  return { x: point.x / length, y: point.y / length };
}

function bisectorUnit(a: Point, vertex: Point, b: Point): Point {
  const d1 = normalize({ x: a.x - vertex.x, y: a.y - vertex.y });
  const d2 = normalize({ x: b.x - vertex.x, y: b.y - vertex.y });
  return normalize({ x: d1.x + d2.x, y: d1.y + d2.y });
}

export function clipToBox(a: Point, b: Point, box: { x: number; y: number; width: number; height: number }, ray: boolean): [Point, Point] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.x, box.x + box.width - a.x, a.y - box.y, box.y + box.height - a.y];
  let t0 = ray ? 0 : -Infinity, t1 = Infinity;
  for (let index = 0; index < 4; index++) {
    const pi = p[index]!, qi = q[index]!;
    if (Math.abs(pi) < 1e-12) { if (qi < 0) return [a, b]; continue; }
    const t = qi / pi;
    if (pi < 0) { if (t > t1) return [a, b]; if (t > t0) t0 = t; }
    else { if (t < t0) return [a, b]; if (t < t1) t1 = t; }
  }
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    return ray ? [a, { x: a.x + dx, y: a.y + dy }] : [a, b];
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

function boundsOf(input: {
  kind: SubstanceInstance['kind'];
  points: Point[];
  center?: Point;
  radius: number;
  text?: string;
  textPoint?: Point;
  textSize: number;
  style: Record<string, unknown>;
  startAngle?: number;
  endAngle?: number;
}): { x: number; y: number; width: number; height: number; rotation: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const point of input.points) include(point.x, point.y);
  if (input.center && input.radius > 0) {
    include(input.center.x - input.radius, input.center.y - input.radius);
    include(input.center.x + input.radius, input.center.y + input.radius);
  }
  if (input.text && input.textPoint) {
    const width = textWidth(input.text, input.textSize);
    include(input.textPoint.x - width / 2, input.textPoint.y - input.textSize * 0.75);
    include(input.textPoint.x + width / 2, input.textPoint.y + input.textSize * 0.75);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const padding = input.kind === 'point' ? Math.max(3, positive(input.style.r, 4.5) + 2) : 2;
  return { x: minX - padding, y: minY - padding, width: Math.max(1, maxX - minX + padding * 2), height: Math.max(1, maxY - minY + padding * 2), rotation: 0 };
}

export function textWidth(text: string, size: number): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    width += code >= 0x2e80 ? 1 : code === 0x20 ? 0.32 : 0.56;
  }
  return width * size;
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return pointDistance(point, a);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  return pointDistance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function rayDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return pointDistance(point, a);
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  if (t <= 0) return pointDistance(point, a);
  return pointDistance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function lineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return pointDistance(point, a);
  return Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) / length;
}

export function polygonContainment(point: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]!, b = points[previous]!;
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function angleWithin(angle: number, start: number, end: number): boolean {
  const normalizeAngle = (value: number) => { let next = value; while (next > Math.PI) next -= Math.PI * 2; while (next < -Math.PI) next += Math.PI * 2; return next; };
  const span = normalizeAngle(end - start);
  const delta = normalizeAngle(angle - start);
  return span >= 0 ? delta >= 0 && delta <= span : delta <= 0 && delta >= span;
}
