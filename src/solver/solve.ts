import type {
  CompiledScope, Constraint, EntityId, MemberPins, ScopeProps, SolvedState, SubstanceInstance,
} from '../types.ts';

/**
 * Deterministic manifold solver.
 *
 * Points own two DOFs and circles own one radius DOF. Each pass applies a soft
 * pointer spring first, then Gauss-Seidel projections of every constraint. The
 * runtime is a plain Float64Array, so the same code can later be replaced by a
 * Wasm SIMD kernel without changing the document schema.
 */

interface Layout {
  values: Float64Array;
  free: Uint8Array;
  offsets: Map<string, { offset: number; size: 1 | 2; kind: 'point' | 'circle' }>;
}

const PIN_STRENGTH = 0.38;
const INIT_ITERATIONS = 180;

export function memberPinsFrom(compiled: CompiledScope, view: { getCanonical<T extends Record<string, unknown>>(id: EntityId, aspect: string): Readonly<T> | undefined }): MemberPins {
  const pinnedDofs = new Map<string, number[]>();
  const slackWeight = new Map<string, number>();
  for (const [substanceId, entityId] of Object.entries(compiled.bindings)) {
    const member = view.getCanonical<{ pinnedDofs?: number[]; slackWeight?: number }>(entityId, 'kite.member');
    if (member) {
      pinnedDofs.set(substanceId, Array.isArray(member.pinnedDofs) ? member.pinnedDofs : []);
      slackWeight.set(substanceId, Number.isFinite(member.slackWeight) ? Number(member.slackWeight) : 1);
    }
  }
  return { pinnedDofs, slackWeight };
}

export function seedsAreClean(compiled: CompiledScope, seeds: Record<EntityId, number[]> | undefined): boolean {
  if (!seeds || typeof seeds !== 'object') return false;
  let unbound = false;
  for (const instance of compiled.instances.values()) {
    const entityId = compiled.bindings[instance.id];
    if (!entityId) {
      // An unbound DOF-bearing declaration has no persisted seed yet, so the
      // first projection must initialize it from the DSL.
      if (instance.kind === 'point' || instance.kind === 'circle') unbound = true;
      continue;
    }
    const seed = seeds[entityId];
    if (instance.kind === 'point') {
      if (!Array.isArray(seed) || seed.length !== 2 || !seed.every(value => Number.isFinite(value))) return false;
    } else if (instance.kind === 'circle') {
      if (!Array.isArray(seed) || seed.length !== 1 || !Number.isFinite(seed[0])) return false;
    }
  }
  return !unbound;
}

export function layoutFor(compiled: CompiledScope, memberPins?: MemberPins): Layout {
  const values = new Float64Array(compiled.dofCount);
  const free = new Uint8Array(compiled.dofCount);
  free.fill(1);
  const offsets = new Map<string, { offset: number; size: 1 | 2; kind: 'point' | 'circle' }>();
  for (const slot of compiled.dofs) offsets.set(slot.instanceId, { offset: slot.offset, size: slot.size, kind: slot.kind });
  for (const instance of compiled.instances.values()) {
    const slot = offsets.get(instance.id);
    if (!slot) continue;
    if (instance.kind === 'point' && compiled.pinned.has(instance.id)) {
      free[slot.offset] = 0; free[slot.offset + 1] = 0;
    }
    const declared = memberPins?.pinnedDofs.get(instance.id) ?? [];
    for (const index of declared) {
      const at = slot.offset + Math.trunc(index);
      if (Number.isInteger(index) && index >= 0 && index < slot.size && at < free.length) free[at] = 0;
    }
  }
  return { values, free, offsets };
}

