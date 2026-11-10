import { arcCubics, textWidth, type MemberGeometry, type Point } from '../geometry.ts';

/**
 * Space 1: one pure SVG fragment per member. The viewport and
 * `SceneVectorCompiler.compileToPureSvg` call the same function, so screen and
 * export are byte-identical. No `<foreignObject>`, DOM measurement, fonts or
 * `url()` references; angle marks, right-angle squares and tick marks are
 * computed paths.
 */

const COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|none|transparent|currentcolor|[a-z]{3,20})$/i;
const FONT = "system-ui,-apple-system,'Segoe UI','Noto Sans KR',sans-serif";

export function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}
export const color = (value: unknown, fallback: string) => typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : fallback;
const number = (value: unknown, fallback: number, min = -Infinity, max = Infinity) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export const n = (value: number) => { const rounded = Math.round(value * 1000) / 1000; return Number.isFinite(rounded) ? String(Object.is(rounded, -0) ? 0 : rounded) : '0'; };

export function arcPath(c: Point, r: number, start: number, end: number): string {
  const cubics = arcCubics(c, r, start, end);
  if (!cubics.length) return '';
  let d = `M${n(cubics[0]!.p0.x)} ${n(cubics[0]!.p0.y)}`;
  for (const cubic of cubics) d += `C${n(cubic.c1.x)} ${n(cubic.c1.y)} ${n(cubic.c2.x)} ${n(cubic.c2.y)} ${n(cubic.p3.x)} ${n(cubic.p3.y)}`;
  return d;
}

function arrowHead(tip: Point, from: Point, size: number, fill: string): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const a = { x: tip.x - size * Math.cos(angle - 0.42), y: tip.y - size * Math.sin(angle - 0.42) };
  const b = { x: tip.x - size * Math.cos(angle + 0.42), y: tip.y - size * Math.sin(angle + 0.42) };
  return `<path d="M${n(tip.x)} ${n(tip.y)}L${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}Z" fill="${escapeXml(fill)}"/>`;
}

function ticks(a: Point, b: Point, count: number, stroke: string, width: number): string {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < 1e-6 || count < 1) return '';
  const ux = dx / length, uy = dy / length, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  let d = '';
  for (let index = 0; index < Math.min(3, count); index++) {
    const offset = (index - (Math.min(3, count) - 1) / 2) * 5;
    const cx = mx + ux * offset, cy = my + uy * offset;
    d += `M${n(cx + uy * 5)} ${n(cy - ux * 5)}L${n(cx - uy * 5)} ${n(cy + ux * 5)}`;
  }
  return `<path d="${d}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linecap="round"/>`;
}

function square(mark: MemberGeometry['squares'][number], size: number, stroke: string, width: number): string {
  const p1 = { x: mark.o.x + mark.u.x * size, y: mark.o.y + mark.u.y * size };
  const p2 = { x: p1.x + mark.v.x * size, y: p1.y + mark.v.y * size };
  const p3 = { x: mark.o.x + mark.v.x * size, y: mark.o.y + mark.v.y * size };
  return `<path d="M${n(p1.x)} ${n(p1.y)}L${n(p2.x)} ${n(p2.y)}L${n(p3.x)} ${n(p3.y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linejoin="miter"/>`;
}

