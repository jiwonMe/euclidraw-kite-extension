/**
 * The real engine. This module is imported ONLY by the worker entry and by the
 * Node test engine; the extension's main chunk must keep `@penrose/core` out
 * (a second copy would blow the 5 MiB install budget).
 */
import { compileTrio, evalEnergy, insertPending, optimize, resample, start, step, stepTimes } from '@penrose/core';
import type { PenroseState } from '@penrose/core';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { measureText, parseFontSize } from '../labels.ts';
import type {
  WireCanvas,
  WireCompiled,
  WireComputedHandle,
  WireDiagnostic,
  WireInputs,
  WireInteractivity,
  WireLayout,
  WireShape,
  WireValue,
} from '../wire.ts';

export interface CompileInput {
  readonly digest: string;
  readonly domain: string;
  readonly substance: string;
  readonly style: string;
  readonly variation: string;
  /** Stored `varyingValues`; when the length matches, Cold mode skips optimization. */
  readonly seeds?: readonly number[];
  readonly maxSteps?: number;
}

export interface ComputedHandle extends WireComputedHandle {
  /** Free input indexes this point depends on (Jacobian columns). */
  readonly indexes: readonly number[];
  /** Row-major 2×N Jacobian: [dx/di0, dy/di0, dx/di1, dy/di1, …]. */
  readonly jacobian: readonly number[];
  /** True when the dominant motion is a rotation around the opposite Line end. */
  readonly angular?: boolean;
}

