import type { CompileError, DomainModel, LabelSpec, SubstanceInstance } from '../types.ts';
import { errorAt, isIdentifier, parseAngleDegrees, parseNumber, parsePair, sourceLines, splitArguments, unquote } from './tokens.ts';
import { primitiveOfType } from './domain.ts';

export interface RawConstraint { name: string; args: string[]; soft: boolean; line: number; implicit?: boolean }
export interface SubstanceModel {
  instances: Map<string, SubstanceInstance>;
  constraints: RawConstraint[];
  pinned: Set<string>;
  errors: CompileError[];
}

/**
 * Substance DSL: geometry declarations plus logical constraints.
 *
 *   Point A = (90, 250) pin
 *   Circle c1 = center M through B
 *   Segment AB = A .. B
 *   Label lab = "c₁" at center c1 offset (0, 16)
 *   Perpendicular(AB, BC)
 *   soft Distance(A, B, 100)
 */
export function parseSubstance(text: string, domain: DomainModel): SubstanceModel {
  const instances = new Map<string, SubstanceInstance>();
  const constraints: RawConstraint[] = [];
  const pinned = new Set<string>();
  const errors: CompileError[] = [];

  for (const line of sourceLines(text)) {
    const source = line.text;

    let match = /^(pin|unpin)\s+([A-Za-z_]\w*)\s*$/.exec(source);
    if (match) {
      if (match[1] === 'pin') pinned.add(match[2]!); else pinned.delete(match[2]!);
      continue;
    }

    match = /^(soft\s+)?([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(source);
    if (match) {
      const [, soft, name, rawArgs] = match;
      const args = splitArguments(rawArgs!);
      constraints.push({ name: name!, args, soft: Boolean(soft), line: line.number });
      if (name === 'Fixed' && args[0]) pinned.add(args[0]);
      continue;
    }

    match = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(source);
    if (!match) {
      errors.push(errorAt(line.number, `Substance 문법을 해석할 수 없습니다: ${source}`));
      continue;
    }
    const [, typeName, id, rawValue] = match;
    const instanceId = id!;
    if (instances.has(instanceId)) {
      errors.push(errorAt(line.number, `개체 ${instanceId}이(가) 중복 선언되었습니다.`));
      continue;
    }
    const kind = primitiveOfType(domain, typeName!);
    if (!kind) {
      errors.push(errorAt(line.number, `Domain에 없는 타입입니다: ${typeName}`));
      continue;
    }
    const value = rawValue!.trim();
    const instance: SubstanceInstance = { id: instanceId, typeName: typeName!, kind, line: line.number };
    try {
      if (kind === 'point') {
        const pin = /(?:^|\s)pin\s*$/.test(value);
        const pair = parsePair(value.replace(/(?:^|\s)pin\s*$/, ''));
        if (!pair) throw new Error('점 좌표는 (x, y) 형식이어야 합니다.');
        instance.x = pair[0];
        instance.y = pair[1];
        instance.pinned = pin;
        if (pin) pinned.add(instanceId);
      } else if (kind === 'circle') {
        const centered = /^center\s+([A-Za-z_]\w*)\s+r\s+(.+)$/i.exec(value);
        const through = /^center\s+([A-Za-z_]\w*)\s+through\s+([A-Za-z_]\w*)$/i.exec(value);
        if (centered) {
          instance.center = centered[1]!;
          const radius = parseNumber(centered[2]!);
          if (radius === undefined || radius <= 0) throw new Error('원 반지름 r은 양수여야 합니다.');
          instance.radius = radius;
        } else if (through) {
          instance.center = through[1]!;
          instance.through = through[2]!;
          instance.radius = 100;
          constraints.push({ name: 'OnCircle', args: [through[2]!, instanceId], soft: false, line: line.number, implicit: true });
        } else {
          throw new Error('원은 `center <점> r <반지름>` 또는 `center <점> through <점>`으로 선언합니다.');
        }
      } else if (kind === 'segment' || kind === 'line' || kind === 'ray') {
        const pair = /^([A-Za-z_]\w*)\s*\.\.\s*([A-Za-z_]\w*)$/.exec(value);
        if (!pair) throw new Error('선분은 `A .. B` 형식이어야 합니다.');
        instance.a = pair[1]!;
        instance.b = pair[2]!;
      } else if (kind === 'arc') {
        const arc = /^center\s+([A-Za-z_]\w*)\s+r\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)$/i.exec(value);
        if (!arc) throw new Error('호는 `center <점> r <반지름> from <도> to <도>` 형식이어야 합니다.');
        const radius = parseNumber(arc[2]!);
        const start = parseAngleDegrees(arc[3]!);
        const end = parseAngleDegrees(arc[4]!);
        if (radius === undefined || radius <= 0 || start === undefined || end === undefined) throw new Error('호의 반지름과 각도가 유효하지 않습니다.');
        instance.center = arc[1]!;
        instance.radius = radius;
        instance.startAngle = start;
        instance.endAngle = end;
      } else if (kind === 'polygon') {
        const points = value.split(/\s+/).filter(Boolean);
        if (points.length < 3 || points.some(point => !isIdentifier(point))) throw new Error('다각형은 세 개 이상의 점 이름이 필요합니다.');
        instance.points = points;
      } else if (kind === 'angle-mark') {
        const points = value.split(/\s+/).filter(Boolean);
        if (points.length !== 3 || points.some(point => !isIdentifier(point))) throw new Error('각도 표기는 `A B C`처럼 세 점이 필요합니다.');
        instance.angle = [points[0]!, points[1]!, points[2]!];
      } else if (kind === 'label-anchor') {
        instance.label = parseLabel(value);
      }
    } catch (error) {
      errors.push(errorAt(line.number, `${typeName} ${instanceId}: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    instances.set(instanceId, instance);
  }

  for (const instance of instances.values()) {
    for (const [field, expected] of [['center', 'point'], ['a', 'point'], ['b', 'point'], ['through', 'point']] as const) {
      const target = instance[field];
      if (target === undefined) continue;
      const referenced = instances.get(target);
      if (!referenced) errors.push(errorAt(instance.line, `${instance.id}: ${target} 개체를 찾을 수 없습니다.`));
      else if (referenced.kind !== expected) errors.push(errorAt(instance.line, `${instance.id}: ${target}은(는) 점이 아닙니다.`));
    }
    for (const point of instance.points ?? []) {
      if (instances.get(point)?.kind !== 'point') errors.push(errorAt(instance.line, `${instance.id}: ${point}은(는) 점이 아닙니다.`));
    }
    for (const point of instance.angle ?? []) {
      if (instances.get(point)?.kind !== 'point') errors.push(errorAt(instance.line, `${instance.id}: ${point}은(는) 점이 아닙니다.`));
    }
    if (instance.label) {
      const anchor = instance.label.anchor;
      const target = instances.get(anchor.id);
      if (!target) errors.push(errorAt(instance.line, `${instance.id}: ${anchor.id} 개체를 찾을 수 없습니다.`));
      else if (anchor.kind === 'point' && target.kind !== 'point') errors.push(errorAt(instance.line, `${instance.id}: ${anchor.id}은(는) 점이 아닙니다.`));
      else if (anchor.kind === 'center' && !['circle', 'arc', 'polygon'].includes(target.kind)) errors.push(errorAt(instance.line, `${instance.id}: ${anchor.id}은(는) 중심을 가진 개체가 아닙니다.`));
      else if (anchor.kind === 'midpoint' && !['segment', 'line', 'ray'].includes(target.kind)) errors.push(errorAt(instance.line, `${instance.id}: ${anchor.id}은(는) 선분이 아닙니다.`));
    }
  }

  return { instances, constraints, pinned, errors };
}

function parseLabel(value: string): LabelSpec {
  const match = /^(.+?)\s+at\s+(point|center|midpoint)\s+([A-Za-z_]\w*)\s+offset\s+(.+)$/i.exec(value);
  if (!match) throw new Error('라벨은 `"텍스트" at midpoint <id> offset <값>` 형식이어야 합니다.');
  const text = unquote(match[1]!);
  if (!text) throw new Error('라벨 텍스트가 비어 있습니다.');
  const anchor = { kind: match[2]!.toLowerCase() as 'point' | 'center' | 'midpoint', id: match[3]! };
  const rawOffset = match[4]!.trim();
  const pair = parsePair(rawOffset);
  const offset = pair ?? parseNumber(rawOffset);
  if (offset === undefined) throw new Error('라벨 오프셋이 유효하지 않습니다.');
  return {
    text,
    anchor,
    ...(Array.isArray(offset)
      ? { offsetX: offset[0], offsetY: offset[1], offsetMode: 'vector' as const }
      : { offset: offset as number, offsetMode: 'normal' as const }),
  };
}

export const BUILTIN_PREDICATES: readonly string[] = Object.freeze([
  'Distance', 'OnCircle', 'OnLine', 'Midpoint', 'Perpendicular', 'Parallel', 'EqualLength',
  'Tangent', 'Coincident', 'Horizontal', 'Vertical', 'Radius', 'AngleAt', 'Fixed',
]);
