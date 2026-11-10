import type {
  Badges, CompiledScope, CompileError, Constraint, DofSlot, PrimitiveKind, ScopeProps, StyleProps,
  SubstanceInstance,
} from '../types.ts';
import { parseDomain, primitiveOfType } from './domain.ts';
import { parseSubstance, BUILTIN_PREDICATES, type RawConstraint } from './substance.ts';
import { parseStyle, styleFor } from './style.ts';
import { errorAt, parseNumber } from './tokens.ts';

export const BASE_STYLE: Record<PrimitiveKind, StyleProps> = {
  point: { r: 4.5, fill: '#2563eb', stroke: '#ffffff', width: 1.5, label: false, fontSize: 14 },
  segment: { stroke: '#475569', width: 2, fill: 'none', dash: 0, ticks: true },
  line: { stroke: '#475569', width: 2, fill: 'none', dash: 0, ticks: false },
  ray: { stroke: '#475569', width: 2, fill: 'none', dash: 0, ticks: false },
  circle: { stroke: '#94a3b8', width: 1.75, fill: 'none', dash: 0 },
  arc: { stroke: '#f59e0b', width: 1.75, fill: 'none', dash: 0 },
  polygon: { stroke: '#475569', width: 2, fill: 'none', dash: 0 },
  'angle-mark': { stroke: '#f59e0b', width: 1.5, fill: 'none', radius: 22, label: false, fontSize: 13 },
  'label-anchor': { stroke: 'none', fill: '#334155', width: 0, fontSize: 15 },
};

const LINE_KINDS: readonly PrimitiveKind[] = ['segment', 'line', 'ray'];
const DEFAULT_SOFT_WEIGHT = 0.25;

/** Compile the three DSL strings into a deterministic constraint topology. */
export function compileScope(scope: Readonly<ScopeProps>): CompiledScope {
  const domainSource = String(scope.domainDsl ?? '');
  const substanceSource = String(scope.substanceDsl ?? '');
  const styleSource = String(scope.styleDsl ?? '');
  const domain = parseDomain(domainSource);
  const substance = parseSubstance(substanceSource, domain);
  const style = parseStyle(styleSource);
  const errors: CompileError[] = [...domain.errors, ...substance.errors, ...style.errors];
  const { instances, constraints, pinned } = substance;

  for (const constraint of constraints) {
    if (!BUILTIN_PREDICATES.includes(constraint.name)) {
      errors.push(errorAt(constraint.line, `지원하지 않는 predicate입니다: ${constraint.name}`));
    }
    const declared = domain.predicates.get(constraint.name);
    if (declared && declared.args.length !== constraint.args.length) {
      errors.push(errorAt(constraint.line, `${constraint.name}은(는) 인자 ${declared.args.length}개가 필요합니다.`));
    }
  }

  const normalized: Constraint[] = [];
  const pinnedPoints = new Set(pinned);
  for (const constraint of constraints) {
    if (!BUILTIN_PREDICATES.includes(constraint.name)) continue;
    const built = normalizeConstraint(constraint, instances, errors);
    if (!built) continue;
    if (built.type === 'fixed') { pinnedPoints.add(built.point); continue; }
    normalized.push(built);
  }

  const dofs: DofSlot[] = [];
  let dofCount = 0;
  for (const instance of instances.values()) {
    if (instance.kind === 'point') { dofs.push({ instanceId: instance.id, kind: 'point', offset: dofCount, size: 2 }); dofCount += 2; }
    else if (instance.kind === 'circle') { dofs.push({ instanceId: instance.id, kind: 'circle', offset: dofCount, size: 1 }); dofCount += 1; }
  }
  const layoutSignature = dofs.map(slot => `${slot.instanceId}:${slot.kind}:${slot.offset}`).join('|');

  const styles = new Map<string, StyleProps>();
  for (const instance of instances.values()) {
    styles.set(instance.id, {
      ...(BASE_STYLE[instance.kind] ?? {}),
      ...styleFor(style.rules, { id: instance.id, kind: instance.kind, typeName: instance.typeName }),
    });
  }

  return {
    key: `${domainSource}\u0000${substanceSource}\u0000${styleSource}`,
    ok: errors.length === 0,
    errors,
    domain,
    substance,
    style,
    instances,
    order: [...instances.keys()],
    constraints: normalized,
    pinned: pinnedPoints,
    dofs,
    dofCount,
    layoutSignature,
    styles,
    badges: buildBadges(instances, normalized),
    labels: [...instances.values()].filter(instance => instance.kind === 'label-anchor'),
    bindings: { ...(scope.entityBindings ?? {}) },
  };
}

