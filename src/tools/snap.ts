import type { CompiledScope } from '../dsl/compile.ts';

/**
 * PRD §5.1.3: topological snap detection. Given the dragged point's current
 * solve, propose a constraint the user can promote by releasing with Shift.
 * Pure; works on scope-local DOFs.
 */
export interface SnapCandidate {
  readonly kind: 'midpoint' | 'perpendicular' | 'on-circle' | 'coincident' | 'on-line';
  /** Exactly the Substance statement appended on promotion. */
  readonly statement: string;
  /** HUD badge text. */
  readonly badge: string;
  /** Temporary bytecode constraint: [code, refs…, scalar, value]. */
  readonly temporary: { code: number; refs: [number, number, number, number]; scalar: number; value: number };
  readonly score: number;
}

const PERPENDICULAR_TOLERANCE = 1.5 * Math.PI / 180;

export function detectSnap(compiled: CompiledScope, dofs: ArrayLike<number>, dragged: string, snapLocal: number): SnapCandidate | undefined {
  const slot = compiled.dofs.find(entry => entry.substanceId === dragged && entry.kind === 'point');
  if (!slot) return undefined;
  const offOf = (id: string) => compiled.dofs.find(entry => entry.substanceId === id && entry.kind === 'point')?.off;
  const at = (off: number) => ({ x: dofs[off]!, y: dofs[off + 1]! });
  const p = at(slot.off);
  const has = (predicate: string, args: readonly string[]) => compiled.constraints.some(constraint => constraint.predicate === predicate && constraint.args.length === args.length && constraint.args.every((arg, index) => arg === args[index]));
  const candidates: SnapCandidate[] = [];
  for (const id of compiled.order) {
    const instance = compiled.instances[id]!;
    if (instance.kind === 'segment' && instance.a !== dragged && instance.b !== dragged) {
      const a = offOf(instance.a!), b = offOf(instance.b!);
      if (a === undefined || b === undefined) continue;
      const pa = at(a), pb = at(b);
      const distance = Math.hypot(p.x - (pa.x + pb.x) / 2, p.y - (pa.y + pb.y) / 2);
      if (distance <= snapLocal && !has('Midpoint', [dragged, instance.a!, instance.b!])) {
        candidates.push({ kind: 'midpoint', statement: `Midpoint(${dragged}, ${instance.a}, ${instance.b})`, badge: `+ 중점 고정 · Midpoint(${dragged}, ${instance.a}, ${instance.b})`, temporary: { code: 3, refs: [slot.off, a, b, -1], scalar: -1, value: 0 }, score: distance });
      }
    }
    if (instance.kind === 'circle' && instance.center !== dragged) {
      const centre = offOf(instance.center!), radiusSlot = compiled.dofs.find(entry => entry.substanceId === id && entry.kind === 'scalar');
      if (centre === undefined || !radiusSlot) continue;
      const c = at(centre), r = dofs[radiusSlot.off]!;
      const distance = Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
      if (distance <= snapLocal && !has('OnCircle', [dragged, id])) {
        candidates.push({ kind: 'on-circle', statement: `OnCircle(${dragged}, ${id})`, badge: `+ ○ 원 위에 고정 · OnCircle(${dragged}, ${id})`, temporary: { code: 4, refs: [slot.off, centre, -1, -1], scalar: radiusSlot.off, value: 0 }, score: distance + 0.01 });
      }
    }
    if (instance.kind === 'point' && id !== dragged) {
      const other = offOf(id)!;
      const distance = Math.hypot(p.x - dofs[other]!, p.y - dofs[other + 1]!);
      if (distance <= snapLocal * 0.6 && !has('Coincident', [dragged, id])) {
        candidates.push({ kind: 'coincident', statement: `Coincident(${dragged}, ${id})`, badge: `+ 일치 · Coincident(${dragged}, ${id})`, temporary: { code: 2, refs: [slot.off, other, -1, -1], scalar: -1, value: 0 }, score: distance - snapLocal });
      }
    }
  }
  // Perpendicular: two segments meeting at the dragged point (or ending at it).
  const segments = compiled.order.map(id => compiled.instances[id]!).filter(instance => instance.kind === 'segment' && (instance.a === dragged || instance.b === dragged));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const first = segments[i]!, second = segments[j]!;
    const ends = (line: typeof first) => [offOf(line.a!)!, offOf(line.b!)!] as const;
    const [a, b] = ends(first), [c, d] = ends(second);
    const u = { x: dofs[b]! - dofs[a]!, y: dofs[b + 1]! - dofs[a + 1]! }, v = { x: dofs[d]! - dofs[c]!, y: dofs[d + 1]! - dofs[c + 1]! };
    const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv))));
    const error = Math.abs(angle - Math.PI / 2);
    if (error <= PERPENDICULAR_TOLERANCE && !has('Perpendicular', [first.id, second.id]) && !has('Perpendicular', [second.id, first.id])) {
      candidates.push({ kind: 'perpendicular', statement: `Perpendicular(${first.id}, ${second.id})`, badge: `+ ⊥ 직교 고정 · Perpendicular(${first.id}, ${second.id})`, temporary: { code: 6, refs: [a, b, c, d], scalar: -1, value: 0 }, score: error * 50 });
    }
  }
  candidates.sort((left, right) => left.score - right.score);
  return candidates[0];
}
