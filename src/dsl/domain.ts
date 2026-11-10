import type { CompileError, DomainModel, DomainPredicate, DomainType, PrimitiveKind } from '../types.ts';
import { errorAt, isIdentifier, isPrimitiveKind, kindOf, PRIMITIVE_KINDS, sourceLines } from './tokens.ts';

/**
 * Domain DSL: object types, the primitive each paints, and predicate signatures.
 *
 *   type Point shape point
 *   predicate OnCircle(Point, Circle)
 */
export function parseDomain(text: string): DomainModel {
  const types = new Map<string, DomainType>();
  const predicates = new Map<string, DomainPredicate>();
  const errors: CompileError[] = [];
  for (const line of sourceLines(text)) {
    const source = line.text;
    let match = /^type\s+([A-Za-z_]\w*)(?:\s+shape\s+([A-Za-z][\w-]*))?(?:\s+extends\s+([A-Za-z_]\w*))?\s*$/.exec(source);
    if (match) {
      const [, name, shape, parent] = match;
      if (shape !== undefined && !isPrimitiveKind(kindOf(shape))) {
        errors.push(errorAt(line.number, `알 수 없는 프리미티브 shape: ${shape}`));
      }
      if (types.has(name!)) errors.push(errorAt(line.number, `타입 ${name}이(가) 중복 선언되었습니다.`));
      types.set(name!, {
        name: name!,
        ...(shape === undefined ? {} : { shape: kindOf(shape) as PrimitiveKind }),
        ...(parent === undefined ? {} : { parent }),
        line: line.number,
      });
      continue;
    }
    match = /^predicate\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*$/.exec(source);
    if (match) {
      const [, name, rawArgs] = match;
      const args = rawArgs!.trim() ? rawArgs!.split(',').map(value => value.trim()) : [];
      if (args.some(value => !isIdentifier(value))) {
        errors.push(errorAt(line.number, `predicate ${name}의 인자 타입은 식별자여야 합니다.`));
      }
      if (predicates.has(name!)) errors.push(errorAt(line.number, `predicate ${name}이(가) 중복 선언되었습니다.`));
      predicates.set(name!, { name: name!, args, line: line.number });
      continue;
    }
    errors.push(errorAt(line.number, `Domain 문법을 해석할 수 없습니다: ${source}`));
  }
  if (!types.size) errors.push(errorAt(0, 'Domain DSL에 타입이 하나도 없습니다.'));
  return { types, predicates, errors, typeNames: [...types.keys()], predicateNames: [...predicates.keys()] };
}

/** Resolve a type's primitive through its `extends` chain. */
export function primitiveOfType(domain: DomainModel, typeName: string): PrimitiveKind | undefined {
  let current = domain.types.get(typeName);
  const visited = new Set<string>();
  while (current) {
    if (current.shape) return current.shape;
    if (!current.parent || visited.has(current.parent)) return undefined;
    visited.add(current.parent);
    current = domain.types.get(current.parent);
  }
  return undefined;
}

export function knownType(domain: DomainModel, typeName: string): boolean {
  return domain.types.has(typeName);
}

export { PRIMITIVE_KINDS };
