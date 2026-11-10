import { describe, expect, it } from 'vitest';
import { compileScope } from '../src/dsl/compile.ts';
import { parseDomain } from '../src/dsl/domain.ts';
import { parseSubstance } from '../src/dsl/substance.ts';
import { numericStyleFields, parseStyle, styleFor } from '../src/dsl/style.ts';
import { createScopeDefaults, DEFAULT_DOMAIN, DEFAULT_STYLE, DEFAULT_SUBSTANCE } from '../src/defaults.ts';
import { setStyleNumber } from '../src/panel/tri-editor.ts';

describe('Domain / Substance / Style DSL', () => {
  it('compiles the default example without errors', () => {
    const compiled = compileScope(createScopeDefaults());
    expect(compiled.errors).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(compiled.instances.get('P')?.kind).toBe('point');
    expect(compiled.instances.get('c1')?.kind).toBe('circle');
    expect(compiled.instances.get('angB')?.kind).toBe('angle-mark');
    expect(compiled.constraints.map(constraint => constraint.type)).toEqual([
      'perpendicular', 'equallength', 'midpoint', 'onCircle', 'onCircle',
    ]);
    expect(compiled.pinned.has('A')).toBe(true);
    expect(compiled.pinned.has('B')).toBe(true);
    expect(compiled.dofCount).toBe(5 * 2 + 1);
  });

  it('is deterministic for identical sources', () => {
    const first = compileScope(createScopeDefaults());
    const second = compileScope(createScopeDefaults());
    expect(first.key).toBe(second.key);
    expect(first.layoutSignature).toBe(second.layoutSignature);
    expect([...first.instances.keys()]).toEqual([...second.instances.keys()]);
  });

  it('reports unknown types, predicates and wrong arity', () => {
    const domain = parseDomain(DEFAULT_DOMAIN);
    expect(domain.errors).toEqual([]);
    const parsed = parseSubstance(`Point A = (0, 0)\nNope B = (1, 1)\nOnCircle(A)\nUnknown(A)`, domain);
    expect(parsed.errors.some(error => error.message.includes('Domain에 없는 타입'))).toBe(true);
    const compiled = compileScope({ ...createScopeDefaults(), substanceDsl: `Point A = (0, 0)\nOnCircle(A)` });
    expect(compiled.ok).toBe(false);
    expect(compiled.errors.some(error => error.message.includes('인자 2개'))).toBe(true);
  });

  it('reports labelled syntax errors with line numbers', () => {
    const compiled = compileScope({ ...createScopeDefaults(), substanceDsl: `Point A = (0, 0)\nLabel x = "hi" at midpoint A offset 4` });
    expect(compiled.ok).toBe(false);
    expect(compiled.errors[0]?.line).toBe(2);
    expect(compiled.errors[0]?.message).toContain('선분이 아닙니다');
  });

  it('merges style rules in file order and exposes numeric fields', () => {
    const style = parseStyle(DEFAULT_STYLE);
    expect(style.errors).toEqual([]);
    expect(styleFor(style.rules, { id: 'P', kind: 'point', typeName: 'Point' })).toMatchObject({ fill: '#dc2626', label: 'P' });
    const fields = numericStyleFields(style.rules);
    expect(fields.some(field => field.selector === 'point' && field.key === 'r')).toBe(true);
    const compiled = compileScope(createScopeDefaults());
    expect(compiled.styles.get('P')?.fill).toBe('#dc2626');
  });

  it('rewrites one numeric style field without touching other rules', () => {
    const next = setStyleNumber(DEFAULT_STYLE, 'point', 'r', 9.5);
    expect(next).toContain('point { r: 9.5;');
    expect(next).toContain('segment { stroke: #475569; width: 2;');
    const again = setStyleNumber(next, 'segment', 'width', 3);
    expect(again).toContain('segment { stroke: #475569; width: 3;');
  });

  it('supports `through` as an implicit OnCircle constraint', () => {
    const substance = `Point A = (0, 0)\nPoint B = (50, 0)\nCircle c = center A through B`;
    const compiled = compileScope({ ...createScopeDefaults(), substanceDsl: substance });
    expect(compiled.ok).toBe(true);
    expect(compiled.constraints).toContainEqual(expect.objectContaining({ type: 'onCircle', point: 'B', circle: 'c' }));
  });

  it('keeps the domain and substance sources independent', () => {
    expect(DEFAULT_DOMAIN).toContain('predicate OnCircle');
    expect(DEFAULT_SUBSTANCE).toContain('OnCircle(P, c1)');
    expect(DEFAULT_STYLE).toContain('label-anchor');
  });
});
