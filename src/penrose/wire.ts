/**
 * Plain-data shapes passed from the worker (Penrose) to the main thread.
 * The renderer and the computed graph never import `@penrose/core`, so the
 * engine ships once — inside the worker source string.
 */
export type Color = readonly [number, number, number, number];

export interface WirePathCommand {
  readonly cmd: string;
  /** `[x, y]` for `CoordV`, a number for `ValueV`. */
  readonly values: readonly (readonly number[] | number)[];
}

export type WireValue =
  | number
  | string
  | boolean
  | readonly number[]
  | readonly (readonly number[])[]
  | readonly WirePathCommand[]
  | Color
  | null;

export interface WireShape {
  readonly shapeType: string;
  readonly name: string;
  /** Substance object (or collection/namespace) this shape belongs to. */
  readonly owner?: string;
  readonly props: Readonly<Record<string, WireValue>>;
  readonly passthrough: Readonly<Record<string, WireValue>>;
  readonly children?: readonly WireShape[];
  readonly clip?: readonly WireShape[];
}

export interface WireCanvas {
  readonly width: number;
  readonly height: number;
}

/** Optimization inputs of one style path (indexes into `varyingValues`). */
export interface WireInputs {
  readonly path: string;
  /** Substance object that owns the shape; used to pin a member's inputs. */
  readonly owner?: string;
  readonly center?: readonly [number, number];
  readonly start?: readonly [number, number];
  readonly end?: readonly [number, number];
  readonly points?: readonly (readonly [number, number])[];
  readonly r?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface WireInteractivity {
  readonly translatable: readonly WireInputs[];
  readonly scalable: readonly WireInputs[];
}

export interface WireDiagnostic {
  readonly source: 'Domain' | 'Substance' | 'Style' | 'Runtime';
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface WireCompiled {
  readonly digest: string;
  readonly owners: readonly string[];
  readonly canvas: WireCanvas;
  readonly varyingValues: readonly number[];
  readonly optStages: readonly string[];
  readonly interactivity: WireInteractivity;
  readonly warnings: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly diagnostics: readonly WireDiagnostic[];
}

export interface WireLayout {
  readonly digest: string;
  readonly shapes: readonly WireShape[];
  readonly canvas: WireCanvas;
  readonly varyingValues: readonly number[];
  readonly owners: readonly string[];
  readonly interactivity: WireInteractivity;
  /** Pre-rendered MathJax SVG markup keyed by shape name (Equation shapes). */
  readonly labels: Readonly<Record<string, string>>;
  readonly energy: number;
  readonly stages: number;
}

export interface WireBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounds of every owner in Penrose canvas coordinates (origin center, y up). */
export type WireOwnerBounds = Readonly<Record<string, WireBounds>>;
