/**
 * Deterministic text measurement. The host's canvas `measureText` depends on
 * the platform's installed fonts, so peers would disagree about wrap and
 * layout. These metrics are a fixed Helvetica-style table and never touch a DOM.
 */
export interface TextMetrics {
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
}

/** AFM advance widths (per 1000 em) for printable ASCII, Helvetica. */
const ADVANCE: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32-47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48-63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64-79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80-95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96-111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 112-126
];

const FALLBACK_ADVANCE = 556;
const LINE_HEIGHT = 1.2;

export function advanceOf(codePoint: number): number {
  if (codePoint >= 32 && codePoint <= 126) return ADVANCE[codePoint - 32]!;
  // Hangul and CJK are full-width in most metrics tables; Latin-1/other
  // letters use the average advance. Both are constants, so peers agree.
  if ((codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0x4e00 && codePoint <= 0x9fff) || (codePoint >= 0x3040 && codePoint <= 0x30ff)) return 1000;
  return FALLBACK_ADVANCE;
}

/** Parse a CSS font size (`14px`, `1.2em`, `14`) into pixels. */
export function parseFontSize(value: unknown, fallback = 14): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px|em|rem|pt|%)?\s*$/.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'em':
    case 'rem':
      return amount * 16;
    case 'pt':
      return (amount * 4) / 3;
    case '%':
      return (amount / 100) * 16;
    default:
      return amount;
  }
}

/** Width of one line in pixels at `fontSize`, using the fixed table. */
export function measureLine(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += advanceOf(char.codePointAt(0) ?? 32);
  return (units / 1000) * fontSize;
}

export function measureText(text: string, fontSize: number): TextMetrics {
  const lines = text.split('\n');
  let width = 0;
  for (const line of lines) width = Math.max(width, measureLine(line, fontSize));
  const height = Math.max(1, lines.length) * fontSize * LINE_HEIGHT;
  return {
    width,
    height,
    ascent: fontSize * 0.9,
    descent: fontSize * 0.3,
  };
}
