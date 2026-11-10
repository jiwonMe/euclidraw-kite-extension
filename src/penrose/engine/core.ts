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
  const children = Array.isArray(shape.shapes)
    ? (shape.shapes as AnyValue[]).flatMap(entry => {
        const list = entry.contents;
        return Array.isArray(list) ? (list as AnyShape[]).map(child => toWireShape(child, owners)) : [];
      })
    : undefined;
  const clipEntry = shape.clipPath as { contents?: { tag?: string; contents?: unknown } } | undefined;
  const clip = clipEntry?.contents?.tag === 'Clip' && Array.isArray(clipEntry.contents.contents)
    ? (clipEntry.contents.contents as AnyShape[]).map(child => toWireShape(child, owners))
    : undefined;
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
    if (Array.isArray(shape.shapes)) {
      for (const entry of shape.shapes as AnyValue[]) {
        if (Array.isArray(entry.contents)) flattenShapes(entry.contents as AnyShape[], out);
      }
    }
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

const MAX_COMPUTED_INPUTS = 96;
const MAX_COMPUTED_HANDLES = 160;

function shapesByName(shapes: readonly AnyShape[], out = new Map<string, AnyShape>()): Map<string, AnyShape> {
  for (const shape of shapes) {
    const name = shape.name?.contents;
    if (name) out.set(name, shape);
    if (Array.isArray(shape.shapes)) {
      for (const entry of shape.shapes as AnyValue[]) {
        if (Array.isArray(entry.contents)) shapesByName(entry.contents as AnyShape[], out);
      }
    }
  }
  return out;
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
          if (Array.isArray(shape.shapes)) {
            for (const entry of shape.shapes as AnyValue[]) {
              if (Array.isArray(entry.contents)) visit(entry.contents as AnyShape[]);
            }
          }
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
    const viewBox = /viewBox="([^"]+)"/.exec(markup);
    if (!viewBox) return undefined;
    const parts = viewBox[1]!.trim().split(/\s+/).map(Number);
    const widthEm = (parts[2] ?? 0) / 1000;
    const heightEm = (parts[3] ?? 0) / 1000;
    const size = parseFontSize(fontSize, 16);
    const height = heightEm * size;
    const width = widthEm * size;
    const svg = markup
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
      if (Array.isArray(shape.shapes)) {
        for (const entry of shape.shapes as AnyValue[]) {
          if (Array.isArray(entry.contents)) visit(entry.contents as AnyShape[]);
        }
      }
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
    const point = pointOf(rawByName.get(handle.shape), handle.field, handle.index);
    if (!point) continue;
    computed.push({
      id: handle.id,
      shape: handle.shape,
      field: handle.field,
      index: handle.index,
      ...(handle.owner ? { owner: handle.owner } : {}),
      x: point[0],
      y: point[1],
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
    stages: state.currentStageIndex,
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
  session.state = state;
  return layoutOf(session);
}

/**
 * One drag frame. The previous optimizer state ends at `EPConverged`, where
 * `step` is a no-op; because a drag changes `varyingValues` directly, we must
 * restart the optimizer (keeping the warm-start values and penalty weight) or
 * every frame after the first would skip convergence.
 */
function settleForDrag(state: PenroseState, steps: number, budgetMs = 0): PenroseState {
  // Very high EP weights make L-BFGS' preconditioned convergence check stall
  // before it takes a step (labels then look frozen). A moderate weight still
  // pulls constraints while keeping the optimizer moving.
  const DRAG_WEIGHT = 1e5;
  const params = {
    ...start(state.varyingValues.length),
    weight: Math.min(state.params.weight, DRAG_WEIGHT),
  } as PenroseState['params'];
  const restarted: PenroseState = { ...state, params };
  if (budgetMs > 0) {
    const started = performance.now();
    try {
      const stepped = step(restarted, { until: () => performance.now() - started >= budgetMs });
      return stepped.isOk() ? stepped.value : restarted;
    } catch {
      return restarted;
    }
  }
  const stepped = stepTimes(restarted, steps);
  return stepped.isOk() ? stepped.value : restarted;
}

/** Drag: move the given input indexes to absolute targets, converge, then re-pin. */
export function dragSession(
  session: CoreSession,
  targets: readonly { index: number; value: number }[],
  steps: number,
  budgetMs = 0,
): WireLayout {
  const values = [...session.state.varyingValues];
  for (const target of targets) {
    if (target.index >= 0 && target.index < values.length) values[target.index] = target.value;
  }
  const deadline = performance.now() + Math.max(0, budgetMs);
  let state: PenroseState = { ...session.state, varyingValues: values };
  // Alternate converge and re-pin: pinning after a converged step leaves the
  // rest of the diagram at the pre-pin solution, so run a second round inside
  // the same frame budget.
  const rounds = budgetMs > 0 ? 2 : 1;
  for (let round = 0; round < rounds; round++) {
    const remaining = budgetMs > 0 ? Math.max(1, deadline - performance.now()) : 0;
    state = settleForDrag(state, steps, remaining);
    const pinned = [...state.varyingValues];
    for (const target of targets) {
      if (target.index >= 0 && target.index < pinned.length) pinned[target.index] = target.value;
    }
    state = { ...state, varyingValues: pinned };
  }
  session.state = state;
  return layoutOf(session);
}

export function resampleSession(session: CoreSession): WireCompiled {
  session.state = resample(session.state);
  session.compiled = compiledOf(session);
  session.computed = buildComputedHandles(session);
  return session.compiled;
}
