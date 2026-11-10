import type { CompileError, PrimitiveKind } from '../types.ts';

/** Line-oriented DSL helpers shared by the Domain, Substance and Style parsers. */

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = Object.freeze([
  'point',
  'segment',
  'line',
  'ray',
  'circle',
  'arc',
  'polygon',
  'angle-mark',
  'label-anchor',
]);

const KIND_ALIASES: Record<string, PrimitiveKind> = {
  angle: 'angle-mark',
  label: 'label-anchor',
  text: 'label-anchor',
};

export function kindOf(shape: string): PrimitiveKind | string {
  const value = shape.trim().toLowerCase();
  return KIND_ALIASES[value] ?? value;
}

export function isPrimitiveKind(value: string): value is PrimitiveKind {
  return (PRIMITIVE_KINDS as readonly string[]).includes(value);
}

/** Remove a trailing `//` comment without touching quoted strings. */
export function stripComment(source: string): string {
  let quote: string | null = null;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '/' && source[index + 1] === '/') return source.slice(0, index).trimEnd();
  }
  return source.trimEnd();
}

export interface SourceLine { number: number; text: string }

/** Split source into numbered, nonempty lines with comments removed. */
export function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const line = stripComment(trimmed).trim();
    if (line) lines.push({ number: index + 1, text: line });
  });
  return lines;
}

/** Split a parenthesised argument list, respecting quotes and nesting. */
export function splitArguments(source: string): string[] {
  const args: string[] = [];
  let current = '', quote: string | null = null, depth = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      current += character;
      if (character === '\\') { current += source[++index] ?? ''; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '(') { depth++; current += character; continue; }
    if (character === ')') { depth--; current += character; continue; }
    if (character === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim() || args.length) args.push(current.trim());
  return args;
}

export function unquote(source: string): string {
  const value = source.trim();
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    return value.slice(1, -1).replace(/\\(["'\\n])/g, (_match, escape: string) => escape === 'n' ? '\n' : escape);
  }
  return value;
}

export function parseNumber(source: string | number): number | undefined {
  if (typeof source === 'number') return Number.isFinite(source) ? source : undefined;
  const value = Number(source.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** `(x, y)` or `x, y`; returns undefined instead of guessing. */
export function parsePair(source: string): [number, number] | undefined {
  const match = /^\(?\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)?$/.exec(source.trim());
  if (!match) return undefined;
  const x = parseNumber(match[1]!), y = parseNumber(match[2]!);
  return x === undefined || y === undefined ? undefined : [x, y];
}

export function parseAngleDegrees(source: string): number | undefined {
  const value = parseNumber(source);
  return value === undefined ? undefined : value * Math.PI / 180;
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][\w-]*$/.test(value);
}

export function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function errorAt(line: number, message: string): CompileError {
  return { line: Number.isFinite(line) ? line : 0, message: String(message) };
}
