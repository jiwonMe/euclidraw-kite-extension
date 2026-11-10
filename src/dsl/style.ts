import type { CompileError, StyleModel, StyleProps, StyleRule } from '../types.ts';
import { errorAt, parseNumber, unquote } from './tokens.ts';

/**
 * Style DSL: a selector list followed by `key: value` pairs.
 *
 *   point { r: 4.5; fill: #2563eb; label: false }
 *   segment, line { stroke: #475569; width: 2 }
 *   A { label: "A"; fill: #1d4ed8 }
 *
 * Rules merge in file order. A selector matches a substance id, a Domain type
 * name, or a primitive kind. Later rules win.
 */
export function parseStyle(text: string): StyleModel {
  const rules: StyleRule[] = [];
  const errors: CompileError[] = [];
  const source = String(text ?? '').replace(/\r\n/g, '\n')
    .split('\n').map(line => /^\s*(#|\/\/)/.test(line) ? '' : line).join('\n');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null, consumed = 0;
  while ((match = rulePattern.exec(source))) {
    const between = source.slice(consumed, match.index);
    for (const line of between.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        errors.push(errorAt(lineNumber(source, consumed + between.indexOf(line)), `Style 규칙 밖의 텍스트: ${trimmed}`));
      }
    }
    consumed = rulePattern.lastIndex;
    const selectors = match[1]!.replace(/\s+/g, ' ').split(',').map(value => value.trim()).filter(Boolean);
    if (!selectors.length) { errors.push(errorAt(lineNumber(source, match.index), 'Style 선택자가 비어 있습니다.')); continue; }
    const props: StyleProps = {};
    const body = match[2]!.replace(/\n/g, ';');
    for (const declaration of body.split(';')) {
      const entry = declaration.trim();
      if (!entry) continue;
      const pair = /^([A-Za-z_][\w-]*)\s*[:=]\s*(.+)$/.exec(entry);
      if (!pair) { errors.push(errorAt(lineNumber(source, match.index), `Style 속성을 해석할 수 없습니다: ${entry}`)); continue; }
      props[pair[1]!] = parseStyleValue(pair[2]!);
    }
    rules.push({ selectors, props, line: lineNumber(source, match.index) });
  }
  const rest = source.slice(consumed);
  for (const line of rest.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) errors.push(errorAt(0, `닫히지 않은 Style 규칙: ${trimmed}`));
  }
  return { rules, errors };
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, Math.max(0, index)).split('\n').length;
}

export function parseStyleValue(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (!value) return '';
  if ((value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) return unquote(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'none') return 'none';
  if (value === 'null') return null;
  const number = parseNumber(value);
  return number === undefined ? value : number;
}

export interface StyleLookup { id: string; kind: string; typeName: string }

/** Merge the base style, then every matching rule in declaration order. */
export function styleFor(rules: readonly StyleRule[], { id, kind, typeName }: StyleLookup): StyleProps {
  const style: StyleProps = {};
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (selector === id || selector === kind || selector === typeName) {
        Object.assign(style, rule.props);
        break;
      }
    }
  }
  return style;
}

/** Every numeric style field currently authored, for the inline parameter editor. */
export function numericStyleFields(rules: readonly StyleRule[]): { selector: string; key: string; value: number; line: number }[] {
  const fields: { selector: string; key: string; value: number; line: number }[] = [];
  for (const rule of rules) {
    for (const [key, value] of Object.entries(rule.props)) {
      if (typeof value !== 'number') continue;
      for (const selector of rule.selectors) fields.push({ selector, key, value, line: rule.line });
    }
  }
  return fields;
}
