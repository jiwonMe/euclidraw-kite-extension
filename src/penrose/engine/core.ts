/**
 * The real engine. This module is imported ONLY by the worker entry and by the
 * Node test engine; the extension's main chunk must keep `@penrose/core` out
 * (a second copy would blow the 5 MiB install budget).
 */
import { compileTrio, evalEnergy, insertPending, optimize, resample, stepTimes } from '@penrose/core';
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

export interface CoreSession {
  key: string;
  digest: string;
  state: PenroseState;
  compiled: WireCompiled;
  labels: Record<string, string>;
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
            values: (command.contents ?? []).map(part =>
              part.tag === 'CoordV' && Array.isArray(part.contents)
                ? (part.contents as number[])
                : typeof part.contents === 'number'
                  ? part.contents
                  : 0),
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
  return session;
}

export function layoutOf(session: CoreSession, varyingValues?: readonly number[]): WireLayout {
  const state = session.state;
  const values = varyingValues ? [...varyingValues] : state.varyingValues;
  const ownersByName = ownerMap(state);
  const shapes = (state.computeShapes(values) as unknown as AnyShape[]).map(shape => toWireShape(shape, ownersByName));
  const owners = new Set(ownersByName.values());
  return {
    digest: session.digest,
    shapes,
    canvas: canvasOf(state),
    varyingValues: values,
    owners: [...owners].sort(),
    interactivity: interactivityOf(state),
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
  return session.compiled;
}

/** Drag: move the given input indexes to absolute targets, step, then re-pin. */
export function dragSession(
  session: CoreSession,
  targets: readonly { index: number; value: number }[],
  steps: number,
): WireLayout {
  const values = [...session.state.varyingValues];
  for (const target of targets) {
    if (target.index >= 0 && target.index < values.length) values[target.index] = target.value;
  }
  session.state.varyingValues = values;
  const stepped = stepTimes(session.state, steps);
  if (stepped.isOk()) session.state = stepped.value;
  const pinned = [...session.state.varyingValues];
  for (const target of targets) {
    if (target.index >= 0 && target.index < pinned.length) pinned[target.index] = target.value;
  }
  session.state.varyingValues = pinned;
  return layoutOf(session, pinned);
}

export function resampleSession(session: CoreSession): WireCompiled {
  session.state = resample(session.state);
  session.compiled = compiledOf(session);
  return session.compiled;
}