export interface CoreSession {
  key: string;
  digest: string;
  state: PenroseState;
  compiled: WireCompiled;
  labels: Record<string, string>;
  computed: ComputedHandle[];
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const texDocument = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

// ── Penrose value encoding ──────────────────────────────────────────────────

type AnyValue = { readonly tag: string; readonly contents?: unknown };
type AnyShape = {
  readonly shapeType: string;
  readonly name?: { contents?: string };
  readonly passthrough?: Map<string, AnyValue>;
  readonly path?: unknown;
  readonly [key: string]: unknown;
};

function encode(value: unknown): WireValue {
  const typed = value as AnyValue | number | string | boolean | null | undefined;
  if (typed === null || typed === undefined) return null;
  if (typeof typed === 'number' || typeof typed === 'string' || typeof typed === 'boolean') return typed;
  const tag = typed.tag;
  const contents = typed.contents;
  switch (tag) {
    case 'FloatV':
      return typeof contents === 'number' ? contents : 0;
    case 'StrV':
      return typeof contents === 'string' ? contents : '';
    case 'BoolV':
      return contents === true;
    case 'VectorV':
    case 'PtListV':
      return contents as readonly number[] | readonly (readonly number[])[];
    case 'ColorV': {
      const color = contents as { tag?: string; contents?: number[] } | undefined;
      if (!color || color.tag !== 'RGBA' || !Array.isArray(color.contents)) return null;
      const [r, g, b, a] = color.contents;
      return [r ?? 0, g ?? 0, b ?? 0, a ?? 1] as const;
    }
    case 'PathDataV':
      return Array.isArray(contents)
        ? (contents as { cmd?: string; contents?: { tag?: string; contents?: unknown }[] }[]).map(command => ({
            cmd: command.cmd ?? '',
            values: (command.contents ?? []).map(part => {
              if (part.tag === 'CoordV' && Array.isArray(part.contents)) {
                const [x, y] = part.contents as number[];
                return { kind: 'coord' as const, x: Number(x) || 0, y: Number(y) || 0 };
              }
              // `ValueV` carries an array for arcs: rx ry rotation large-arc sweep.
              const raw = Array.isArray(part.contents) ? part.contents : typeof part.contents === 'number' ? [part.contents] : [];
              return { kind: 'value' as const, values: raw.map(Number).filter(Number.isFinite) };
            }),
          }))
        : null;
    case 'ShapeListV':
      return null; // handled by toWireShape
    case 'ClipDataV':
      return null;
    default:
      return null;
  }
}

function toWireShape(shape: AnyShape, owners: Map<string, string>): WireShape {
  const props: Record<string, WireValue> = {};
  for (const [key, value] of Object.entries(shape)) {
    if (key === 'path' || key === 'passthrough' || key === 'shapeType' || key === 'name') continue;
    if (key === 'shapes') continue;
    if (key === 'clipPath') continue;
    const encoded = encode(value);
    if (encoded !== null) props[key] = encoded;
  }
  const passthrough: Record<string, WireValue> = {};
  if (shape.passthrough instanceof Map) {
    for (const [key, value] of shape.passthrough) {
      const encoded = encode(value);
      if (encoded !== null) passthrough[key] = encoded;
    }
  }
  const kids = groupChildren(shape);
  const children = kids.length ? kids.map(child => toWireShape(child, owners)) : undefined;
  // `ClipDataV.contents` is `NoClip | Clip`, and a `Clip` holds one shape
  // (`clip(a)`), not a list.
  const clipEntry = shape.clipPath as { contents?: { tag?: string; contents?: unknown } } | undefined;
  const clipShape = clipEntry?.contents?.tag === 'Clip' ? (clipEntry.contents.contents as AnyShape | undefined) : undefined;
  const clip = clipShape ? [toWireShape(clipShape, owners)] : undefined;
  const name = shape.name?.contents ?? '';
  const owner = ownerOf(shape.path);
  return {
    shapeType: shape.shapeType,
    name,
    ...(owner ? { owner } : {}),
    props,
    passthrough,
    ...(children && children.length ? { children } : {}),
    ...(clip && clip.length ? { clip } : {}),
  };
}

/**
 * Penrose stores a Group's members in a `ShapeListV` value
 * (`shape.shapes.contents`), not in a plain array, so any `Array.isArray`
 * check silently drops every child and the group renders empty.
 */
function groupChildren(shape: AnyShape): AnyShape[] {
  const list = (shape.shapes as { contents?: unknown } | undefined)?.contents;
  return Array.isArray(list) ? (list as AnyShape[]) : [];
}

function ownerOf(path: unknown): string | undefined {
  let node = path as { tag?: string; access?: unknown; parent?: unknown; substanceObject?: { name?: string }; styleName?: string; name?: string } | undefined;
  const seen = new Set<unknown>();
  while (node && !seen.has(node)) {
    seen.add(node);
    if (node.tag === 'Substance' && node.substanceObject?.name) return node.substanceObject.name;
    if (node.tag === 'Collection' && node.styleName) return `collection:${node.styleName}`;
    if (node.tag === 'Namespace' && node.name) return `namespace:${node.name}`;
    node = (node.access ?? node.parent) as typeof node;
  }
  return undefined;
}

/** Every shape, including Group children, flattened. */
function flattenShapes(shapes: readonly AnyShape[], out: AnyShape[] = []): AnyShape[] {
  for (const shape of shapes) {
    out.push(shape);
    flattenShapes(groupChildren(shape), out);
  }
  return out;
}

/** shape name → owning substance object. Shapes inside a Group still belong. */
function ownerMap(state: PenroseState): Map<string, string> {
  const map = new Map<string, string>();
  for (const shape of flattenShapes(state.shapes as unknown as AnyShape[])) {
    const name = shape.name?.contents;
    const owner = ownerOf(shape.path);
    if (name && owner && !map.has(name)) map.set(name, owner);
  }
  return map;
}

// ── Computed (projected) handles ───────────────────────────────────────────

type PointField = 'center' | 'start' | 'end' | 'points';

// The ray-tracing example needs ~130 inputs; the Jacobian for 126 inputs over
// 26 candidates takes ~7 ms, so this bound is generous but still finite.
const MAX_COMPUTED_INPUTS = 200;
const MAX_COMPUTED_HANDLES = 160;

function shapesByName(shapes: readonly AnyShape[], out = new Map<string, AnyShape>()): Map<string, AnyShape> {
  for (const shape of shapes) {
    const name = shape.name?.contents;
    if (name) out.set(name, shape);
    shapesByName(groupChildren(shape), out);
  }
  return out;
}

/** The other end of a Line, used as the pivot for an angular (rotate) gizmo. */
function oppositeEndpoint(shape: AnyShape | undefined, field: PointField): [number, number] | undefined {
  if (!shape || shape.shapeType !== 'Line') return undefined;
  if (field === 'end') return pointOf(shape, 'start', 0);
  if (field === 'start') return pointOf(shape, 'end', 0);
  return undefined;
}

/**
 * Is this point's dominant response to a free input a rotation around `pivot`
 * rather than a translation? Ray/arrow tips are derived from a direction, so
 * dragging them should change an angle; derived points that just copy a free
 * input respond radially (or uniformly) and must stay translational.
 */
function isAngularPoint(row: readonly number[], point: [number, number], pivot: [number, number]): boolean {
  const rx = point[0] - pivot[0], ry = point[1] - pivot[1];
  const radius = Math.hypot(rx, ry);
  if (!(radius > 1e-6)) return false;
  const tx = -ry / radius, ty = rx / radius;
  const ux = rx / radius, uy = ry / radius;
  for (let k = 0; k < row.length / 2; k++) {
    const dx = row[2 * k] ?? 0, dy = row[2 * k + 1] ?? 0;
    const tangent = Math.abs(dx * tx + dy * ty);
    const radial = Math.abs(dx * ux + dy * uy);
    if (tangent > 1e-6 && tangent > 2.5 * radial) return true;
  }
  return false;
}

function pointOf(shape: AnyShape | undefined, field: PointField, index: number): [number, number] | undefined {
  if (!shape) return undefined;
  const container = field === 'points' ? (shape.points as { contents?: number[][] } | undefined) : (shape[field] as { contents?: number[] } | undefined);
  const value = field === 'points' ? container?.contents?.[index] : container?.contents;
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = Number(value[0]), y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

function freeInputIndexes(state: PenroseState): number[] {
  const free: number[] = [];
  state.inputs.forEach((input, index) => {
    const meta = input as unknown as { meta?: { init?: { tag?: string } } };
    if (meta.meta?.init?.tag !== 'Pending') free.push(index);
  });
  return free;
}

interface Candidate {
  readonly shape: string;
  readonly field: PointField;
  readonly index: number;
  readonly owner?: string;
  readonly priority: number;
  readonly x: number;
  readonly y: number;
}

function candidatesOf(shapes: readonly AnyShape[], owners: Map<string, string>): Candidate[] {
  const found: Candidate[] = [];
  const add = (shape: AnyShape, field: PointField, index: number, priority: number) => {
    const name = shape.name?.contents;
    if (!name) return;
    const point = pointOf(shape, field, index);
    if (!point) return;
    const owner = owners.get(name);
    found.push({ shape: name, field, index, ...(owner ? { owner } : {}), priority, x: point[0], y: point[1] });
  };
  const visit = (list: readonly AnyShape[]) => {
    for (const shape of list) {
      switch (shape.shapeType) {
        case 'Circle':
        case 'Ellipse':
        case 'Image':
        case 'Rectangle':
          add(shape, 'center', 0, 1);
          break;
        case 'Line':
          add(shape, 'start', 0, 2);
          add(shape, 'end', 0, 2);
          break;
        case 'Polygon':
        case 'Polyline': {
          const points = (shape.points as { contents?: number[][] } | undefined)?.contents ?? [];
          for (let index = 0; index < points.length; index++) add(shape, 'points', index, 3);
          break;
        }
        case 'Group':
          visit(groupChildren(shape));
          break;
        default:
          break;
      }
    }
  };
  visit(shapes);
  // Collapse stacked affordances (polygon vertex + vertex dot + label) into one.
  const byPosition = new Map<string, Candidate>();
  for (const candidate of found) {
    const key = `${Math.round(candidate.x * 2)},${Math.round(candidate.y * 2)}`;
    const previous = byPosition.get(key);
    if (!previous || candidate.priority > previous.priority) byPosition.set(key, candidate);
  }
  return [...byPosition.values()];
}

function solvePointDelta(handle: ComputedHandle, dx: number, dy: number): number[] {
  const count = handle.indexes.length;
  let a = 0, b = 0, c = 0;
  for (let k = 0; k < count; k++) {
    const jx = handle.jacobian[2 * k] ?? 0, jy = handle.jacobian[2 * k + 1] ?? 0;
    a += jx * jx; b += jx * jy; c += jy * jy;
  }
  const lambda = 1e-3 * Math.max(1, (a + c) / Math.max(1, count));
  a += lambda; c += lambda;
  const det = a * c - b * b;
  const delta = new Array<number>(count).fill(0);
  if (!(det > 1e-12)) return delta;
  const u = (c * dx - b * dy) / det;
  const v = (a * dy - b * dx) / det;
  let peak = 0;
  for (let k = 0; k < count; k++) {
    delta[k] = (handle.jacobian[2 * k] ?? 0) * u + (handle.jacobian[2 * k + 1] ?? 0) * v;
    peak = Math.max(peak, Math.abs(delta[k]!));
  }
  // Keep one frame's input change bounded so a nearly singular Jacobian cannot
  // fling the diagram across the canvas.
  const limit = 30;
  if (peak > limit) for (let k = 0; k < count; k++) delta[k] = (delta[k]! / peak) * limit;
  return delta;
}

/** Points that move because free inputs change, with a local 2D Jacobian. */
function buildComputedHandles(session: CoreSession): ComputedHandle[] {
  const state = session.state;
  const free = freeInputIndexes(state);
  if (!free.length || free.length > MAX_COMPUTED_INPUTS) return [];
  const direct = new Set<string>();
  for (const input of [...session.compiled.interactivity.translatable, ...session.compiled.interactivity.scalable]) {
    if (input.center) direct.add(`${input.path}|center|0`);
    if (input.start) direct.add(`${input.path}|start|0`);
    if (input.end) direct.add(`${input.path}|end|0`);
    for (let index = 0; index < (input.points?.length ?? 0); index++) direct.add(`${input.path}|points|${index}`);
  }
  const owners = ownerMap(state);
  let baseShapes: AnyShape[];
  try { baseShapes = state.computeShapes(state.varyingValues) as unknown as AnyShape[]; } catch { return []; }
  const candidates = candidatesOf(baseShapes, owners)
    .filter(candidate => !direct.has(`${candidate.shape}|${candidate.field}|${candidate.index}`))
    .slice(0, MAX_COMPUTED_HANDLES);
  if (!candidates.length) return [];
  const baseByName = shapesByName(baseShapes);
  const jacobian = candidates.map(() => new Array<number>(free.length * 2).fill(0));
  const baseValues = [...state.varyingValues];
  const working = [...baseValues];
  const started = performance.now();
  let complete = true;
  for (let k = 0; k < free.length; k++) {
    // Bound cold-open work: partial Jacobians would make handles misleading.
    if (performance.now() - started > 250) { complete = false; break; }
    const index = free[k]!;
    const epsilon = 1e-4 * Math.max(1, Math.abs(working[index] ?? 0));
    working[index] = (baseValues[index] ?? 0) + epsilon;
    let perturbed: Map<string, AnyShape>;
    try { perturbed = shapesByName(state.computeShapes(working) as unknown as AnyShape[]); } catch { working[index] = baseValues[index]!; continue; }
    working[index] = baseValues[index]!;
    for (let c = 0; c < candidates.length; c++) {
      const candidate = candidates[c]!;
      const before = pointOf(baseByName.get(candidate.shape), candidate.field, candidate.index);
      const after = pointOf(perturbed.get(candidate.shape), candidate.field, candidate.index);
      if (!before || !after) continue;
      jacobian[c]![2 * k] = (after[0] - before[0]) / epsilon;
      jacobian[c]![2 * k + 1] = (after[1] - before[1]) / epsilon;
    }
  }
  if (!complete) return [];
  const handles: ComputedHandle[] = [];
  for (let c = 0; c < candidates.length; c++) {
    const candidate = candidates[c]!;
    const row = jacobian[c]!;
    const magnitude = Math.hypot(...row);
    if (!(magnitude > 1e-6)) continue;
    // Only tips get the angular grip: rotating a base around its tip is a
    // different gesture and would fight the upstream geometry.
    const pivot = candidate.field === 'end' ? oppositeEndpoint(baseByName.get(candidate.shape), candidate.field) : undefined;
    const angular = pivot ? isAngularPoint(row, [candidate.x, candidate.y], pivot) : false;
    handles.push({
      id: `${candidate.shape}|${candidate.field}|${candidate.index}`,
      shape: candidate.shape,
      field: candidate.field,
      index: candidate.index,
      ...(candidate.owner ? { owner: candidate.owner } : {}),
      x: candidate.x,
      y: candidate.y,
      indexes: free,
      jacobian: row,
      ...(angular ? { angular: true } : {}),
    });
  }
  return handles;
}

// ── Labels (deterministic) ─────────────────────────────────────────────────

interface LabelDims {
  width: number;
  height: number;
  ascent: number;
  descent: number;
}

function equationLabel(source: string, fontSize: string): { dims: LabelDims; svg: string } | undefined {
  try {
    const node = texDocument.convert(source, { display: false }) as {
      attributes?: Record<string, string>;
      children?: unknown[];
      kind?: string;
    };
    if (node.kind === 'error' || node.attributes?.['data-mjx-error']) return undefined;
    const markup = adaptor.outerHTML(node as never);
    // MathJax wraps the drawing in a custom `<mjx-container>` element, which is
    // not SVG: injecting it into the scene does not paint anything. Keep only
    // the inner `<svg>` (that is also what Penrose's own renderer clones).
    const svgMarkup = /<svg\b[\s\S]*<\/svg>/.exec(markup)?.[0] ?? markup;
    const viewBox = /viewBox="([^"]+)"/.exec(svgMarkup);
    if (!viewBox) return undefined;
    const parts = viewBox[1]!.trim().split(/\s+/).map(Number);
    const widthEm = (parts[2] ?? 0) / 1000;
    const heightEm = (parts[3] ?? 0) / 1000;
    const size = parseFontSize(fontSize, 16);
    const height = heightEm * size;
    const width = widthEm * size;
    const svg = svgMarkup
      .replace(/\swidth="[^"]*"/, ` width="${width}"`)
      .replace(/\sheight="[^"]*"/, ` height="${height}"`)
      .replace(/\sstyle="[^"]*"/, '');
    return { dims: { width, height, ascent: height * 0.85, descent: height * 0.15 }, svg };
  } catch {
    return undefined;
  }
}

