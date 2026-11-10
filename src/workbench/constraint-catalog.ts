import type { CompiledScope, BuiltinPredicate } from '../dsl/compile.ts';
import type { KitePrimitiveKind } from '../schema.ts';

/**
 * Which constraints a selection of 1–3 members admits (PRD §6 Space 2B and §7.4).
 * Shared by the popover, the minibuffer and `kite: constrain`.
 */

export interface ConstraintAction {
  readonly id: string;
  readonly predicate: BuiltinPredicate;
  readonly label: string;
  /** Hangul + Latin aliases for the minibuffer's initial-consonant search. */
  readonly search: string;
  readonly statement: string;
  readonly needsValue?: 'distance' | 'angle' | 'radius';
}

type Picked = { id: string; kind: KitePrimitiveKind };
const LINE: readonly KitePrimitiveKind[] = ['segment', 'line', 'ray'];

/** Argument slots each predicate accepts, for completingRead prompts. */
export const PREDICATE_ARGS: Partial<Record<BuiltinPredicate, readonly { prompt: string; kinds: readonly KitePrimitiveKind[] }[]>> = {
  Tangent: [{ prompt: '접할 선 선택', kinds: LINE }, { prompt: '원 선택', kinds: ['circle'] }],
  Perpendicular: [{ prompt: '첫 번째 선', kinds: LINE }, { prompt: '두 번째 선', kinds: LINE }],
  Parallel: [{ prompt: '첫 번째 선', kinds: LINE }, { prompt: '두 번째 선', kinds: LINE }],
  EqualLength: [{ prompt: '첫 번째 선분', kinds: LINE }, { prompt: '두 번째 선분', kinds: LINE }],
  OnCircle: [{ prompt: '점 선택', kinds: ['point'] }, { prompt: '원 선택', kinds: ['circle'] }],
  OnLine: [{ prompt: '점 선택', kinds: ['point'] }, { prompt: '선 선택', kinds: LINE }],
  Midpoint: [{ prompt: '중점이 될 점', kinds: ['point'] }, { prompt: '끝점 A', kinds: ['point'] }, { prompt: '끝점 B', kinds: ['point'] }],
  Distance: [{ prompt: '첫 번째 점', kinds: ['point'] }, { prompt: '두 번째 점', kinds: ['point'] }],
  Coincident: [{ prompt: '첫 번째 점', kinds: ['point'] }, { prompt: '두 번째 점', kinds: ['point'] }],
  Horizontal: [{ prompt: '선분 선택', kinds: LINE }],
  Vertical: [{ prompt: '선분 선택', kinds: LINE }],
  Radius: [{ prompt: '원 선택', kinds: ['circle'] }],
};

export const PREDICATE_META: Partial<Record<BuiltinPredicate, { label: string; search: string; glyph: string }>> = {
  Tangent: { label: '접선', search: '접선 tangent ㅈㅅ', glyph: 'T' },
  Perpendicular: { label: '직교', search: '직교 수직 perpendicular ㅈㄱ', glyph: '⊥' },
  Parallel: { label: '평행', search: '평행 parallel ㅍㅎ', glyph: '//' },
  EqualLength: { label: '등길이', search: '등길이 같은길이 equal length ㄷㄱㅇ', glyph: '=' },
  OnCircle: { label: '원 위에 배치', search: '원위 원 위에 on circle ㅇㅇ', glyph: '○' },
  OnLine: { label: '선 위에 배치', search: '선위 선 위에 on line ㅅㅇ', glyph: '—' },
  Midpoint: { label: '중점', search: '중점 midpoint ㅈㅈ', glyph: '½' },
  Distance: { label: '거리 고정', search: '거리 distance ㄱㄹ', glyph: '↔' },
  Coincident: { label: '일치', search: '일치 coincident ㅇㅊ', glyph: '•' },
  Horizontal: { label: '수평', search: '수평 horizontal ㅅㅍ', glyph: 'H' },
  Vertical: { label: '연직', search: '연직 세로 vertical ㅇㅈ', glyph: 'V' },
  Radius: { label: '반지름 고정', search: '반지름 radius ㅂㅈㄹ', glyph: 'r' },
};