function instanceOf(instances: Map<string, SubstanceInstance>, id: string, kinds: readonly PrimitiveKind[] | undefined, constraint: RawConstraint, errors: CompileError[]): SubstanceInstance | undefined {
  const instance = instances.get(id);
  if (!instance) { errors.push(errorAt(constraint.line, `${constraint.name}: ${id} 개체를 찾을 수 없습니다.`)); return undefined; }
  if (kinds && !kinds.includes(instance.kind)) { errors.push(errorAt(constraint.line, `${constraint.name}: ${id}의 종류가 맞지 않습니다 (${instance.kind}).`)); return undefined; }
  return instance;
}

function pointOf(instances: Map<string, SubstanceInstance>, id: string, constraint: RawConstraint, errors: CompileError[]) {
  return instanceOf(instances, id, ['point'], constraint, errors);
}
function lineOf(instances: Map<string, SubstanceInstance>, id: string, constraint: RawConstraint, errors: CompileError[]) {
  return instanceOf(instances, id, LINE_KINDS, constraint, errors);
}
function circleOf(instances: Map<string, SubstanceInstance>, id: string, constraint: RawConstraint, errors: CompileError[]) {
  return instanceOf(instances, id, ['circle'], constraint, errors);
}

function normalizeConstraint(constraint: RawConstraint, instances: Map<string, SubstanceInstance>, errors: CompileError[]): Constraint | undefined {
  const { name, args, soft, line: sourceLine } = constraint;
  const weight = soft ? DEFAULT_SOFT_WEIGHT : 1;
  const fail = (message: string): undefined => { errors.push(errorAt(sourceLine, `${name}: ${message}`)); return undefined; };
  const number = (raw: string | undefined, label = '값'): number | undefined => {
    const value = parseNumber(raw ?? '');
    if (value === undefined) { fail(`${label}이(가) 숫자가 아닙니다: ${raw ?? ''}`); return undefined; }
    return value;
  };
  const text = constraintText(constraint);
  switch (name) {
    case 'Distance': {
      if (args.length !== 3) return fail('인자 2개와 거리 1개가 필요합니다.');
      if (!pointOf(instances, args[0]!, constraint, errors) || !pointOf(instances, args[1]!, constraint, errors)) return undefined;
      const value = number(args[2], '거리');
      return value === undefined ? undefined : { type: 'distance', a: args[0]!, b: args[1]!, value, soft, weight, sourceLine, text };
    }
    case 'OnCircle': {
      if (args.length !== 2) return fail('점과 원이 필요합니다.');
      if (!pointOf(instances, args[0]!, constraint, errors) || !circleOf(instances, args[1]!, constraint, errors)) return undefined;
      return { type: 'onCircle', point: args[0]!, circle: args[1]!, soft, weight, sourceLine, text };
    }
    case 'OnLine': {
      if (args.length !== 2) return fail('점과 선이 필요합니다.');
      if (!pointOf(instances, args[0]!, constraint, errors) || !lineOf(instances, args[1]!, constraint, errors)) return undefined;
      return { type: 'onLine', point: args[0]!, line: args[1]!, soft, weight, sourceLine, text };
    }
    case 'Midpoint': {
      if (args.length !== 3) return fail('중점과 두 끝점이 필요합니다.');
      if (!args.every(id => pointOf(instances, id, constraint, errors))) return undefined;
      return { type: 'midpoint', point: args[0]!, a: args[1]!, b: args[2]!, soft, weight, sourceLine, text };
    }
    case 'Perpendicular':
    case 'Parallel':
    case 'EqualLength': {
      if (args.length !== 2) return fail('선분 두 개가 필요합니다.');
      if (!lineOf(instances, args[0]!, constraint, errors) || !lineOf(instances, args[1]!, constraint, errors)) return undefined;
      const type = name === 'Perpendicular' ? 'perpendicular' : name === 'Parallel' ? 'parallel' : 'equallength';
      return { type, a: args[0]!, b: args[1]!, soft, weight, sourceLine, text } as Constraint;
    }
    case 'Tangent': {
      if (args.length !== 2) return fail('선과 원이 필요합니다.');
      if (!lineOf(instances, args[0]!, constraint, errors) || !circleOf(instances, args[1]!, constraint, errors)) return undefined;
      return { type: 'tangent', line: args[0]!, circle: args[1]!, soft, weight, sourceLine, text };
    }
    case 'Coincident': {
      if (args.length !== 2) return fail('점 두 개가 필요합니다.');
      if (!args.every(id => pointOf(instances, id, constraint, errors))) return undefined;
      return { type: 'coincident', a: args[0]!, b: args[1]!, soft, weight, sourceLine, text };
    }
    case 'Horizontal':
    case 'Vertical': {
      if (args.length !== 1) return fail('선분 하나가 필요합니다.');
      if (!lineOf(instances, args[0]!, constraint, errors)) return undefined;
      return { type: name === 'Horizontal' ? 'horizontal' : 'vertical', segment: args[0]!, soft, weight, sourceLine, text };
    }
    case 'Radius': {
      if (args.length !== 2) return fail('원과 반지름이 필요합니다.');
      if (!circleOf(instances, args[0]!, constraint, errors)) return undefined;
      const value = number(args[1], '반지름');
      return value === undefined ? undefined : { type: 'radius', circle: args[0]!, value, soft, weight, sourceLine, text };
    }
    case 'AngleAt': {
      if (args.length !== 4) return fail('꼭짓점, 두 점, 각도가 필요합니다.');
      if (!args.slice(0, 3).every(id => pointOf(instances, id, constraint, errors))) return undefined;
      const degrees = number(args[3], '각도');
      return degrees === undefined ? undefined : { type: 'angleat', vertex: args[0]!, a: args[1]!, b: args[2]!, value: degrees * Math.PI / 180, soft, weight, sourceLine, text };
    }
    case 'Fixed': {
      if (args.length !== 1) return fail('점 하나가 필요합니다.');
      if (!pointOf(instances, args[0]!, constraint, errors)) return undefined;
      return { type: 'fixed', point: args[0]!, soft: false, weight: 1, sourceLine, text };
    }
    default:
      return fail('알 수 없는 predicate입니다.');
  }
}