export function fillValues(layout: Layout, compiled: CompiledScope, seeds: Record<EntityId, number[]> | undefined): void {
  const clean = seedsAreClean(compiled, seeds);
  for (const instance of compiled.instances.values()) {
    const slot = layout.offsets.get(instance.id);
    if (!slot) continue;
    const seed = clean ? seeds?.[compiled.bindings[instance.id] ?? ''] : undefined;
    if (instance.kind === 'point') {
      layout.values[slot.offset] = seed && seed.length === 2 ? seed[0]! : (instance.x ?? 0);
      layout.values[slot.offset + 1] = seed && seed.length === 2 ? seed[1]! : (instance.y ?? 0);
    } else if (instance.kind === 'circle') {
      layout.values[slot.offset] = seed && seed.length === 1 ? seed[0]! : (instance.radius ?? 100);
    }
  }
}

export function pointOf(layout: Layout, id: string): { x: number; y: number } {
  const slot = layout.offsets.get(id);
  if (!slot || slot.kind !== 'point') return { x: 0, y: 0 };
  return { x: layout.values[slot.offset]!, y: layout.values[slot.offset + 1]! };
}

export function radiusOf(layout: Layout, id: string): number {
  const slot = layout.offsets.get(id);
  if (!slot || slot.kind !== 'circle') return 0;
  return layout.values[slot.offset]!;
}

export function setPoint(layout: Layout, id: string, x: number, y: number): void {
  const slot = layout.offsets.get(id);
  if (!slot || slot.kind !== 'point') return;
  if (layout.free[slot.offset]) layout.values[slot.offset] = x;
  if (layout.free[slot.offset + 1]) layout.values[slot.offset + 1] = y;
}

function movePoint(layout: Layout, id: string, dx: number, dy: number): void {
  const slot = layout.offsets.get(id);
  if (!slot || slot.kind !== 'point') return;
  if (layout.free[slot.offset]) layout.values[slot.offset] += dx;
  if (layout.free[slot.offset + 1]) layout.values[slot.offset + 1] += dy;
}

function circleCenter(layout: Layout, compiled: CompiledScope, id: string): { x: number; y: number } {
  return pointOf(layout, compiled.instances.get(id)?.center ?? '');
}

function moveRadius(layout: Layout, id: string, delta: number): void {
  const slot = layout.offsets.get(id);
  if (!slot || slot.kind !== 'circle' || !layout.free[slot.offset]) return;
  layout.values[slot.offset] = Math.max(0.001, layout.values[slot.offset] + delta);
}

