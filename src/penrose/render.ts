/**
 * Pure SVG renderer for Penrose shapes. No DOM, no `<foreignObject>`, no
 * `url(#…)` references: screen and export share this exact string.
 */
import { PENROSE_ASSETS } from './assets.ts';
import type { Color, WireBounds, WireCanvas, WirePathCommand, WireShape, WireValue } from './wire.ts';

export interface RenderOptions {
  readonly canvas: WireCanvas;
  /** Pre-rendered MathJax markup, keyed by shape name. */
  readonly labels?: Readonly<Record<string, string>>;
  readonly idPrefix?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly scale?: number;
}

// ── primitives ──────────────────────────────────────────────────────────────

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const num = (value: WireValue | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const str = (value: WireValue | undefined, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const vec = (value: WireValue | undefined): [number, number] =>
  Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? [value[0] as number, value[1] as number]
    : [0, 0];

const round = (value: number): number => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0);

const isColor = (value: WireValue | undefined): value is Color =>
  Array.isArray(value) && value.length === 4 && value.every(part => typeof part === 'number');

function paint(value: WireValue | undefined): string {
  if (!isColor(value)) return 'none';
  const [r, g, b, a] = value;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${Math.round(a * 1000) / 1000})`;
}

function opacityOf(value: WireValue | undefined): number {
  return isColor(value) ? value[3] : 1;
}

/** Attributes Penrose may pass through, restricted to a safe subset. */
const PASSTHROUGH: Readonly<Record<string, string>> = {
  opacity: 'opacity',
  fillOpacity: 'fill-opacity',
  strokeOpacity: 'stroke-opacity',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  fillRule: 'fill-rule',
  clipRule: 'clip-rule',
  mixBlendMode: 'mix-blend-mode',
  letterSpacing: 'letter-spacing',
  wordSpacing: 'word-spacing',
  textDecoration: 'text-decoration',
  paintOrder: 'paint-order',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontStyle: 'font-style',
  fontWeight: 'font-weight',
  visibility: 'visibility',
  color: 'color',
  colorInterpolation: 'color-interpolation',
  style: 'style',
};

/** CSS text from a style passthrough; no external fetches, no script. */
function safeStyle(value: string): string {
  return value
    .replace(/javascript:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^)'"]*\)/gi, 'none');
}

function passthrough(shape: WireShape): string {
  let out = '';
  for (const [key, value] of Object.entries(shape.passthrough)) {
    const name = PASSTHROUGH[key];
    if (!name || value === null) continue;
    const text = key === 'style' ? safeStyle(String(value)) : typeof value === 'number' ? String(round(value)) : String(value);
    if (!text) continue;
    out += ` ${name}="${escapeXml(text)}"`;
  }
  return out;
}

const screenOf = (canvas: WireCanvas, [x, y]: [number, number]): [number, number] => [
  canvas.width / 2 + x,
  canvas.height / 2 - y,
];

function fillAttrs(shape: WireShape): string {
  const color = shape.props.fillColor;
  if (!isColor(color)) return ' fill="none"';
  return ` fill="${paint(color)}" fill-opacity="${round(opacityOf(color))}"`;
}

const DASH_ARRAY = '7,5';

function strokeAttrs(shape: WireShape): string {
  const color = shape.props.strokeColor;
  if (!isColor(color)) return ' stroke="none"';
  const width = num(shape.props.strokeWidth, 0);
  if (width <= 0) return ' stroke="none"';
  let out = ` stroke="${paint(color)}" stroke-opacity="${round(opacityOf(color))}" stroke-width="${round(width)}"`;
  const dasharray = str(shape.props.strokeDasharray);
  if (dasharray) out += ` stroke-dasharray="${escapeXml(dasharray)}"`;
  else if (str(shape.props.strokeStyle) === 'dashed') out += ` stroke-dasharray="${DASH_ARRAY}"`;
  const cap = str(shape.props.strokeLinecap);
  if (cap) out += ` stroke-linecap="${escapeXml(cap)}"`;
  return out;
}

// ── arrowheads ─────────────────────────────────────────────────────────────

interface Arrowhead {
  readonly width: number;
  readonly height: number;
  readonly refX: number;
  readonly refY: number;
  readonly path: string;
  readonly fillKind: 'fill' | 'stroke';
  readonly style?: Readonly<Record<string, string>>;
}

const ARROWHEADS: Readonly<Record<string, Arrowhead>> = {
  concave: { width: 8, height: 8, refX: 2.5, refY: 4, path: 'M0,0 A30,30,0,0,0,8,4 A30,30,0,0,0,0,8 L2.5,4 z', fillKind: 'fill' },
  straight: { width: 9.95, height: 8.12, refX: 2.36, refY: 4.06, path: 'M9.95 4.06 0 8.12 2.36 4.06 0 0 9.95 4.06z', fillKind: 'fill' },
  perp: { width: 1, height: 10.15, refX: 0.5, refY: 5.08, path: 'M0.5 10.2 0.5 0', fillKind: 'stroke' },
  line: { width: 7.5, height: 14, refX: 5, refY: 7, path: 'M 7 7 a -6 6.75 0 0 1 -6 -6 M 7 7 a -6 6.75 0 0 0 -6 6', fillKind: 'stroke', style: { 'stroke-linecap': 'round' } },
  doubleLine: { width: 12.5, height: 14, refX: 5, refY: 7, path: 'M 7 7 a -6 6.75 0 0 1 -6 -6 M 7 7 a -6 6.75 0 0 0 -6 6 M 12 7 a -6 6.75 0 0 1 -6 -6 M 7 7 L 12 7 M 12 7 a -6 6.75 0 0 0 -6 6', fillKind: 'stroke', style: { 'stroke-linecap': 'round' } },
  loopup: { width: 6, height: 28, refX: 1, refY: 10, path: 'M1 10 a 4 4 0 0 1 0 9', fillKind: 'stroke', style: { 'stroke-linecap': 'round' } },
  loopdown: { width: 6, height: 28, refX: 1, refY: 10, path: 'M1 1 a 4 4 0 0 1 0 9', fillKind: 'stroke', style: { 'stroke-linecap': 'round' } },
  loop: { width: 6, height: 28, refX: 1, refY: 10, path: 'M1 10 a 4 4 0 0 1 0 9 M1 1 a 4 4 0 0 1 0 9', fillKind: 'stroke', style: { 'stroke-linecap': 'round' } },
};

function arrowMarkup(
  kind: string,
  size: number,
  thickness: number,
  color: WireValue | undefined,
  x: number,
  y: number,
  angle: number,
): string {
  const arrow = ARROWHEADS[kind];
  if (!arrow) return '';
  const scale = Math.max(0.01, size) * Math.max(0.01, thickness);
  const style = Object.entries(arrow.style ?? {}).map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  const body = arrow.fillKind === 'stroke'
    ? `fill="none" stroke="${paint(color)}" stroke-opacity="${round(opacityOf(color))}" stroke-width="1"${style}`
    : `fill="${paint(color)}" fill-opacity="${round(opacityOf(color))}"`;
  return (
    `<g transform="translate(${round(x)} ${round(y)}) rotate(${round(angle)}) scale(${round(scale)}) translate(${round(-arrow.refX)} ${round(-arrow.refY)})">` +
    `<path d="${arrow.path}" ${body}/></g>`
  );
}

// ── shapes ─────────────────────────────────────────────────────────────────

function renderCircle(shape: WireShape, canvas: WireCanvas): string {
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  const r = Math.max(0, num(shape.props.r));
  return `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}"${fillAttrs(shape)}${strokeAttrs(shape)}${passthrough(shape)}/>`;
}