/** The SVG body of one member, in world coordinates. */
export function memberSvg(geometry: MemberGeometry): string {
  const style = geometry.style;
  const stroke = color(style.stroke, '#475569');
  const fill = color(style.fill, geometry.kind === 'point' ? '#2563eb' : 'none');
  const width = number(style.width, 2, 0, 24);
  const dash = number(style.dash, 0, 0, 80);
  const dashAttr = dash > 0 ? ` stroke-dasharray="${n(dash)} ${n(dash * 1.6)}"` : '';
  const parts: string[] = [];
  const points = geometry.points;
  switch (geometry.kind) {
    case 'point': {
      const c = points[0]!, r = number(style.r, 4.5, 0.5, 40);
      parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}" fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}"/>`);
      if (geometry.pinned) parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r + 3)}" fill="none" stroke="${escapeXml(fill)}" stroke-width="1" stroke-dasharray="1.5 2"/>`);
      break;
    }
    case 'segment': case 'line': case 'ray': {
      const [a, b] = points as [Point, Point];
      parts.push(`<path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linecap="round"${dashAttr}/>`);
      if (geometry.kind !== 'segment' && style.arrows !== false) {
        const size = Math.max(6, width * 3.2);
        parts.push(arrowHead(b, a, size, stroke));
        if (geometry.kind === 'line') parts.push(arrowHead(a, b, size, stroke));
      }
      if (style.ticks !== false) parts.push(ticks(a, b, geometry.ticks, stroke, Math.max(1, width * 0.75)));
      break;
    }
    case 'circle': {
      const c = points[0]!;
      parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(geometry.radius)}" fill="${escapeXml(fill)}"${fill !== 'none' ? ` fill-opacity="${n(number(style.fillOpacity, 1, 0, 1))}"` : ''} stroke="${escapeXml(stroke)}" stroke-width="${n(width)}"${dashAttr}/>`);
      break;
    }
    case 'arc':
      parts.push(`<path d="${arcPath(points[0]!, geometry.radius, geometry.start, geometry.end)}" fill="none" stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linecap="round"${dashAttr}/>`);
      break;
    case 'polygon': {
      const d = points.map((point, index) => `${index ? 'L' : 'M'}${n(point.x)} ${n(point.y)}`).join('') + 'Z';
      parts.push(`<path d="${d}" fill="${escapeXml(fill)}"${fill !== 'none' ? ` fill-opacity="${n(number(style.fillOpacity, 0.12, 0, 1))}"` : ''} stroke="${escapeXml(stroke)}" stroke-width="${n(width)}" stroke-linejoin="round"${dashAttr}/>`);
      break;
    }
    case 'angle-mark': {
      const accent = color(style.stroke, '#f59e0b');
      if (geometry.squares.length) parts.push(square(geometry.squares[0]!, Math.min(geometry.radius * 0.6, 10), accent, width));
      else parts.push(`<path d="${arcPath(points[0]!, geometry.radius, geometry.start, geometry.end)}" fill="none" stroke="${escapeXml(accent)}" stroke-width="${n(width)}" stroke-linecap="round"/>`);
      break;
    }
    case 'label-anchor':
      break;
  }
  if (geometry.kind !== 'angle-mark') for (const mark of geometry.squares) parts.push(square(mark, 9, stroke, Math.max(1, width * 0.75)));
  if (geometry.text && geometry.textAt && !geometry.card) parts.push(textSvg(geometry));
  return parts.join('');
}

function textSvg(geometry: MemberGeometry): string {
  const style = geometry.style, at = geometry.textAt!;
  const size = number(geometry.fontSize, 14, 6, 96);
  const ink = geometry.kind === 'label-anchor' ? color(style.fill, '#1e293b') : color(style.labelColor, '#1e293b');
  const background = color(style.labelBackground, 'none');
  const halo = background !== 'none'
    ? `<rect x="${n(at.x - textWidth(geometry.text!, size) / 2 - 3)}" y="${n(at.y - size * 0.72)}" width="${n(textWidth(geometry.text!, size) + 6)}" height="${n(size * 1.44)}" rx="3" fill="${escapeXml(background)}"/>`
    : '';
  return `${halo}<text x="${n(at.x)}" y="${n(at.y)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${n(size)}" font-weight="${n(number(style.fontWeight, 500, 100, 900))}" fill="${escapeXml(ink)}">${escapeXml(geometry.text)}</text>`;
}

/** Placeholder for a member whose scope has a DSL error or no solver yet. */
export function placeholderSvg(x: number, y: number, message: string): string {
  return `<g><rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(80, textWidth(message, 11) + 16))}" height="22" rx="4" fill="#fef2f2" stroke="#fca5a5"/><text x="${n(x + 8)}" y="${n(y + 11)}" dominant-baseline="central" font-family="${FONT}" font-size="11" fill="#b91c1c">${escapeXml(message)}</text></g>`;
}