function segmentOf(layout: Layout, instance: SubstanceInstance | undefined): { ax: number; ay: number; bx: number; by: number } | undefined {
  if (!instance || instance.a === undefined || instance.b === undefined) return undefined;
  const a = pointOf(layout, instance.a), b = pointOf(layout, instance.b);
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

function segmentCenter(s: { ax: number; ay: number; bx: number; by: number }): { x: number; y: number } {
  return { x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2 };
}

function rotateSegment(layout: Layout, instance: SubstanceInstance, delta: number): void {
  if (!instance.a || !instance.b || !Number.isFinite(delta) || Math.abs(delta) < 1e-12) return;
  const slotA = layout.offsets.get(instance.a), slotB = layout.offsets.get(instance.b);
  if (!slotA || !slotB) return;
  const freeA = Boolean(layout.free[slotA.offset] && layout.free[slotA.offset + 1]);
  const freeB = Boolean(layout.free[slotB.offset] && layout.free[slotB.offset + 1]);
  if (!freeA && !freeB) return;
  const a = pointOf(layout, instance.a), b = pointOf(layout, instance.b);
  const cos = Math.cos(delta), sin = Math.sin(delta);
  const rotateAround = (point: { x: number; y: number }, pivot: { x: number; y: number }) => {
    const dx = point.x - pivot.x, dy = point.y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  };
  if (freeA && freeB) {
    const center = segmentCenter({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    const nextA = rotateAround(a, center), nextB = rotateAround(b, center);
    layout.values[slotA.offset] = nextA.x; layout.values[slotA.offset + 1] = nextA.y;
    layout.values[slotB.offset] = nextB.x; layout.values[slotB.offset + 1] = nextB.y;
  } else if (freeB) {
    // The pinned endpoint is the pivot, so the segment keeps its exact length.
    const nextB = rotateAround(b, a);
    layout.values[slotB.offset] = nextB.x; layout.values[slotB.offset + 1] = nextB.y;
  } else {
    const nextA = rotateAround(a, b);
    layout.values[slotA.offset] = nextA.x; layout.values[slotA.offset + 1] = nextA.y;
  }
}

function lineDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(((point.x - a.x) * dy - (point.y - a.y) * dx) / length);
}

function projectPoint(line: { ax: number; ay: number; bx: number; by: number }, p: { x: number; y: number }): { x: number; y: number } {
  const dx = line.bx - line.ax, dy = line.by - line.ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return { x: line.ax, y: line.ay };
  const t = ((p.x - line.ax) * dx + (p.y - line.ay) * dy) / lengthSquared;
  return { x: line.ax + t * dx, y: line.ay + t * dy };
}

function normalizeAngle(value: number): number {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function angleOfSegment(s: { ax: number; ay: number; bx: number; by: number }): number {
  return Math.atan2(s.by - s.ay, s.bx - s.ax);
}

function applyConstraint(layout: Layout, compiled: CompiledScope, constraint: Constraint, weight: number): void {
  const scale = constraint.soft ? weight * constraint.weight : weight;
  switch (constraint.type) {
    case 'distance': {
      const a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < 1e-9) return;
      const correction = (length - constraint.value) / length * scale;
      movePoint(layout, constraint.a, dx * correction * 0.5, dy * correction * 0.5);
      movePoint(layout, constraint.b, -dx * correction * 0.5, -dy * correction * 0.5);
      return;
    }
    case 'coincident': {
      const a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      movePoint(layout, constraint.a, (b.x - a.x) * 0.5 * scale, (b.y - a.y) * 0.5 * scale);
      movePoint(layout, constraint.b, (a.x - b.x) * 0.5 * scale, (a.y - b.y) * 0.5 * scale);
      return;
    }
    case 'midpoint': {
      const m = pointOf(layout, constraint.point), a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      const target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const slot = layout.offsets.get(constraint.point);
      if (slot && layout.free[slot.offset]) {
        movePoint(layout, constraint.point, (target.x - m.x) * scale, (target.y - m.y) * scale);
      } else {
        movePoint(layout, constraint.a, (m.x - target.x) * scale, (m.y - target.y) * scale);
        movePoint(layout, constraint.b, (m.x - target.x) * scale, (m.y - target.y) * scale);
      }
      return;
    }
    case 'onCircle': {
      const p = pointOf(layout, constraint.point), center = circleCenter(layout, compiled, constraint.circle), radius = radiusOf(layout, constraint.circle);
      const dx = p.x - center.x, dy = p.y - center.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) return;
      const slot = layout.offsets.get(constraint.point);
      const pointFree = Boolean(slot && (layout.free[slot.offset] || layout.free[slot.offset + 1]));
      if (pointFree) {
        const targetX = center.x + dx / length * radius, targetY = center.y + dy / length * radius;
        movePoint(layout, constraint.point, (targetX - p.x) * scale, (targetY - p.y) * scale);
      } else {
        // A pinned point defines the circle's radius instead of moving off it.
        moveRadius(layout, constraint.circle, (length - radius) * scale);
      }
      return;
    }
    case 'onLine': {
      const instance = compiled.instances.get(constraint.line);
      const segment = segmentOf(layout, instance);
      if (!segment) return;
      const p = pointOf(layout, constraint.point), target = projectPoint(segment, p);
      movePoint(layout, constraint.point, (target.x - p.x) * scale, (target.y - p.y) * scale);
      return;
    }
    case 'perpendicular':
    case 'parallel': {
      const first = compiled.instances.get(constraint.a), second = compiled.instances.get(constraint.b);
      const s1 = segmentOf(layout, first), s2 = segmentOf(layout, second);
      if (!first || !second || !s1 || !s2) return;
      const a1 = angleOfSegment(s1), a2 = angleOfSegment(s2);
      const target = constraint.type === 'perpendicular'
        ? a1 + (Math.abs(normalizeAngle(a2 - a1 - Math.PI / 2)) <= Math.abs(normalizeAngle(a2 - a1 + Math.PI / 2)) ? Math.PI / 2 : -Math.PI / 2)
        : a1 + Math.round((a2 - a1) / Math.PI) * Math.PI;
      const delta = normalizeAngle(target - a2);
      rotateSegment(layout, first, -delta * 0.5 * scale);
      rotateSegment(layout, second, delta * 0.5 * scale);
      return;
    }
    case 'equallength': {
      const first = compiled.instances.get(constraint.a), second = compiled.instances.get(constraint.b);
      const s1 = segmentOf(layout, first), s2 = segmentOf(layout, second);
      if (!first || !second || !s1 || !s2) return;
      const l1 = Math.hypot(s1.bx - s1.ax, s1.by - s1.ay), l2 = Math.hypot(s2.bx - s2.ax, s2.by - s2.ay);
      const target = (l1 + l2) / 2;
      scaleSegment(first, s1, l1 > 1e-9 ? target / l1 : 1, layout, scale);
      scaleSegment(second, s2, l2 > 1e-9 ? target / l2 : 1, layout, scale);
      return;
    }
    case 'horizontal': {
      const instance = compiled.instances.get(constraint.segment);
      const s = segmentOf(layout, instance);
      if (!instance || !s) return;
      const mid = (s.ay + s.by) / 2;
      movePoint(layout, instance.a!, 0, (mid - s.ay) * scale);
      movePoint(layout, instance.b!, 0, (mid - s.by) * scale);
      return;
    }
    case 'vertical': {
      const instance = compiled.instances.get(constraint.segment);
      const s = segmentOf(layout, instance);
      if (!instance || !s) return;
      const mid = (s.ax + s.bx) / 2;
      movePoint(layout, instance.a!, (mid - s.ax) * scale, 0);
      movePoint(layout, instance.b!, (mid - s.bx) * scale, 0);
      return;
    }
    case 'tangent': {
      const instance = compiled.instances.get(constraint.line);
      const s = segmentOf(layout, instance);
      const center = circleCenter(layout, compiled, constraint.circle), radius = radiusOf(layout, constraint.circle);
      if (!s) return;
      const dx = s.bx - s.ax, dy = s.by - s.ay, length = Math.hypot(dx, dy);
      if (length < 1e-9) return;
      const nx = -dy / length, ny = dx / length;
      const signed = (center.x - s.ax) * nx + (center.y - s.ay) * ny;
      const error = signed - Math.sign(signed || 1) * radius;
      const slot = layout.offsets.get(constraint.circle);
      if (slot && layout.free[slot.offset]) {
        movePoint(layout, constraint.circle, -nx * error * scale, -ny * error * scale);
      } else {
        moveRadius(layout, constraint.circle, Math.abs(signed) - radius);
      }
      return;
    }
    case 'radius': {
      moveRadius(layout, constraint.circle, (constraint.value - radiusOf(layout, constraint.circle)) * scale);
      return;
    }
    case 'angleat': {
      const vertex = pointOf(layout, constraint.vertex), a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      const a1 = Math.atan2(a.y - vertex.y, a.x - vertex.x), a2 = Math.atan2(b.y - vertex.y, b.x - vertex.x);
      const raw = Math.abs(normalizeAngle(a2 - a1));
      const delta = normalizeAngle(constraint.value - raw);
      const rotateAround = (point: { x: number; y: number }, angle: number) => {
        const dx = point.x - vertex.x, dy = point.y - vertex.y;
        return { x: vertex.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: vertex.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
      };
      const nextA = rotateAround(a, -delta * 0.5 * scale), nextB = rotateAround(b, delta * 0.5 * scale);
      movePoint(layout, constraint.a, nextA.x - a.x, nextA.y - a.y);
      movePoint(layout, constraint.b, nextB.x - b.x, nextB.y - b.y);
      return;
    }
    case 'fixed':
      return;
  }
}

function scaleSegment(instance: SubstanceInstance, s: { ax: number; ay: number; bx: number; by: number }, factor: number, layout: Layout, scale: number): void {
  const cx = (s.ax + s.bx) / 2, cy = (s.ay + s.by) / 2;
  const nextAx = cx + (s.ax - cx) * (1 + (factor - 1) * scale);
  const nextAy = cy + (s.ay - cy) * (1 + (factor - 1) * scale);
  const nextBx = cx + (s.bx - cx) * (1 + (factor - 1) * scale);
  const nextBy = cy + (s.by - cy) * (1 + (factor - 1) * scale);
  movePoint(layout, instance.a!, nextAx - s.ax, nextAy - s.ay);
  movePoint(layout, instance.b!, nextBx - s.bx, nextBy - s.by);
}

function applyPinTarget(layout: Layout, target: NonNullable<import('../types.ts').SolveOptions['pinTarget']>, strength: number): void {
  if (target.kind === 'point') {
    const p = pointOf(layout, target.substanceId);
    movePoint(layout, target.substanceId, (target.x! - p.x) * strength, (target.y! - p.y) * strength);
  } else {
    const r = radiusOf(layout, target.substanceId);
    moveRadius(layout, target.substanceId, (target.value - r) * strength);
  }
}

export function constraintResidual(layout: Layout, compiled: CompiledScope, constraint: Constraint): number {
  switch (constraint.type) {
    case 'distance': {
      const a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      return Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - constraint.value);
    }
    case 'coincident': {
      const a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      return Math.hypot(b.x - a.x, b.y - a.y);
    }
    case 'midpoint': {
      const m = pointOf(layout, constraint.point), a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      return Math.hypot(m.x - (a.x + b.x) / 2, m.y - (a.y + b.y) / 2);
    }
    case 'onCircle': {
      const p = pointOf(layout, constraint.point), center = circleCenter(layout, compiled, constraint.circle);
      return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radiusOf(layout, constraint.circle));
    }
    case 'onLine': {
      const instance = compiled.instances.get(constraint.line), s = segmentOf(layout, instance), p = pointOf(layout, constraint.point);
      return s ? lineDistance(p, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by }) : 0;
    }
    case 'perpendicular':
    case 'parallel': {
      const s1 = segmentOf(layout, compiled.instances.get(constraint.a)), s2 = segmentOf(layout, compiled.instances.get(constraint.b));
      if (!s1 || !s2) return 0;
      const d1x = s1.bx - s1.ax, d1y = s1.by - s1.ay, d2x = s2.bx - s2.ax, d2y = s2.by - s2.ay;
      const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
      if (l1 < 1e-9 || l2 < 1e-9) return 0;
      return constraint.type === 'perpendicular'
        ? Math.abs((d1x * d2x + d1y * d2y) / (l1 * l2))
        : Math.abs((d1x * d2y - d1y * d2x) / (l1 * l2));
    }
    case 'equallength': {
      const s1 = segmentOf(layout, compiled.instances.get(constraint.a)), s2 = segmentOf(layout, compiled.instances.get(constraint.b));
      if (!s1 || !s2) return 0;
      return Math.abs(Math.hypot(s1.bx - s1.ax, s1.by - s1.ay) - Math.hypot(s2.bx - s2.ax, s2.by - s2.ay));
    }
    case 'horizontal': {
      const s = segmentOf(layout, compiled.instances.get(constraint.segment));
      return s ? Math.abs(s.ay - s.by) : 0;
    }
    case 'vertical': {
      const s = segmentOf(layout, compiled.instances.get(constraint.segment));
      return s ? Math.abs(s.ax - s.bx) : 0;
    }
    case 'tangent': {
      const s = segmentOf(layout, compiled.instances.get(constraint.line));
      if (!s) return 0;
      return Math.abs(lineDistance(circleCenter(layout, compiled, constraint.circle), { x: s.ax, y: s.ay }, { x: s.bx, y: s.by }) - radiusOf(layout, constraint.circle));
    }
    case 'radius':
      return Math.abs(radiusOf(layout, constraint.circle) - constraint.value);
    case 'angleat': {
      const vertex = pointOf(layout, constraint.vertex), a = pointOf(layout, constraint.a), b = pointOf(layout, constraint.b);
      const a1 = Math.atan2(a.y - vertex.y, a.x - vertex.x), a2 = Math.atan2(b.y - vertex.y, b.x - vertex.x);
      return Math.abs(Math.abs(normalizeAngle(a2 - a1)) - constraint.value);
    }
    case 'fixed':
      return 0;
  }
}