function subtype(compiled: CompiledScope, typeName: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected === 'Number') return true;
  const seen = new Set<string>();
  for (let current = typeName; current && !seen.has(current); current = compiled.types[current]?.parent) { if (current === expected) return true; seen.add(current); }
  return false;
}

export function actionsFor(compiled: CompiledScope, picked: readonly Picked[]): ConstraintAction[] {
  const points = picked.filter(item => item.kind === 'point');
  const lines = picked.filter(item => LINE.includes(item.kind));
  const circles = picked.filter(item => item.kind === 'circle');
  const out: ConstraintAction[] = [];
  const push = (predicate: BuiltinPredicate, args: readonly string[], label?: string, needsValue?: ConstraintAction['needsValue']) => {
    const meta = PREDICATE_META[predicate]!;
    // Respect Domain signatures that narrow a builtin (predicate Tangent(Line, Circle)).
    const typed = compiled.predicates[predicate]?.args;
    if (typed && args.some((arg, index) => !subtype(compiled, compiled.instances[arg]?.type, typed[index]))) return;
    const statement = `${predicate}(${args.join(', ')}${needsValue ? ', ?' : ''})`;
    if (compiled.constraints.some(constraint => constraint.predicate === predicate && constraint.args.slice(0, args.length).join(',') === args.join(','))) return;
    out.push({ id: `${predicate}:${args.join(',')}`, predicate, label: label ?? `${meta.glyph} ${meta.label}`, search: `${meta.search} ${args.join(' ')}`, statement, ...(needsValue ? { needsValue } : {}) });
  };
  if (picked.length < 1 || picked.length > 3) return out;
  if (points.length === 1 && circles.length === 1 && picked.length === 2) push('OnCircle', [points[0]!.id, circles[0]!.id], '○ 원 위에 배치');
  if (points.length === 2 && circles.length === 1) {
    // "Endpoints of a diameter": both on the circle and the centre their midpoint.
    const centre = compiled.instances[circles[0]!.id]?.center;
    if (centre) out.push({ id: `Diameter:${points[0]!.id},${points[1]!.id},${circles[0]!.id}`, predicate: 'Midpoint', label: '⌀ 지름의 양 끝점', search: '지름 diameter ㅈㄹ', statement: [`OnCircle(${points[0]!.id}, ${circles[0]!.id})`, `OnCircle(${points[1]!.id}, ${circles[0]!.id})`, `Midpoint(${centre}, ${points[0]!.id}, ${points[1]!.id})`].join('\n') });
  }
  if (points.length === 1 && lines.length === 1 && picked.length === 2) {
    push('OnLine', [points[0]!.id, lines[0]!.id], '— 선 위에 배치');
    const line = compiled.instances[lines[0]!.id];
    if (line?.a && line.b && line.a !== points[0]!.id && line.b !== points[0]!.id) push('Midpoint', [points[0]!.id, line.a, line.b], '½ 선분의 중점');
  }
  if (lines.length === 2 && picked.length === 2) {
    push('Perpendicular', [lines[0]!.id, lines[1]!.id]);
    push('Parallel', [lines[0]!.id, lines[1]!.id]);
    push('EqualLength', [lines[0]!.id, lines[1]!.id]);
  }
  if (lines.length === 1 && circles.length === 1 && picked.length === 2) push('Tangent', [lines[0]!.id, circles[0]!.id]);
  if (lines.length === 1 && picked.length === 1) { push('Horizontal', [lines[0]!.id]); push('Vertical', [lines[0]!.id]); }
  if (points.length === 2 && picked.length === 2) { push('Distance', [points[0]!.id, points[1]!.id], undefined, 'distance'); push('Coincident', [points[0]!.id, points[1]!.id]); }
  if (points.length === 3 && picked.length === 3) push('Midpoint', [points[0]!.id, points[1]!.id, points[2]!.id]);
  if (circles.length === 1 && picked.length === 1) push('Radius', [circles[0]!.id], undefined, 'radius');
  return out;
}