function collectLabelDims(state: PenroseState): { cache: Map<string, unknown>; svgs: Record<string, string> } {
  const cache = new Map<string, unknown>();
  const svgs: Record<string, string> = {};
  const visit = (shapes: readonly AnyShape[]) => {
    for (const shape of shapes) {
      const name = shape.name?.contents ?? '';
      if (shape.shapeType === 'Text') {
        const stringValue = (shape.string as { contents?: string } | undefined)?.contents ?? '';
        const size = parseFontSize((shape.fontSize as { contents?: string } | undefined)?.contents, 14);
        const metrics = measureText(stringValue, size);
        cache.set(name, {
          tag: 'TextData',
          width: { tag: 'FloatV', contents: metrics.width },
          height: { tag: 'FloatV', contents: metrics.height },
          ascent: { tag: 'FloatV', contents: metrics.ascent },
          descent: { tag: 'FloatV', contents: metrics.descent },
        });
      } else if (shape.shapeType === 'Equation') {
        const source = (shape.string as { contents?: string } | undefined)?.contents ?? '';
        const fontSize = (shape.fontSize as { contents?: string } | undefined)?.contents ?? '16px';
        const label = equationLabel(source, fontSize);
        if (!label) continue;
        svgs[name] = label.svg;
        cache.set(name, {
          tag: 'EquationData',
          width: { tag: 'FloatV', contents: label.dims.width },
          height: { tag: 'FloatV', contents: label.dims.height },
          ascent: { tag: 'FloatV', contents: label.dims.ascent },
          descent: { tag: 'FloatV', contents: label.dims.descent },
          rendered: {},
        });
      }
      visit(groupChildren(shape));
    }
  };
  visit(state.shapes as unknown as AnyShape[]);
  return { cache, svgs };
}