export function solveState(compiled: CompiledScope, options: {
  seeds?: Record<EntityId, number[]>;
  memberPins?: MemberPins;
  config: ScopeProps['solverConfig'];
  iterations: number;
  pinTarget?: import('../types.ts').SolveOptions['pinTarget'];
  temporary?: readonly Constraint[];
  polish?: boolean;
}): SolvedState {
  const layout = layoutFor(compiled, options.memberPins);
  const clean = seedsAreClean(compiled, options.seeds);
  fillValues(layout, compiled, options.seeds);
  const dirty = !clean;
  const iterations = dirty ? Math.max(options.iterations, INIT_ITERATIONS) : Math.max(0, options.iterations);
  const constraints = options.temporary?.length ? [...compiled.constraints, ...options.temporary] : compiled.constraints;
  const damping = Math.min(1, Math.max(0.5, options.config.damping));
  const strength = Math.min(1, Math.max(0.05, options.pinTarget?.strength ?? PIN_STRENGTH));
  for (let pass = 0; pass < iterations; pass++) {
    if (options.pinTarget) applyPinTarget(layout, options.pinTarget, strength);
    for (const constraint of constraints) applyConstraint(layout, compiled, constraint, damping);
  }
  const perConstraint = constraints.map(constraint => constraintResidual(layout, compiled, constraint));
  const residual = perConstraint.reduce((max, value) => Math.max(max, value), 0);
  const stress = new Map<string, number>();
  constraints.forEach((constraint, index) => {
    for (const id of constraintInstances(constraint)) {
      stress.set(id, Math.max(stress.get(id) ?? 0, Math.min(1, perConstraint[index]! / 2)));
    }
  });
  return {
    values: layout.values,
    residual,
    perConstraint,
    stress,
    iterations,
    dirty,
    converged: residual <= options.config.convergenceTolerance,
  };
}