function renderEllipse(shape: WireShape, canvas: WireCanvas): string {
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  return `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(Math.max(0, num(shape.props.rx)))}" ry="${round(Math.max(0, num(shape.props.ry)))}"${fillAttrs(shape)}${strokeAttrs(shape)}${passthrough(shape)}/>`;
}

function renderLine(shape: WireShape, canvas: WireCanvas): string {
  const [sx, sy] = screenOf(canvas, vec(shape.props.start));
  const [ex, ey] = screenOf(canvas, vec(shape.props.end));
  const thickness = num(shape.props.strokeWidth, 0);
  const startKind = str(shape.props.startArrowhead);
  const endKind = str(shape.props.endArrowhead);
  const startArrow = ARROWHEADS[startKind];
  const endArrow = ARROWHEADS[endKind];
  const length = Math.hypot(ex - sx, ey - sy);
  let lineSX = sx, lineSY = sy, lineEX = ex, lineEY = ey;
  if (length > 1e-9) {
    if (startArrow) {
      const width = (startArrow.width - startArrow.refX) * num(shape.props.startArrowheadSize, 1) * thickness;
      lineSX = sx + ((width / length) * (sx - ex));
      lineSY = sy + ((width / length) * (sy - ey));
    }
    if (endArrow) {
      const width = (endArrow.width - endArrow.refX) * num(shape.props.endArrowheadSize, 1) * thickness;
      lineEX = ex + ((width / length) * (ex - sx));
      lineEY = ey + ((width / length) * (ey - sy));
    }
  }
  const color = shape.props.strokeColor;
  let out = '<g>';
  if (startArrow) out += arrowMarkup(startKind, num(shape.props.startArrowheadSize, 1), thickness, color, sx, sy, (Math.atan2(sy - ey, sx - ex) * 180) / Math.PI);
  if (endArrow) out += arrowMarkup(endKind, num(shape.props.endArrowheadSize, 1), thickness, color, ex, ey, (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI);
  out += `<line x1="${round(lineSX)}" y1="${round(lineSY)}" x2="${round(lineEX)}" y2="${round(lineEY)}"${strokeAttrs(shape)}${passthrough(shape)}/>`;
  return out + '</g>';
}

function renderPoly(shape: WireShape, canvas: WireCanvas, tag: 'polygon' | 'polyline'): string {
  const points = Array.isArray(shape.props.points) ? (shape.props.points as readonly (readonly number[])[]) : [];
  const mapped = points
    .filter(point => Array.isArray(point) && point.length >= 2)
    .map(point => screenOf(canvas, [Number(point[0]) || 0, Number(point[1]) || 0]))
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(' ');
  const scale = num(shape.props.scale, 1);
  const transform = scale && scale !== 1 ? ` transform="scale(${round(scale)})"` : '';
  const fill = tag === 'polygon' ? fillAttrs(shape) : ' fill="none"';
  return `<${tag} points="${mapped}"${fill}${strokeAttrs(shape)}${transform}${passthrough(shape)}/>`;
}

function renderRect(shape: WireShape, canvas: WireCanvas): string {
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  const w = Math.max(0, num(shape.props.width));
  const h = Math.max(0, num(shape.props.height));
  const rotation = num(shape.props.rotation);
  const transform = rotation ? ` transform="rotate(${round(rotation)} ${round(x)} ${round(y)})"` : '';
  const radius = num(shape.props.cornerRadius);
  const rx = radius ? ` rx="${round(radius)}" ry="${round(radius)}"` : '';
  return `<rect x="${round(x - w / 2)}" y="${round(y - h / 2)}" width="${round(w)}" height="${round(h)}"${rx}${fillAttrs(shape)}${strokeAttrs(shape)}${transform}${passthrough(shape)}/>`;
}

function pathData(shape: WireShape, canvas: WireCanvas): string {
  const commands = Array.isArray(shape.props.d) ? (shape.props.d as readonly WirePathCommand[]) : [];
  const parts: string[] = [];
  for (const command of commands) {
    if (!command || typeof command.cmd !== 'string') continue;
    const values = (command.values ?? []).flatMap(entry => {
      if (entry.kind === 'coord') {
        const [x, y] = screenOf(canvas, [entry.x, entry.y]);
        return [`${round(x)} ${round(y)}`];
      }
      return [entry.values.map(value => round(value)).join(' ')];
    });
    parts.push(`${command.cmd} ${values.join(' ')}`.trim());
  }
  return parts.join(' ');
}

function renderPath(shape: WireShape, canvas: WireCanvas): string {
  const d = pathData(shape, canvas);
  if (!d) return '';
  return `<path d="${escapeXml(d)}"${fillAttrs(shape)}${strokeAttrs(shape)}${passthrough(shape)}/>`;
}

function fontRule(shape: WireShape): string {
  const family = str(shape.props.fontFamily) || "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const size = str(shape.props.fontSize) || '14px';
  const style = str(shape.props.fontStyle);
  const weight = str(shape.props.fontWeight);
  return [style, weight, size, family].filter(Boolean).join(' ');
}

function renderText(shape: WireShape, canvas: WireCanvas): string {
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  const height = num(shape.props.height);
  const descent = num(shape.props.descent);
  const baseline = y + height / 2 - descent;
  const rotation = num(shape.props.rotation);
  const transform = rotation ? ` transform="rotate(${round(rotation)} ${round(x)} ${round(baseline)})"` : '';
  const anchor = str(shape.props.textAnchor, 'middle') || 'middle';
  const content = str(shape.props.string);
  const lines = content.split('\n');
  const body = lines.length > 1
    ? lines.map((line, index) => `<tspan x="${round(x)}" dy="${index === 0 ? 0 : round(Number.parseFloat(str(shape.props.fontSize, '14')) * 1.2)}">${escapeXml(line)}</tspan>`).join('')
    : escapeXml(content);
  return (
    `<text x="${round(x)}" y="${round(baseline)}" font="${escapeXml(fontRule(shape))}" ` +
    `text-anchor="${escapeXml(anchor)}" dominant-baseline="alphabetic"${fillAttrs(shape)}${strokeAttrs(shape)}${transform}${passthrough(shape)}>` +
    `${body}</text>`
  );
}

function decodeBase64(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return '';
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof atobFn === 'function') {
    try {
      const binary = atobFn(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Markup for an SVG `href`. `data:` URIs work as-is (plain or base64) and
 * relative Penrose example assets resolve by basename; anything else is not
 * loaded (no network, no file system in a document).
 */
function svgHrefMarkup(href: string): string | undefined {
  if (href.startsWith('data:image/svg+xml')) {
    const rest = href.slice('data:image/svg+xml'.length);
    const comma = rest.indexOf(',');
    if (comma === -1) return undefined;
    const header = rest.slice(0, comma);
    const body = rest.slice(comma + 1);
    if (!body) return undefined;
    const decoded = /;base64/i.test(header) ? decodeBase64(body) : decodeURIComponent(body);
    return decoded.includes('<svg') ? stripProlog(decoded) : undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const name = href.split(/[?#]/)[0]!.split('/').pop() ?? '';
  const asset = PENROSE_ASSETS[name];
  if (!asset) return undefined;
  return stripProlog(decodeBase64(asset));
}

/** Drop the XML prolog/doctype: an inlined drawing is mid-document, where they are invalid. */
function stripProlog(markup: string): string {
  return markup
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();
}

/**
 * Give an inlined SVG's ids and classes a per-instance prefix: two copies of
 * the same artwork would otherwise share one `url(#gradient)` definition and
 * `<style>` rules would leak across the whole document.
 */
function scopeSvg(markup: string, prefix: string): string {
  let out = markup;
  for (const match of markup.matchAll(/\bid="([^"]+)"/g)) {
    const id = match[1]!;
    out = out
      .replaceAll(`id="${id}"`, `id="${prefix}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}-${id})`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
  }
  for (const match of markup.matchAll(/\bclass="([^"]+)"/g)) {
    for (const cls of match[1]!.split(/\s+/).filter(Boolean)) {
      out = out
        .replaceAll(`class="${cls}"`, `class="${prefix}-${cls}"`)
        .replaceAll(`.${cls}`, `.${prefix}-${cls}`);
    }
  }
  return out;
}

function sanitizeSvg(markup: string): string {
  return markup
    // Older documents stored MathJax's `<mjx-container>` wrapper; only the
    // inner `<svg>` paints inside an SVG scene.
    .replace(/<\s*\/?\s*mjx-container\b[^>]*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    // No network fetches from an embedded drawing.
    .replace(/url\(\s*['"]?(?:https?:)?\/\/[^)'"]*\)/gi, 'none')
    .replace(/\s(?:xlink:)?href\s*=\s*"(?!#|data:)[^"]*"/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*'(?!#|data:)[^']*'/gi, '');
}

function renderEquation(shape: WireShape, options: RenderOptions): string {
  const canvas = options.canvas;
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  const w = Math.max(0, num(shape.props.width));
  const h = Math.max(0, num(shape.props.height));
  const rotation = num(shape.props.rotation);
  const transform = `translate(${round(x - w / 2)} ${round(y - h / 2)})` + (rotation ? ` rotate(${round(rotation)} ${round(w / 2)} ${round(h / 2)})` : '');
  const markup = options.labels?.[shape.name];
  if (!markup) {
    const content = escapeXml(str(shape.props.string));
    return `<text x="${round(x)}" y="${round(y + h / 2 - num(shape.props.descent))}" text-anchor="middle"${fillAttrs(shape)}${passthrough(shape)}>${content}</text>`;
  }
  // MathJax paints its glyphs with `currentColor`, so the CSS `color` property
  // is what actually colours an Equation (fill alone would be ignored).
  const color = isColor(shape.props.fillColor) ? ` color="${paint(shape.props.fillColor)}"` : '';
  return `<g transform="${transform}"${color}${fillAttrs(shape)}${passthrough(shape)}>${sanitizeSvg(markup)}</g>`;
}

function renderImage(shape: WireShape, canvas: WireCanvas): string {
  const href = str(shape.props.href);
  const [x, y] = screenOf(canvas, vec(shape.props.center));
  const w = Math.max(0, num(shape.props.width));
  const h = Math.max(0, num(shape.props.height));
  const rotation = num(shape.props.rotation);
  const transform = `translate(${round(x - w / 2)} ${round(y - h / 2)})` + (rotation ? ` rotate(${round(rotation)} ${round(w / 2)} ${round(h / 2)})` : '');
  const markup = svgHrefMarkup(href);
  if (markup) {
    const token = `${shape.name.replace(/[^\w-]/g, '_') || 'image'}`;
    const scoped = scopeSvg(sanitizeSvg(markup), token);
    const inner = scoped.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
      // Keep the viewBox: without it the artwork's own units are not scaled to
      // the requested width/height (a 100x100 asset would draw a 100px square).
      const cleaned = attrs
        .replace(/\s(width|height|x|y)=("[^"]*"|'[^']*')/gi, '')
        .replace(/\spreserveAspectRatio=("[^"]*"|'[^']*')/gi, '');
      const par = escapeXml(str(shape.props.preserveAspectRatio) || 'xMidYMid meet');
      return `<svg${cleaned} width="${round(w)}" height="${round(h)}" preserveAspectRatio="${par}">`;
    });
    return `<g transform="${transform}">${inner}</g>`;
  }
  if (!href.startsWith('data:image/')) return ''; // external resources are not allowed
  return `<image href="${escapeXml(href)}" x="0" y="0" width="${round(w)}" height="${round(h)}" transform="${transform}" preserveAspectRatio="${escapeXml(str(shape.props.preserveAspectRatio, 'xMidYMid meet'))}"/>`;
}

function renderGroup(shape: WireShape, options: RenderOptions): string {
  const shapes = shape.children ?? [];
  const clip = shape.clip;
  let out = '<g>';
  let clipId: string | undefined;
  if (clip && clip.length) {
    clipId = `${options.idPrefix ?? 'penrose'}-${shape.name.replace(/[^\w-]/g, '_')}-clip`;
    out += `<clipPath id="${escapeXml(clipId)}">${clip.map(child => renderShape(child, options)).join('')}</clipPath>`;
  }
  const clipName = clip && clip.length ? clip[0]?.name : undefined;
  for (const child of shapes) {
    if (clipName && child.name === clipName) continue;
    const body = renderShape(child, options);
    out += clipId ? `<g clip-path="url(#${escapeXml(clipId)})">${body}</g>` : body;
  }
  return out + passthrough(shape) + '</g>';
}

export function renderShape(shape: WireShape, options: RenderOptions): string {
  switch (shape.shapeType) {
    case 'Circle': return renderCircle(shape, options.canvas);
    case 'Ellipse': return renderEllipse(shape, options.canvas);
    case 'Line': return renderLine(shape, options.canvas);
    case 'Polygon': return renderPoly(shape, options.canvas, 'polygon');
    case 'Polyline': return renderPoly(shape, options.canvas, 'polyline');
    case 'Rectangle': return renderRect(shape, options.canvas);
    case 'Path': return renderPath(shape, options.canvas);
    case 'Text': return renderText(shape, options.canvas);
    case 'Equation': return renderEquation(shape, options);
    case 'Image': return renderImage(shape, options.canvas);
    case 'Group': return renderGroup(shape, options);
    default: return '';
  }
}

/** The shapes of one scope, in canvas coordinates. */
export function renderScene(
  shapes: readonly WireShape[],
  options: RenderOptions,
): string {
  return shapes.map(shape => renderShape(shape, options)).join('');
}

// ── bounds & hit testing (canvas coords, y up) ─────────────────────────────

export function shapeBounds(shape: WireShape): WireBounds | undefined {
  const pad = Math.max(0, num(shape.props.strokeWidth)) / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number, radius = 0) => {
    minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - radius); maxY = Math.max(maxY, y + radius);
  };
  switch (shape.shapeType) {
    case 'Circle': {
      const [x, y] = vec(shape.props.center);
      add(x, y, num(shape.props.r));
      break;
    }
    case 'Ellipse': {
      const [x, y] = vec(shape.props.center);
      const rx = num(shape.props.rx), ry = num(shape.props.ry);
      add(x - rx, y - ry); add(x + rx, y + ry);
      break;
    }
    case 'Line': {
      const [sx, sy] = vec(shape.props.start);
      const [ex, ey] = vec(shape.props.end);
      add(sx, sy); add(ex, ey);
      break;
    }
    case 'Polygon':
    case 'Polyline': {
      const points = Array.isArray(shape.props.points) ? (shape.props.points as readonly (readonly number[])[]) : [];
      for (const point of points) add(Number(point[0]) || 0, Number(point[1]) || 0);
      break;
    }
    case 'Rectangle': {
      const [x, y] = vec(shape.props.center);
      const w = num(shape.props.width), h = num(shape.props.height);
      const rotation = num(shape.props.rotation);
      const radius = (Math.abs(w) + Math.abs(h)) / 4 * Math.abs(Math.sin((rotation * Math.PI) / 180));
      add(x, y, Math.hypot(w, h) / 2 + radius * 0.1);
      break;
    }
    case 'Text':
    case 'Equation':
    case 'Image': {
      const [x, y] = vec(shape.props.center);
      add(x - num(shape.props.width) / 2, y - num(shape.props.height) / 2);
      add(x + num(shape.props.width) / 2, y + num(shape.props.height) / 2);
      break;
    }
    case 'Path': {
      const commands = Array.isArray(shape.props.d) ? (shape.props.d as readonly WirePathCommand[]) : [];
      for (const command of commands) {
        for (const entry of command.values) if (entry.kind === 'coord') add(entry.x, entry.y);
      }
      break;
    }
    case 'Group': {
      for (const child of shape.children ?? []) {
        const bounds = shapeBounds(child);
        if (!bounds) continue;
        add(bounds.x, bounds.y); add(bounds.x + bounds.width, bounds.y + bounds.height);
      }
      break;
    }
    default:
      return undefined;
  }
  if (!Number.isFinite(minX)) return undefined;
  return { x: minX - pad, y: minY - pad, width: Math.max(1e-3, maxX - minX + pad * 2), height: Math.max(1e-3, maxY - minY + pad * 2) };
}

export function ownerBounds(shapes: readonly WireShape[]): Record<string, WireBounds> {
  const out: Record<string, WireBounds> = {};
  const merge = (owner: string, bounds: WireBounds) => {
    const current = out[owner];
    if (!current) { out[owner] = bounds; return; }
    const minX = Math.min(current.x, bounds.x), minY = Math.min(current.y, bounds.y);
    const maxX = Math.max(current.x + current.width, bounds.x + bounds.width);
    const maxY = Math.max(current.y + current.height, bounds.y + bounds.height);
    out[owner] = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  const visit = (shape: WireShape) => {
    if (shape.owner) {
      const bounds = shapeBounds(shape);
      if (bounds) merge(shape.owner, bounds);
    }
    for (const child of shape.children ?? []) visit(child);
    for (const child of shape.clip ?? []) visit(child);
  };
  for (const shape of shapes) visit(shape);
  return out;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance from a canvas-space point to an owner; `Infinity` when far away. */
export function hitOwner(shapes: readonly WireShape[], owner: string, x: number, y: number, slop: number): number {
  let best = Infinity;
  const visit = (shape: WireShape) => {
    if (shape.owner === owner) {
      const distance = hitShape(shape, x, y, slop);
      if (distance < best) best = distance;
    }
    for (const child of shape.children ?? []) visit(child);
    for (const child of shape.clip ?? []) visit(child);
  };
  for (const shape of shapes) visit(shape);
  return best;
}

export function hitShape(shape: WireShape, x: number, y: number, slop: number): number {
  switch (shape.shapeType) {
    case 'Circle': {
      const [cx, cy] = vec(shape.props.center);
      return Math.max(0, Math.hypot(x - cx, y - cy) - num(shape.props.r)) - slop;
    }
    case 'Ellipse': {
      const [cx, cy] = vec(shape.props.center);
      const rx = Math.max(1e-6, num(shape.props.rx)), ry = Math.max(1e-6, num(shape.props.ry));
      return Math.max(0, (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry)) - slop;
    }
    case 'Line': {
      const [sx, sy] = vec(shape.props.start);
      const [ex, ey] = vec(shape.props.end);
      return distanceToSegment(x, y, sx, sy, ex, ey) - slop - num(shape.props.strokeWidth) / 2;
    }
    case 'Polygon':
    case 'Polyline': {
      const points = Array.isArray(shape.props.points) ? (shape.props.points as readonly (readonly number[])[]) : [];
      let best = Infinity;
      for (let index = 0; index < points.length; index++) {
        const a = points[index]!, b = points[(index + 1) % points.length]!;
        best = Math.min(best, distanceToSegment(x, y, Number(a[0]) || 0, Number(a[1]) || 0, Number(b[0]) || 0, Number(b[1]) || 0));
      }
      if (shape.shapeType === 'Polygon' && pointsInside(points, x, y)) return -slop;
      return best - slop;
    }
    default: {
      const bounds = shapeBounds(shape);
      if (!bounds) return Infinity;
      const dx = Math.max(bounds.x - x, 0, x - (bounds.x + bounds.width));
      const dy = Math.max(bounds.y - y, 0, y - (bounds.y + bounds.height));
      return Math.hypot(dx, dy) - slop;
    }
  }
}

function pointsInside(points: readonly (readonly number[])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i]![0]) || 0, yi = Number(points[i]![1]) || 0;
    const xj = Number(points[j]![0]) || 0, yj = Number(points[j]![1]) || 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

