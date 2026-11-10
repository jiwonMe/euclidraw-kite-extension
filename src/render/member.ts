import type { DerivedGeometry, Point, StyleProps } from '../types.ts';
import { textWidth } from '../geometry.ts';

/**
 * Pure vector renderer for one Kite member. No DOM, no measurement, no
 * `<foreignObject>`: screen and headless SVG use the exact same string.
 */

const FONT = "system-ui,-apple-system,'Segoe UI','Noto Sans KR',sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

const COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|none|transparent|currentcolor|[a-z]{3,20})$/i;

export function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : fallback;
}

function number(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isFinite(rounded) ? String(rounded) : '0';
}

function points(points: readonly Point[]): string {
  return points.map(point => `${n(point.x)},${n(point.y)}`).join(' ');
}

export function memberSvg(derived: DerivedGeometry): string {
  const style = derived.style;
  const stroke = color(style.stroke, '#475569');
  const fill = color(style.fill, derived.kind === 'point' ? '#2563eb' : 'none');
  const width = number(style.width, 2, 0, 24);
  const dash = number(style.dash, 0, 0, 80);
  const paint = `fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}"${dash > 0 ? ` stroke-dasharray="${n(dash)} ${n(dash * 1.6)}"` : ''} stroke-linecap="round" stroke-linejoin="round"`;
  const parts: string[] = [];

  if (derived.kind === 'point') {
    const center = derived.points[0];
    if (!center) return '';
    const radius = number(style.r, 4.5, 0.5, 40);
    parts.push(`<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(radius)}" ${paint}/>`);
    if (derived.badges.pinned) parts.push(`<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(radius + 3.5)}" fill="none" stroke="${escapeXml(color(style.stroke, '#1d4ed8'))}" stroke-width="1" stroke-dasharray="1.5 2"/>`);
    if (derived.badges.onCircle) parts.push(`<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(radius + 1.5)}" fill="none" stroke="${escapeXml(stroke)}" stroke-opacity="0.35" stroke-width="0.8"/>`);
  } else if (derived.kind === 'segment' || derived.kind === 'line' || derived.kind === 'ray') {
    const [a, b] = derived.points;
    if (!a || !b) return '';
    parts.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${paint}/>`);
    if (derived.kind !== 'segment') {
      const arrow = arrowHead(b, a, Math.max(6, width * 3));
      parts.push(`<path d="${arrow}" fill="${escapeXml(stroke)}" stroke="none"/>`);
    }
    if (derived.badges.ticks > 0 && style.ticks !== false) parts.push(tickMarks(a, b, derived.badges.ticks, stroke, Math.max(1, width)));
  } else if (derived.kind === 'circle') {
    if (!derived.center) return '';
    parts.push(`<circle cx="${n(derived.center.x)}" cy="${n(derived.center.y)}" r="${n(derived.radius ?? 0)}" ${paint}/>`);
  } else if (derived.kind === 'arc') {
    if (!derived.center || !((derived.radius ?? 0) > 0)) return '';
    parts.push(`<path d="${arcPath(derived.center, derived.radius ?? 0, derived.startAngle ?? 0, derived.endAngle ?? Math.PI)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}"${dash > 0 ? ` stroke-dasharray="${n(dash)} ${n(dash * 1.6)}"` : ''} stroke-linecap="round"/>`);
  } else if (derived.kind === 'polygon') {
    if (derived.points.length < 3) return '';
    parts.push(`<polygon points="${points(derived.points)}" ${paint}/>`);
  } else if (derived.kind === 'angle-mark') {
    const [, vertex] = derived.points;
    if (!vertex || !((derived.radius ?? 0) > 0)) return '';
    const strokeColor = color(style.stroke, '#f59e0b');
    parts.push(`<path d="${arcPath(vertex, derived.radius ?? 0, derived.startAngle ?? 0, derived.endAngle ?? Math.PI)}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${n(width)}" stroke-linecap="round"/>`);
    const a = derived.points[0], b = derived.points[2];
    if (a && b) {
      const dot = (a.x - vertex.x) * (b.x - vertex.x) + (a.y - vertex.y) * (b.y - vertex.y);
      const la = Math.hypot(a.x - vertex.x, a.y - vertex.y) * Math.hypot(b.x - vertex.x, b.y - vertex.y);
      if (la > 0 && Math.abs(dot / la) < 0.02) parts.push(rightAnglePath(vertex, a, b, 9, strokeColor, width));
    }
  } else if (derived.kind === 'label-anchor') {
    // Text is emitted by the shared label pass below.
  }

  for (const square of derived.squares) parts.push(rightAngleSquarePath(square, stroke, Math.max(1, width)));

  if (derived.stress > 0.18) parts.push(stressHalo(derived));

  if (derived.text && derived.textX !== undefined && derived.textY !== undefined) {
    const size = number(derived.textSize, 14, 6, 96);
    const textFill = color(style.fill, '#334155');
    const background = derived.kind === 'label-anchor' ? 'none' : color(style.labelBackground, 'none');
    if (background !== 'none') {
      const widthEstimate = textWidth(derived.text, size) + 8;
      parts.push(`<rect x="${n(derived.textX - widthEstimate / 2)}" y="${n(derived.textY - size * 0.72)}" width="${n(widthEstimate)}" height="${n(size * 1.44)}" rx="3" fill="${escapeXml(background)}"/>`);
    }
    parts.push(`<text x="${n(derived.textX)}" y="${n(derived.textY)}" text-anchor="middle" dominant-baseline="middle" font-family="${derived.textSize && derived.textSize < 10 ? MONO : FONT}" font-size="${n(size)}" font-weight="${number(style.fontWeight, 500, 100, 900)}" fill="${escapeXml(textFill)}" stroke="none">${escapeXml(derived.text)}</text>`);
  }
  return parts.join('');
}

function tickMarks(a: Point, b: Point, count: number, stroke: string, width: number): string {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return '';
  const ux = dx / length, uy = dy / length, px = -uy, py = ux;
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  const ticks = Math.min(3, Math.max(1, Math.trunc(count)));
  const parts: string[] = [];
  for (let index = 0; index < ticks; index++) {
    const offset = (index - (ticks - 1) / 2) * 5;
    const cx = midX + ux * offset, cy = midY + uy * offset;
    parts.push(`<line x1="${n(cx - px * 5)}" y1="${n(cy - py * 5)}" x2="${n(cx + px * 5)}" y2="${n(cy + py * 5)}" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linecap="round"/>`);
  }
  return parts.join('');
}

function rightAnglePath(vertex: Point, a: Point, b: Point, size: number, stroke: string, width: number): string {
  const da = normalizeDirection(vertex, a), db = normalizeDirection(vertex, b);
  const p1 = { x: vertex.x + da.x * size, y: vertex.y + da.y * size };
  const p2 = { x: p1.x + db.x * size, y: p1.y + db.y * size };
  const p3 = { x: vertex.x + db.x * size, y: vertex.y + db.y * size };
  return `<path d="M ${n(p1.x)} ${n(p1.y)} L ${n(p2.x)} ${n(p2.y)} L ${n(p3.x)} ${n(p3.y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function rightAngleSquarePath(square: { x: number; y: number; ax: number; ay: number; bx: number; by: number; size: number }, stroke: string, width: number): string {
  const p1 = { x: square.x + square.ax * square.size, y: square.y + square.ay * square.size };
  const p2 = { x: p1.x + square.bx * square.size, y: p1.y + square.by * square.size };
  const p3 = { x: square.x + square.bx * square.size, y: square.y + square.by * square.size };
  return `<path d="M ${n(p1.x)} ${n(p1.y)} L ${n(p2.x)} ${n(p2.y)} L ${n(p3.x)} ${n(p3.y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linejoin="round"/>`;
}

function normalizeDirection(from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function arrowHead(tip: Point, previous: Point, size: number): string {
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const left = { x: tip.x - size * Math.cos(angle - 0.42), y: tip.y - size * Math.sin(angle - 0.42) };
  const right = { x: tip.x - size * Math.cos(angle + 0.42), y: tip.y - size * Math.sin(angle + 0.42) };
  return `M ${n(tip.x)} ${n(tip.y)} L ${n(left.x)} ${n(left.y)} L ${n(right.x)} ${n(right.y)} Z`;
}

export function arcPath(center: Point, radius: number, start: number, end: number): string {
  const delta = arcSpan(start, end);
  const p0 = { x: center.x + Math.cos(start) * radius, y: center.y + Math.sin(start) * radius };
  const p1 = { x: center.x + Math.cos(start + delta) * radius, y: center.y + Math.sin(start + delta) * radius };
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta >= 0 ? 1 : 0;
  return `M ${n(p0.x)} ${n(p0.y)} A ${n(radius)} ${n(radius)} 0 ${large} ${sweep} ${n(p1.x)} ${n(p1.y)}`;
}

function arcSpan(start: number, end: number): number {
  let delta = end - start;
  while (delta > Math.PI * 2) delta -= Math.PI * 2;
  while (delta < -Math.PI * 2) delta += Math.PI * 2;
  return delta;
}

function stressHalo(derived: DerivedGeometry): string {
  const anchor = derived.center ?? derived.points[0] ?? (derived.textX !== undefined ? { x: derived.textX, y: derived.textY ?? 0 } : undefined);
  if (!anchor) return '';
  const radius = derived.kind === 'point' ? number(derived.style.r, 4.5) + 6 : 15;
  return `<circle cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="${n(radius)}" fill="none" stroke="#FF4800" stroke-width="4" stroke-opacity="${n(0.25 + derived.stress * 0.5)}" stroke-dasharray="2 5"/>`;
}

export function renderStyleSummary(style: StyleProps): string {
  return Object.entries(style).map(([key, value]) => `${key}=${String(value)}`).join(' ');
}