function constraintInstances(constraint: Constraint): string[] {
  switch (constraint.type) {
    case 'distance': return [constraint.a, constraint.b];
    case 'onCircle': return [constraint.point, constraint.circle];
    case 'onLine': return [constraint.point, constraint.line];
    case 'midpoint': return [constraint.point, constraint.a, constraint.b];
    case 'perpendicular':
    case 'parallel':
    case 'equallength': return [constraint.a, constraint.b];
    case 'tangent': return [constraint.line, constraint.circle];
    case 'coincident': return [constraint.a, constraint.b];
    case 'horizontal':
    case 'vertical': return [constraint.segment];
    case 'radius': return [constraint.circle];
    case 'angleat': return [constraint.vertex, constraint.a, constraint.b];
    case 'fixed': return [constraint.point];
  }
}

export function seedsFromValues(compiled: CompiledScope, values: Float64Array, existing: Record<EntityId, number[]> = {}): Record<EntityId, number[]> {
  const seeds: Record<EntityId, number[]> = { ...existing };
  for (const instance of compiled.instances.values()) {
    const entityId = compiled.bindings[instance.id];
    if (!entityId) continue;
    const slot = compiled.dofs.find(entry => entry.instanceId === instance.id);
    if (!slot) continue;
    if (slot.kind === 'point') seeds[entityId] = [round(values[slot.offset]!), round(values[slot.offset + 1]!)];
    else seeds[entityId] = [round(values[slot.offset]!)];
  }
  return seeds;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export { PIN_STRENGTH };
