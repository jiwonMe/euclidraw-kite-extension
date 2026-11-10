/** Shared line handling for the three DSLs. Pure; no host access. */

export interface Diagnostic {
  readonly source: 'domain' | 'substance' | 'style';
  readonly line: number;
  readonly message: string;
}

export interface SourceLine { readonly number: number; readonly text: string }

/** Remove `//` and `#` comments that are not inside quotes. */
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
    if (character === '#' && (index === 0 || /\s/.test(source[index - 1]!)) && !/^#[0-9a-f]{3,8}\b/i.test(source.slice(index))) return source.slice(0, index);
    if (character === '/' && source[index + 1] === '/') return source.slice(0, index);
  }
  return source;
}

export function sourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
    const line = stripComment(raw).trim();
    if (line) lines.push({ number: index + 1, text: line });
  });
  return lines;
}

/** Split on top-level commas, respecting quotes and parentheses. */
export function splitTopLevel(source: string, separator = ','): string[] {
  const parts: string[] = [];
  let current = '', depth = 0, quote: string | null = null;
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      current += character;
      if (character === '\\') { current += source[++index] ?? ''; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; current += character; continue; }
    if (character === '(' || character === '[') depth++;
    if (character === ')' || character === ']') depth--;
    if (character === separator && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += character;
  }
  if (current.trim() || parts.length) parts.push(current.trim());
  return parts;
}

export function unquote(source: string): string | undefined {
  const value = source.trim();
  if (value.length < 2 || (value[0] !== '"' && value[0] !== "'") || value[value.length - 1] !== value[0]) return undefined;
  return value.slice(1, -1).replace(/\\(["'\\n])/g, (_match, escape: string) => escape === 'n' ? '\n' : escape);
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isIdent = (value: string): boolean => IDENT.test(value);

export function finiteNumber(source: string): number | undefined {
  const text = source.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