// ── Diagnostics ────────────────────────────────────────────────────────────

function toDiagnostics(error: unknown): WireDiagnostic[] {
  const value = error as {
    tag?: string;
    message?: string;
    location?: { line?: number; col?: number };
    fileType?: string;
    errors?: unknown[];
  };
  const source = (fileType: string | undefined): WireDiagnostic['source'] =>
    fileType === 'Domain' ? 'Domain' : fileType === 'Substance' ? 'Substance' : fileType === 'Style' ? 'Style' : 'Runtime';
  if (Array.isArray(value.errors) && value.errors.length) return value.errors.flatMap(toDiagnostics);
  return [{
    source: source(value.fileType),
    line: value.location?.line ?? 1,
    column: value.location?.col ?? 1,
    message: value.message ?? 'Penrose compile error',
  }];
}

// ── Engine API ─────────────────────────────────────────────────────────────

function canvasOf(state: PenroseState): WireCanvas {
  const canvas = state.canvas as unknown as { width: number; height: number };
  return { width: canvas.width, height: canvas.height };
}

function interactivityOf(state: PenroseState): WireInteractivity {
  const translatable: WireInputs[] = [];
  const scalable: WireInputs[] = [];
  const info = state.interactivityInfo;
  const byPath = info.inputIdxsByPath;
  // Pending inputs are label measurements: insertPending resolved them to
  // constants, so an index may still exist without being a free degree.
  const isFree = (index: number): boolean => {
    const input = state.inputs[index] as { meta?: { init?: { tag?: string } } } | undefined;
    return !!input && input.meta?.init?.tag !== 'Pending';
  };
  const read = (container: unknown): { tag?: string; contents?: unknown } | undefined => {
    const entry = container as { tag?: string; contents?: unknown } | undefined;
    if (!entry) return undefined;
    if (entry.tag === 'Val') return entry.contents as { tag?: string; contents?: unknown };
    return entry;
  };
  const pair = (path: string, property: string): [number, number] | undefined => {
    const value = read(byPath.get(`${path}.${property}`));
    if (value?.tag === 'VectorV' && Array.isArray(value.contents) && value.contents.length >= 2) {
      const x = Number(value.contents[0]), y = Number(value.contents[1]);
      return isFree(x) && isFree(y) ? [x, y] : undefined;
    }
    return undefined;
  };
  const single = (path: string, property: string): number | undefined => {
    const value = read(byPath.get(`${path}.${property}`));
    return value?.tag === 'FloatV' && typeof value.contents === 'number' && isFree(value.contents) ? value.contents : undefined;
  };
  const points = (path: string): [number, number][] | undefined => {
    const value = read(byPath.get(`${path}.points`));
    if (value?.tag !== 'PtListV' || !Array.isArray(value.contents)) return undefined;
    const list = (value.contents as unknown[]).map(point =>
      Array.isArray(point) && point.length >= 2
        ? ([Number(point[0]), Number(point[1])] as [number, number])
        : undefined,
    );
    if (list.some(point => !point || !isFree(point[0]) || !isFree(point[1]))) return undefined;
    return list as [number, number][];
  };

  // Broad on purpose: ask which properties are optimization inputs, not only
  // the shapes core labels "translatable". A partially free shape still gets a
  // handle for the axes it can actually move.
  for (const [path, shape] of info.shapesByPath) {
    const center = pair(path, 'center');
    const start = pair(path, 'start');
    const end = pair(path, 'end');
    const pointList = points(path);
    const r = single(path, 'r');
    const rx = single(path, 'rx');
    const ry = single(path, 'ry');
    const width = single(path, 'width');
    const height = single(path, 'height');
    const movable = !!(center || start || end || pointList);
    const resizable = r !== undefined || rx !== undefined || ry !== undefined || width !== undefined || height !== undefined;
    if (!movable && !resizable) continue;
    const owner = ownerOf((shape as unknown as AnyShape).path);
    const recorded: WireInputs = {
      path,
      ...(owner ? { owner } : {}),
      ...(center ? { center } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(pointList ? { points: pointList } : {}),
      ...(r !== undefined ? { r } : {}),
      ...(rx !== undefined ? { rx } : {}),
      ...(ry !== undefined ? { ry } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    };
    if (movable) translatable.push(recorded);
    if (resizable) scalable.push(recorded);
  }
  return { translatable, scalable };
}

function compiledOf(session: CoreSession): WireCompiled {
  const state = session.state;
  const owners = new Set(ownerMap(state).values());
  return {
    digest: session.digest,
    owners: [...owners].sort(),
    canvas: canvasOf(state),
    varyingValues: [...state.varyingValues],
    optStages: [...state.optStages] as string[],
    interactivity: interactivityOf(state),
    warnings: (state.warnings ?? []).map(warning => String((warning as { message?: string }).message ?? warning)),
    labels: session.labels,
    diagnostics: [],
  };
}

export async function compileSession(input: CompileInput): Promise<CoreSession> {
  const compiled = await compileTrio({
    domain: input.domain,
    substance: input.substance,
    style: input.style,
    variation: input.variation,
    excludeWarnings: [],
  });
  if (!compiled.isOk()) {
    const error = compiled.error;
    throw Object.assign(new Error('Penrose compile failed'), { penroseDiagnostics: toDiagnostics(error) });
  }
  const state = compiled.value;
  const labels = collectLabelDims(state);
  state.labelCache = labels.cache as never;
  // `insertPending` returns a new state whose `varyingValues` carry the measured
  // label sizes. Keeping the old object leaves width/height at their pending
  // zero, which makes rect-based text constraints produce NaN.
  const measured = insertPending(state);

  const session: CoreSession = {
    key: '',
    digest: input.digest,
    state: measured,
    compiled: undefined as unknown as WireCompiled,
    labels: labels.svgs,
    computed: [],
  };

  const seeds = input.seeds ?? [];
  if (seeds.length === measured.varyingValues.length && input.seeds !== undefined) {
    session.state = { ...measured, varyingValues: [...seeds] };
  } else {
    const optimized = optimize(measured);
    if (optimized.isErr()) throw Object.assign(new Error('Penrose optimize failed'), { penroseDiagnostics: toDiagnostics(optimized.error) });
    session.state = optimized.value;
  }
  session.compiled = compiledOf(session);
  session.computed = buildComputedHandles(session);
  return session;
}

export function layoutOf(session: CoreSession, varyingValues?: readonly number[]): WireLayout {
  const state = session.state;
  const values = varyingValues ? [...varyingValues] : state.varyingValues;
  const ownersByName = ownerMap(state);
  const rawShapes = state.computeShapes(values) as unknown as AnyShape[];
  const shapes = rawShapes.map(shape => toWireShape(shape, ownersByName));
  const rawByName = shapesByName(rawShapes);
  const computed: WireComputedHandle[] = [];
  for (const handle of session.computed) {
    const shape = rawByName.get(handle.shape);
    const point = pointOf(shape, handle.field, handle.index);
    if (!point) continue;
    const pivot = handle.angular ? oppositeEndpoint(shape, handle.field) : undefined;
    computed.push({
      id: handle.id,
      shape: handle.shape,
      field: handle.field,
      index: handle.index,
      ...(handle.owner ? { owner: handle.owner } : {}),
      x: point[0],
      y: point[1],
      ...(pivot ? { pivot: { x: pivot[0], y: pivot[1] } } : {}),
    });
  }
  const owners = new Set(ownersByName.values());
  return {
    digest: session.digest,
    shapes,
    canvas: canvasOf(state),
    varyingValues: values,
    owners: [...owners].sort(),
    interactivity: interactivityOf(state),
    computed,
    labels: session.labels,
    energy: evalEnergy({ ...state, varyingValues: values }),
    stages: realStageIndex(state),
  };
}

/** Re-run optimization on a fresh session from stored seeds (Dirty/Apply). */
export function convergeSession(session: CoreSession, maxSteps = 10_000): WireCompiled {
  const stepped = stepTimes(session.state, maxSteps);
  if (stepped.isOk()) session.state = stepped.value;
  session.compiled = compiledOf(session);
  session.computed = buildComputedHandles(session);
  return session.compiled;
}

/**
 * Drag a point that is not itself an input (projection, expression) by solving
 * the local 2D Jacobian for a minimum-norm input change, then re-converging.
 */
export function dragPointSession(
  session: CoreSession,
  handleId: string,
  target: { x: number; y: number },
  steps: number,
  budgetMs = 0,
): WireLayout {
  const handle = session.computed.find(entry => entry.id === handleId);
  if (!handle) return layoutOf(session);
  const beforeLabels = labelSnapshot(session.state);
  const beforeEnergy = dragEnergy(session.state, session.state.varyingValues);
  let state = session.state;
  for (let round = 0; round < 2; round++) {
    let shapes: Map<string, AnyShape>;
    try { shapes = shapesByName(state.computeShapes(state.varyingValues) as unknown as AnyShape[]); } catch { break; }
    const point = pointOf(shapes.get(handle.shape), handle.field, handle.index);
    if (!point) break;
    const dx = target.x - point[0], dy = target.y - point[1];
    if (Math.hypot(dx, dy) < 0.05) break;
    const delta = solvePointDelta(handle, dx, dy);
    const values = [...state.varyingValues];
    for (let k = 0; k < handle.indexes.length; k++) {
      const index = handle.indexes[k]!;
      values[index] = (values[index] ?? 0) + delta[k]!;
    }
    // Split the frame budget across the two IK rounds.
    state = settleForDrag({ ...state, varyingValues: values }, Math.max(0, steps), budgetMs > 0 ? budgetMs / 2 : 0);
  }
  // Final exact correction: the dragged point must sit under the pointer even
  // if the last convergence pass pulled it away; the next frame re-converges.
  try {
    const shapes = shapesByName(state.computeShapes(state.varyingValues) as unknown as AnyShape[]);
    const point = pointOf(shapes.get(handle.shape), handle.field, handle.index);
    if (point) {
      const delta = solvePointDelta(handle, target.x - point[0], target.y - point[1]);
      const values = [...state.varyingValues];
      for (let k = 0; k < handle.indexes.length; k++) {
        const index = handle.indexes[k]!;
        values[index] = (values[index] ?? 0) + delta[k]!;
      }
      state = { ...state, varyingValues: values };
    }
  } catch { /* keep the converged state */ }
  followLabels(state, beforeLabels, state);
  if (exploded(beforeEnergy, evalEnergy(state))) state = dragStageOf(session.state);
  session.state = state;
  return layoutOf(session);
}

interface LabelSnapshot {
  readonly anchors: Map<string, { x: number; y: number }>;
  readonly labels: readonly { name: string; owner: string; indexes: [number, number]; x: number; y: number }[];
}

/**
 * Labels are positioned by the text stage, whose compiled objectives hold the
 * dot positions from the last full stage pass. Dragging only the current stage
 * therefore leaves labels stale. Snapshot owner anchors and translate labels
 * with their owner during the preview; the release polish re-places them under
 * the real constraints.
 */
function labelSnapshot(state: PenroseState): LabelSnapshot {
  const owners = ownerMap(state);
  const sums = new Map<string, { x: number; y: number; count: number }>();
  const labels: { name: string; owner: string; indexes: [number, number]; x: number; y: number }[] = [];
  const byPath = state.interactivityInfo.inputIdxsByPath;
  const walk = (list: readonly AnyShape[]) => {
    for (const shape of list) {
      const name = shape.name?.contents ?? '';
      const owner = owners.get(name);
      walk(groupChildren(shape));
      if (!owner) continue;
      const type = shape.shapeType;
      if (type === 'Text' || type === 'Equation') {
        const entry = byPath.get(`${name}.center`) as { tag?: string; contents?: unknown } | undefined;
        const inner = entry?.tag === 'Val' ? (entry.contents as { tag?: string; contents?: unknown }) : entry;
        const value = inner?.tag === 'VectorV' && Array.isArray(inner.contents) ? (inner.contents as number[]) : undefined;
        if (value && typeof value[0] === 'number' && typeof value[1] === 'number') {
          labels.push({ name, owner, indexes: [value[0], value[1]], x: state.varyingValues[value[0]] ?? 0, y: state.varyingValues[value[1]] ?? 0 });
        }
        continue;
      }
      const point = (() => {
        if (type === 'Circle' || type === 'Ellipse' || type === 'Rectangle' || type === 'Image') return pointOf(shape, 'center', 0);
        if (type === 'Line') {
          const a = pointOf(shape, 'start', 0), b = pointOf(shape, 'end', 0);
          return a && b ? ([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number]) : undefined;
        }
        if (type === 'Polygon' || type === 'Polyline') {
          const points = (shape.points as { contents?: number[][] } | undefined)?.contents ?? [];
          if (!points.length) return undefined;
          let sx = 0, sy = 0;
          for (const p of points) { sx += Number(p[0]) || 0; sy += Number(p[1]) || 0; }
          return [sx / points.length, sy / points.length] as [number, number];
        }
        return undefined;
      })();
      if (!point) continue;
      const sum = sums.get(owner) ?? { x: 0, y: 0, count: 0 };
      sum.x += point[0]; sum.y += point[1]; sum.count += 1;
      sums.set(owner, sum);
    }
  };
  let computedShapes: AnyShape[] = [];
  try { computedShapes = state.computeShapes(state.varyingValues) as unknown as AnyShape[]; } catch { /* keep empty */ }
  walk(computedShapes);
  const anchors = new Map<string, { x: number; y: number }>();
  for (const [owner, sum] of sums) anchors.set(owner, { x: sum.x / sum.count, y: sum.y / sum.count });
  return { anchors, labels };
}

/** Translate label centres by the movement of their owner's anchor. */
function followLabels(state: PenroseState, before: LabelSnapshot, afterState: PenroseState): void {
  const after = labelSnapshot(afterState);
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const [owner, anchor] of after.anchors) {
    const start = before.anchors.get(owner);
    if (!start) continue;
    const dx = anchor.x - start.x, dy = anchor.y - start.y;
    if (Math.hypot(dx, dy) > 1e-6) deltas.set(owner, { dx, dy });
  }
  if (!deltas.size) return;
  const values = [...state.varyingValues];
  for (const label of before.labels) {
    const delta = deltas.get(label.owner);
    if (!delta) continue;
    values[label.indexes[0]] = label.x + delta.dx;
    values[label.indexes[1]] = label.y + delta.dy;
  }
  state.varyingValues = values;
}

interface StageMasks {
  readonly inputMask: boolean[];
  readonly constrMask: boolean[];
  readonly objMask: boolean[];
}

const DRAG_STAGE = '__drag__';

/**
 * Penrose stages are cumulative in *intent* but not in their masks: a stage
 * only optimizes the constraints assigned to it. After a compile the optimizer
 * sits on the last (usually arrow) stage, so dragging with only that stage
 * leaves `disjoint` in the geometry stage unenforced and the dragged shape
 * ploughs through its neighbours (this is what wrecked the architecture
 * example).
 *
 * Build one synthetic stage that unions the current stage with the immediately
 * preceding one: that is the geometry stage (rects: `disjoint`, shapeDistance)
 * plus the current stage (arrow attachment). Unioning *every* stage is wrong:
 * earlier stages may hold constraints the staged solve has already abandoned
 * (e.g. dots that pull connected parts together), so re-enabling them makes the
 * diagram collapse.
 */
function dragStageOf(state: PenroseState): PenroseState {
  const stages = state.optStages as readonly string[];
  if (stages.includes(DRAG_STAGE)) {
    const index = stages.indexOf(DRAG_STAGE);
    return state.currentStageIndex === index ? state : { ...state, currentStageIndex: index };
  }
  const sets = state.constraintSets as Map<string, StageMasks>;
  const current = state.currentStageIndex;
  const group = [stages[Math.max(0, current - 1)], stages[current]]
    .filter((name): name is string => name !== undefined);
  const masks = group.map(name => sets.get(name)).filter((mask): mask is StageMasks => mask !== undefined);
  if (!masks.length) return state;
  const combine = (key: keyof StageMasks) => {
    const size = masks[0]![key].length;
    const out = new Array<boolean>(size).fill(false);
    for (const mask of masks) for (let i = 0; i < size; i++) if (mask[key][i]) out[i] = true;
    return out;
  };
  sets.set(DRAG_STAGE, { inputMask: combine('inputMask'), constrMask: combine('constrMask'), objMask: combine('objMask') });
  return { ...state, optStages: [...stages, DRAG_STAGE], currentStageIndex: stages.length };
}

/** The real (non-synthetic) stage index, for display and release logic. */
function realStageIndex(state: PenroseState): number {
  const stages = state.optStages as readonly string[];
  const drag = stages.indexOf(DRAG_STAGE);
  if (drag === -1 || state.currentStageIndex !== drag) return state.currentStageIndex;
  return Math.max(0, drag - 1);
}

/**
 * One drag frame. The previous optimizer state ends at `EPConverged`, where
 * `step` is a no-op; because a drag changes `varyingValues` directly, we must
 * restart the optimizer (keeping the warm-start values and penalty weight) or
 * every frame after the first would skip convergence.
 */
function settleForDrag(input: PenroseState, steps: number, budgetMs = 0): PenroseState {
  const state = dragStageOf(input);
  // The drag stage now carries the hard geometry constraints, so it needs a
  // weight stiff enough to keep `disjoint` satisfied while the pointer moves.
  // Very large diagrams use a slightly softer weight so a time-budgeted step
  // stays stable; smaller ones keep the label-friendly 1e8.
  const count = state.varyingValues.length;
  const DRAG_WEIGHT = count > 250 ? 1e7 : 1e8;
  const params = {
    ...start(count),
    weight: Math.min(state.params.weight, DRAG_WEIGHT),
  } as PenroseState['params'];
  if (budgetMs > 0) {
    const started = performance.now();
    try {
      const stepped = step({ ...state, params }, { until: () => performance.now() - started >= budgetMs });
      return stepped.isOk() ? stepped.value : { ...state, params };
    } catch {
      return { ...state, params };
    }
  }
  const stepped = stepTimes({ ...state, params }, steps);
  return stepped.isOk() ? stepped.value : { ...state, params };
}

/**
 * Energy of the drag-stage problem for these values. The guard must compare
 * energies under the *same* masks and weight as the frame it is judging:
 * comparing the last (arrow) stage against the union drag stage made every
 * frame look like an explosion once the earlier geometry stage was included,
 * so projected handles never moved at all.
 */
function dragEnergy(state: PenroseState, values: readonly number[]): number {
  try {
    return evalEnergy(dragStageOf({ ...state, varyingValues: [...values] }));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Reject a drag frame that let one optimizer step wreck the layout.
 *
 * The threshold has to allow the ordinary penalty a drag creates. A diagram
 * whose constraints are all satisfied and that has no objective terms has an
 * energy of exactly 0, so a purely relative test (`before * 8 + 1e6`) rejects
 * the very first pointer step and a projected handle never moves at all. Use an
 * absolute floor in that case; it still catches runaway steps (1e12 and up).
 */
function exploded(before: number, after: number): boolean {
  if (!Number.isFinite(after)) return true;
  return after > (before > 0 ? before * 8 + 1e6 : 1e9);
}

/** Drag: move the given input indexes to absolute targets, converge, then re-pin. */
export function dragSession(
  session: CoreSession,
  targets: readonly { index: number; value: number }[],
  steps: number,
  budgetMs = 0,
): WireLayout {
  const beforeLabels = labelSnapshot(session.state);
  const values = [...session.state.varyingValues];
  for (const target of targets) {
    if (target.index >= 0 && target.index < values.length) values[target.index] = target.value;
  }
  const beforeEnergy = dragEnergy(session.state, values);
  const deadline = performance.now() + Math.max(0, budgetMs);
  let state: PenroseState = dragStageOf({ ...session.state, varyingValues: values });
  // Alternate converge and re-pin: pinning after a converged step leaves the
  // rest of the diagram at the pre-pin solution, so run a second round inside
  // the same frame budget.
  const rounds = budgetMs > 0 ? 3 : 1;
  for (let round = 0; round < rounds; round++) {
    const remaining = budgetMs > 0 ? Math.max(1, deadline - performance.now()) : 0;
    state = settleForDrag(state, steps, remaining);
    const pinned = [...state.varyingValues];
    for (const target of targets) {
      if (target.index >= 0 && target.index < pinned.length) pinned[target.index] = target.value;
    }
    state = { ...state, varyingValues: pinned };
  }
  followLabels(state, beforeLabels, state);
  // Never let one frame explode the diagram; keep the dragged input at the
  // pointer and let the next frame try again.
  if (exploded(beforeEnergy, evalEnergy(state))) {
    const safeValues = [...session.state.varyingValues];
    for (const target of targets) {
      if (target.index >= 0 && target.index < safeValues.length) safeValues[target.index] = target.value;
    }
    // Stay on the drag stage: flipping back to the arrow stage every frame
    // would re-add the union stage and re-apply the same failing comparison.
    state = dragStageOf({ ...session.state, varyingValues: safeValues });
    followLabels(state, beforeLabels, state);
  }
  session.state = state;
  return layoutOf(session);
}

export interface PolishOptions {
  readonly maxSteps?: number;
  /** Wall-clock budget for the polish pass (0 = run maxSteps). */
  readonly budgetMs?: number;
  /** Inputs to restore after polishing (the dragged handle's targets). */
  readonly pins?: readonly { index: number; value: number }[];
}

/**
 * A gentle end-of-drag clean-up. Re-running every stage from stage 0 re-solved
 * the whole diagram and made objects jump on release, so polish only the
 * current stage at the drag weight, restore the dragged inputs, and keep labels
 * attached to their owner's movement.
 */
export function polishSession(session: CoreSession, options: PolishOptions = {}): WireLayout {
  const { maxSteps = 4000, budgetMs = 0, pins = [] } = options;
  const beforeLabels = labelSnapshot(session.state);
  const state = session.state;
  // Seed the pass with the drag targets. Pinning only *after* stepping left the
  // neighbours at their old place and then teleported the dragged shape onto
  // them, so the release could not separate it; the optimizer has to start
  // from the drop position with the target already fixed.
  const pinValues = (source: readonly number[]): number[] => {
    const values = [...source];
    for (const pin of pins) if (pin.index >= 0 && pin.index < values.length) values[pin.index] = pin.value;
    return values;
  };
  // Stay on the drag stage: it is the union of the geometry and arrow stages,
  // so the release pass hardens `disjoint` without re-running abandoned stages.
  const restarted: PenroseState = {
    ...state,
    varyingValues: pinValues(state.varyingValues),
    params: {
      ...start(state.varyingValues.length),
      weight: Math.min(state.params.weight, 1e8),
    } as PenroseState['params'],
  };
  let polished = restarted;
  if (budgetMs > 0) {
    const started = performance.now();
    try {
      const stepped = step(restarted, { until: () => performance.now() - started >= budgetMs });
      if (stepped.isOk()) polished = stepped.value;
    } catch { /* keep restarted */ }
  } else {
    const stepped = stepTimes(restarted, maxSteps);
    if (stepped.isOk()) polished = stepped.value;
  }
  if (pins.length) polished = { ...polished, varyingValues: pinValues(polished.varyingValues) };
  // A polish pass must never make the diagram worse than its seeded start;
  // otherwise keep that start instead of jumping on release.
  const afterEnergy = evalEnergy(polished);
  if (afterEnergy > evalEnergy(restarted) + 1e-6) {
    polished = restarted;
  } else {
    followLabels(polished, beforeLabels, polished);
  }
  session.state = polished;
  session.compiled = compiledOf(session);
  session.computed = buildComputedHandles(session);
  return layoutOf(session);
}

export function resampleSession(session: CoreSession): WireCompiled {
  session.state = resample(session.state);
  session.compiled = compiledOf(session);
  session.computed = buildComputedHandles(session);
  return session.compiled;
}