function constraintText(constraint: RawConstraint): string {
  return `${constraint.soft ? 'soft ' : ''}${constraint.name}(${constraint.args.join(', ')})`;
}

function buildBadges(instances: Map<string, SubstanceInstance>, constraints: readonly Constraint[]): Badges {
  const ticks = new Map<string, number>();
  const rightAngles: { vertex: string; a: string; b: string }[] = [];
  const onCircle = new Map<string, string>();
  for (const constraint of constraints) {
    if (constraint.type === 'equallength') {
      ticks.set(constraint.a, (ticks.get(constraint.a) ?? 0) + 1);
      ticks.set(constraint.b, (ticks.get(constraint.b) ?? 0) + 1);
    } else if (constraint.type === 'onCircle') {
      onCircle.set(constraint.point, constraint.circle);
    }
  }
  for (const constraint of constraints) {
    if (constraint.type !== 'perpendicular') continue;
    const first = instances.get(constraint.a), second = instances.get(constraint.b);
    if (!first || !second) continue;
    const shared = [first.a, first.b].find(point => point === second.a || point === second.b);
    if (shared) rightAngles.push({ vertex: shared, a: constraint.a, b: constraint.b });
  }
  return { ticks, rightAngles, onCircle };
}

export function memberStyle(compiled: CompiledScope, substanceId: string): StyleProps {
  return compiled.styles.get(substanceId) ?? {};
}

export function substanceKind(compiled: CompiledScope, substanceId: string): PrimitiveKind | undefined {
  return compiled.instances.get(substanceId)?.kind;
}

export function typeShape(domain: CompiledScope['domain'], typeName: string): PrimitiveKind | undefined {
  return primitiveOfType(domain, typeName);
}
