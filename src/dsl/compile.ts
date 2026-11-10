import type { EntityId } from '../host.ts';
import { isKitePrimitive, type KitePrimitiveKind, type KiteScopeAspect } from '../schema.ts';
import { parseExpression, type Expression } from './expr.ts';
import { finiteNumber, isIdent, sourceLines, splitTopLevel, unquote, type Diagnostic } from './lexer.ts';

/**
 * Domain · Substance · Style → constraint topology + Wasm bytecode tape.
 *
 * The result is plain JSON-like data (it is stored in a computed cell and
 * deep-frozen by the kernel). Expressions are never evaluated here: they are
 * emitted as VM bytecode and evaluated by the fuel-metered Wasm VM through the
 * `evaluate` callback, so document code never runs as JavaScript.
 */

// Bytecode — keep in sync with crate-kite-solver/src/vm.rs.
const MAGIC = 0x4b495445, VERSION = 1;
const OP_POINT = 1, OP_SCALAR = 2, OP_CONSTRAINT = 4, OP_PRIM = 5, OP_POLY = 6;
const FLAG_FIXED = 1;
export const CONSTRAINT_CODES = {
  Distance: 1, Coincident: 2, Midpoint: 3, OnCircle: 4, OnLine: 5, Perpendicular: 6, Parallel: 7,
  EqualLength: 8, Horizontal: 9, Vertical: 10, Tangent: 11, Radius: 12, AngleAt: 13,
} as const;
export type BuiltinPredicate = keyof typeof CONSTRAINT_CODES | 'Fixed';
export const BUILTIN_PREDICATES: readonly BuiltinPredicate[] = [...Object.keys(CONSTRAINT_CODES) as (keyof typeof CONSTRAINT_CODES)[], 'Fixed'];
const PRIM_CODES: Record<KitePrimitiveKind, number> = { point: 1, segment: 2, line: 3, ray: 4, circle: 5, arc: 6, polygon: 7, 'angle-mark': 8, 'label-anchor': 9 };
const ANCHOR_POINT = 1, ANCHOR_CENTER = 2, ANCHOR_MIDPOINT = 3, ANCHOR_POLYGON = 4, ANCHOR_BISECTOR = 5, ANCHOR_NORMAL = 0x100;

/** Argument kinds of each built-in; `line` accepts segment, line and ray. */
const SIGNATURES: Record<BuiltinPredicate, readonly ('point' | 'line' | 'circle' | 'number')[]> = {
  Distance: ['point', 'point', 'number'], Coincident: ['point', 'point'], Midpoint: ['point', 'point', 'point'],
  OnCircle: ['point', 'circle'], OnLine: ['point', 'line'], Perpendicular: ['line', 'line'], Parallel: ['line', 'line'],
  EqualLength: ['line', 'line'], Horizontal: ['line'], Vertical: ['line'], Tangent: ['line', 'circle'],
  Radius: ['circle', 'number'], AngleAt: ['point', 'point', 'point', 'number'], Fixed: ['point'],
};

export const DEFAULT_CANVAS = Object.freeze({ width: 520, height: 380 });
export const DEFAULT_SOFT_COMPLIANCE = 0.002;

export interface DomainType { readonly name: string; readonly shape?: KitePrimitiveKind; readonly parent?: string; readonly line: number }
export interface DomainPredicate { readonly name: string; readonly builtin: BuiltinPredicate; readonly args: readonly string[]; readonly line: number }
export interface DomainConstructor { readonly name: string; readonly builtin: BuiltinPredicate; readonly args: readonly string[]; readonly output: string; readonly line: number }

export type LabelAnchor =
  | { readonly kind: 'point'; readonly target: string }
  | { readonly kind: 'center'; readonly target: string }
  | { readonly kind: 'midpoint'; readonly target: string }
  | { readonly kind: 'bisector'; readonly target: string };

export interface Instance {
  readonly id: string;
  readonly type: string;
  readonly kind: KitePrimitiveKind;
  readonly line: number;
  /** Declared local coordinates; absent when the solver must place it. */
  readonly at?: readonly [number, number];
  readonly pinned?: boolean;
  readonly a?: string;
  readonly b?: string;
  readonly center?: string;
  readonly radius?: number;
  readonly through?: string;
  readonly startDeg?: number;
  readonly endDeg?: number;
  readonly vertices?: readonly string[];
  readonly angle?: readonly [string, string, string];
  readonly text?: string;
  readonly anchor?: LabelAnchor;
  /** Offset in local units: a vector, or a distance along the anchor normal. */
  readonly offset?: { readonly mode: 'vector'; readonly x: number; readonly y: number } | { readonly mode: 'normal'; readonly d: number };
  /** Render through markdown-card (MathJax) instead of an SVG `<text>`. */
  readonly card?: boolean;
}

export interface CompiledConstraint {
  readonly index: number;
  readonly predicate: BuiltinPredicate;
  readonly name: string;
  readonly args: readonly string[];
  readonly soft: boolean;
  readonly line: number;
  readonly text: string;
  readonly value: number;
  readonly compliance: number;
  /** Substance ids the constraint touches (for badges, stress and induced subgraphs). */
  readonly touches: readonly string[];
  readonly implicit: boolean;
}

export interface DofSlot {
  readonly substanceId: string;
  readonly kind: 'point' | 'scalar';
  readonly off: number;
  readonly declared: readonly number[];
  readonly fixed: boolean;
}

export interface Param { readonly name: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number; readonly line: number }

export type StyleValue = string | number | boolean;
export type StyleMap = Readonly<Record<string, StyleValue>>;

export interface CompiledScope {
  readonly key: string;
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly canvas: { readonly width: number; readonly height: number };
  readonly types: Readonly<Record<string, DomainType>>;
  readonly predicates: Readonly<Record<string, DomainPredicate>>;
  readonly constructors: Readonly<Record<string, DomainConstructor>>;
  readonly params: readonly Param[];
  readonly instances: Readonly<Record<string, Instance>>;
  readonly order: readonly string[];
  readonly dofs: readonly DofSlot[];
  readonly dofCount: number;
  readonly constraints: readonly CompiledConstraint[];
  /** Index of each substance id in `world_prim_buf`. */
  readonly primIndex: Readonly<Record<string, number>>;
  readonly tape: readonly number[];
  readonly consts: readonly number[];
  readonly styles: Readonly<Record<string, StyleMap>>;
  readonly bindings: Readonly<Record<string, EntityId>>;
}

/** Bytecode evaluation of an expression inside the fuel-metered Wasm VM. */
export type ExpressionEvaluator = (expression: Expression, values: readonly number[]) => number;

const BASE_STYLE: Record<KitePrimitiveKind, StyleMap> = {
  point: { r: 4.5, fill: '#2563eb', stroke: '#ffffff', width: 1.5, label: false, fontSize: 14 },
  segment: { stroke: '#475569', width: 2, fill: 'none', dash: 0, ticks: true },
  line: { stroke: '#64748b', width: 1.5, fill: 'none', dash: 0, arrows: true },
  ray: { stroke: '#64748b', width: 1.5, fill: 'none', dash: 0, arrows: true },
  circle: { stroke: '#94a3b8', width: 1.75, fill: 'none', dash: 0 },
  arc: { stroke: '#f59e0b', width: 1.75, fill: 'none', dash: 0 },
  polygon: { stroke: '#475569', width: 2, fill: 'none', fillOpacity: 0.12, dash: 0 },
  'angle-mark': { stroke: '#f59e0b', width: 1.5, fill: 'none', radius: 22, label: false, fontSize: 13 },
  'label-anchor': { fill: '#1e293b', fontSize: 15, fontWeight: 500, cardWidth: 120, cardHeight: 44 },
};

const LINE_KINDS: readonly KitePrimitiveKind[] = ['segment', 'line', 'ray'];

/** Unknown in-document data never reaches the solver as NaN. */
const safeNumber = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function scopeSourceKey(scope: Pick<KiteScopeAspect, 'domainDsl' | 'substanceDsl' | 'styleDsl' | 'entityBindings'>): string {
  const bindings = Object.entries(scope.entityBindings ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `${scope.domainDsl ?? ''}\u0000${scope.substanceDsl ?? ''}\u0000${scope.styleDsl ?? ''}\u0000${JSON.stringify(bindings)}`;
}

export function compileScope(scope: Pick<KiteScopeAspect, 'domainDsl' | 'substanceDsl' | 'styleDsl' | 'entityBindings'>, evaluate: ExpressionEvaluator): CompiledScope {
  const diagnostics: Diagnostic[] = [];
  const error = (source: Diagnostic['source'], line: number, message: string) => { diagnostics.push({ source, line, message }); };

  // ── Domain ──────────────────────────────────────────────────────────────
  const types: Record<string, DomainType> = {};
  const predicates: Record<string, DomainPredicate> = {};
  const constructors: Record<string, DomainConstructor> = {};
  for (const line of sourceLines(scope.domainDsl)) {
    let match = /^type\s+([A-Za-z_]\w*)(?:\s+shape\s+([a-z][\w-]*))?(?:\s+extends\s+([A-Za-z_]\w*))?$/.exec(line.text);
    if (match) {
      const [, name, shape, parent] = match;
      if (types[name!]) error('domain', line.number, `타입 ${name}이(가) 중복 선언되었습니다.`);
      if (shape && !isKitePrimitive(shape)) error('domain', line.number, `알 수 없는 shape: ${shape}`);
      types[name!] = { name: name!, ...(shape && isKitePrimitive(shape) ? { shape } : {}), ...(parent ? { parent } : {}), line: line.number };
      continue;
    }
    match = /^(predicate|constructor)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_]\w*)\s*)?(?:=\s*([A-Za-z_]\w*))?$/.exec(line.text);
    if (match) {
      const [, keyword, name, rawArgs, output, alias] = match;
      const args = rawArgs!.trim() ? rawArgs!.split(',').map(value => value.trim()) : [];
      const builtin = (alias ?? name) as BuiltinPredicate;
      if (!BUILTIN_PREDICATES.includes(builtin)) { error('domain', line.number, `${name}: 실행 가능한 기본 술어가 아닙니다. '= Perpendicular'처럼 기본 술어에 연결하세요.`); continue; }
      if (args.some(arg => !isIdent(arg))) { error('domain', line.number, `${name}: 인자는 타입 이름이어야 합니다.`); continue; }
      if (keyword === 'predicate') {
        if (output) { error('domain', line.number, 'predicate는 반환 타입을 가질 수 없습니다. constructor를 사용하세요.'); continue; }
        if (args.length !== SIGNATURES[builtin].length) error('domain', line.number, `${name}: ${builtin}은(는) 인자 ${SIGNATURES[builtin].length}개를 받습니다.`);
        predicates[name!] = { name: name!, builtin, args, line: line.number };
      } else {
        if (!output) { error('domain', line.number, `${name}: constructor는 '-> 타입'이 필요합니다.`); continue; }
        if (args.length + 1 !== SIGNATURES[builtin].length) error('domain', line.number, `${name}: 생성되는 개체가 ${builtin}의 첫 인자가 됩니다. 입력은 ${SIGNATURES[builtin].length - 1}개여야 합니다.`);
        constructors[name!] = { name: name!, builtin, args, output, line: line.number };
      }
      continue;
    }
    error('domain', line.number, `Domain 문법을 해석할 수 없습니다: ${line.text}`);
  }
  const shapeOf = (typeName: string): KitePrimitiveKind | undefined => {
    const seen = new Set<string>();
    for (let current = types[typeName]; current && !seen.has(current.name); current = current.parent ? types[current.parent] : undefined) {
      seen.add(current.name);
      if (current.shape) return current.shape;
    }
    return undefined;
  };
  const isSubtype = (typeName: string, expected: string): boolean => {
    const seen = new Set<string>();
    for (let current: string | undefined = typeName; current && !seen.has(current); current = types[current]?.parent) {
      if (current === expected) return true;
      seen.add(current);
    }
    return false;
  };
  if (!Object.keys(types).length) error('domain', 0, 'Domain DSL에 타입이 하나도 없습니다.');

  // ── Style (params first: Substance expressions may use them) ────────────
  const params: Param[] = [];
  const paramNames = new Set<string>();
  type RawRule = { selectors: string[]; body: string; line: number };
  const rules: RawRule[] = [];
  {
    const text = String(scope.styleDsl ?? '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    let pending: { selectors: string; line: number; body: string[] } | undefined;
    lines.forEach((raw, index) => {
      const number = index + 1;
      // `#` starts a comment only at line start or after whitespace and not before a hex colour.
      const stripped = raw.replace(/(^|\s)(\/\/.*$|#(?![0-9a-f]{3,8}\b).*$)/i, '').trim();
      if (!stripped) return;
      if (pending) {
        const close = stripped.indexOf('}');
        if (close < 0) { pending.body.push(stripped); return; }
        pending.body.push(stripped.slice(0, close));
        rules.push({ selectors: splitTopLevel(pending.selectors).filter(Boolean), body: pending.body.join(';'), line: pending.line });
        pending = undefined;
        if (stripped.slice(close + 1).trim()) error('style', number, `'}' 뒤의 텍스트를 해석할 수 없습니다.`);
        return;
      }
      const param = /^param\s+([A-Za-z_]\w*)\s*=\s*([^\s]+)(?:\s+range\s*\(\s*([^,)]+)\s*,\s*([^)]+)\))?(?:\s+step\s+([^\s]+))?$/.exec(stripped);
      if (param) {
        const [, name, rawValue, rawMin, rawMax, rawStep] = param;
        const value = finiteNumber(rawValue!);
        if (value === undefined) { error('style', number, `param ${name}의 값은 숫자여야 합니다.`); return; }
        if (paramNames.has(name!)) { error('style', number, `param ${name}이(가) 중복 선언되었습니다.`); return; }
        const min = rawMin === undefined ? Math.min(0, value * 2) : finiteNumber(rawMin);
        const max = rawMax === undefined ? Math.max(1, value * 2) : finiteNumber(rawMax);
        const step = rawStep === undefined ? Math.max(1e-4, Math.abs((max ?? 1) - (min ?? 0)) / 100) : finiteNumber(rawStep);
        if (min === undefined || max === undefined || step === undefined || !(min <= max) || !(step > 0)) { error('style', number, `param ${name}의 range/step이 올바르지 않습니다.`); return; }
        paramNames.add(name!);
        params.push({ name: name!, value: Math.min(max, Math.max(min, value)), min, max, step, line: number });
        return;
      }
      const open = stripped.indexOf('{');
      if (open < 0) { error('style', number, `Style 규칙을 해석할 수 없습니다: ${stripped}`); return; }
      const close = stripped.indexOf('}', open);
      if (close < 0) { pending = { selectors: stripped.slice(0, open), line: number, body: [stripped.slice(open + 1)] }; return; }
      rules.push({ selectors: splitTopLevel(stripped.slice(0, open)).filter(Boolean), body: stripped.slice(open + 1, close), line: number });
      if (stripped.slice(close + 1).trim()) error('style', number, `'}' 뒤의 텍스트를 해석할 수 없습니다.`);
    });
    if (pending) error('style', pending.line, '닫히지 않은 Style 규칙입니다.');
  }
  const paramValues = params.map(param => param.value);
  const paramIndex = new Map(params.map((param, index) => [param.name, index]));
  /** Compile then evaluate an expression in the Wasm VM. */
  const numeric = (source: string, where: Diagnostic['source'], line: number, label: string): number | undefined => {
    let expression: Expression;
    try { expression = parseExpression(source, paramNames); }
    catch (cause) { error(where, line, `${label}: ${(cause as Error).message}`); return undefined; }
    try { return evaluate(expression, expression.params.map(name => paramValues[paramIndex.get(name)!]!)); }
    catch (cause) { error(where, line, `${label}: ${(cause as Error).message}`); return undefined; }
  };
  const styleRules: { selectors: string[]; props: Record<string, StyleValue>; line: number }[] = [];
  for (const rule of rules) {
    const props: Record<string, StyleValue> = {};
    for (const declaration of splitTopLevel(rule.body, ';')) {
      if (!declaration) continue;
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(declaration);
      if (!pair) { error('style', rule.line, `Style 속성을 해석할 수 없습니다: ${declaration}`); continue; }
      const [, key, rawValue] = pair;
      const value = rawValue!.trim();
      const quoted = unquote(value);
      if (quoted !== undefined) props[key!] = quoted;
      else if (value === 'true' || value === 'false') props[key!] = value === 'true';
      else if (/^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z]+$/i.test(value) && !paramNames.has(value)) props[key!] = value;
      else {
        const number = numeric(value, 'style', rule.line, `${rule.selectors.join(', ')}.${key}`);
        if (number !== undefined) props[key!] = number;
      }
    }
    styleRules.push({ selectors: rule.selectors, props, line: rule.line });
  }
  const styleFor = (selectors: readonly string[]): Record<string, StyleValue> => {
    const merged: Record<string, StyleValue> = {};
    for (const rule of styleRules) if (rule.selectors.some(selector => selectors.includes(selector))) Object.assign(merged, rule.props);
    return merged;
  };

  // ── Substance ───────────────────────────────────────────────────────────
  const instances: Record<string, Instance> = {};
  const order: string[] = [];
  const raw: { name: string; args: string[]; soft: boolean; line: number; implicit: boolean }[] = [];
  const pins = new Set<string>();
  let canvas: { width: number; height: number } = { ...DEFAULT_CANVAS };
  const declare = (instance: Instance) => {
    if (instances[instance.id]) { error('substance', instance.line, `개체 ${instance.id}이(가) 중복 선언되었습니다.`); return; }
    instances[instance.id] = instance;
    order.push(instance.id);
  };
  for (const line of sourceLines(scope.substanceDsl)) {
    const text = line.text;
    let match = /^canvas\s+(\S+)\s+(\S+)$/.exec(text);
    if (match) {
      const width = finiteNumber(match[1]!), height = finiteNumber(match[2]!);
      if (!width || !height || width <= 0 || height <= 0 || width > 1e5 || height > 1e5) error('substance', line.number, 'canvas 크기는 양수여야 합니다.');
      else canvas = { width, height };
      continue;
    }
    match = /^(pin|unpin)\s+([A-Za-z_]\w*)$/.exec(text);
    if (match) { if (match[1] === 'pin') pins.add(match[2]!); else pins.delete(match[2]!); continue; }
    match = /^(soft\s+)?([A-Za-z_]\w*)\s*\((.*)\)$/.exec(text);
    if (match) { raw.push({ name: match[2]!, args: splitTopLevel(match[3]!), soft: Boolean(match[1]), line: line.number, implicit: false }); continue; }
    match = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/.exec(text);
    if (!match) { error('substance', line.number, `Substance 문법을 해석할 수 없습니다: ${text}`); continue; }
    const [, typeName, id, rhsRaw] = match;
    const kind = shapeOf(typeName!);
    if (!kind) { error('substance', line.number, `Domain에 없는 타입입니다: ${typeName}`); continue; }
    const rhs = (rhsRaw ?? '').trim();
    const base = { id: id!, type: typeName!, kind, line: line.number };
    const fail = (message: string) => error('substance', line.number, `${typeName} ${id}: ${message}`);
    const ctor = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(rhs);
    if (ctor && constructors[ctor[1]!]) {
      const definition = constructors[ctor[1]!]!;
      if (!isSubtype(typeName!, definition.output)) { fail(`${definition.name}은(는) ${definition.output}을(를) 만듭니다.`); continue; }
      const args = splitTopLevel(ctor[2]!);
      if (args.length !== definition.args.length) { fail(`${definition.name}은(는) 인자 ${definition.args.length}개가 필요합니다.`); continue; }
      declare({ ...base, ...(rhsRaw && /\spin$/.test(rhsRaw) ? { pinned: true } : {}) });
      raw.push({ name: definition.builtin, args: [id!, ...args], soft: false, line: line.number, implicit: true });
      continue;
    }
    if (kind === 'point') {
      const pin = /(^|\s)pin$/.test(rhs);
      const coords = rhs.replace(/(^|\s)pin$/, '').trim();
      if (!coords) { declare({ ...base, ...(pin ? { pinned: true } : {}) }); continue; }
      const pair = /^\(\s*([^,]+),\s*([^)]+)\)$/.exec(coords);
      const x = pair && numeric(pair[1]!, 'substance', line.number, `${id}.x`), y = pair && numeric(pair[2]!, 'substance', line.number, `${id}.y`);
      if (x === undefined || y === undefined || x === null || y === null) { if (!pair) fail('좌표는 (x, y) 형식이어야 합니다.'); continue; }
      declare({ ...base, at: [x, y], ...(pin ? { pinned: true } : {}) });
    } else if (LINE_KINDS.includes(kind)) {
      const pair = /^([A-Za-z_]\w*)\s*\.\.\s*([A-Za-z_]\w*)$/.exec(rhs);
      if (!pair) { fail('`A .. B` 형식이어야 합니다.'); continue; }
      declare({ ...base, a: pair[1]!, b: pair[2]! });
    } else if (kind === 'circle') {
      const centred = /^center\s+([A-Za-z_]\w*)(?:\s+(r|through)\s+(.+))?$/i.exec(rhs);
      if (!centred) { fail('`center M r 100`, `center M through B` 또는 `center M`이어야 합니다.'); continue; }
      if (centred[2]?.toLowerCase() === 'through') {
        if (!isIdent(centred[3]!.trim())) { fail('through 뒤에는 점 이름이 필요합니다.'); continue; }
        declare({ ...base, center: centred[1]!, through: centred[3]!.trim() });
        raw.push({ name: 'OnCircle', args: [centred[3]!.trim(), id!], soft: false, line: line.number, implicit: true });
      } else if (centred[2]) {
        const radius = numeric(centred[3]!, 'substance', line.number, `${id}.r`);
        if (radius === undefined) continue;
        if (!(radius > 0)) { fail('반지름은 양수여야 합니다.'); continue; }
        declare({ ...base, center: centred[1]!, radius });
      } else declare({ ...base, center: centred[1]! });
    } else if (kind === 'arc') {
      const arc = /^center\s+([A-Za-z_]\w*)\s+r\s+(\S+)\s+from\s+(\S+)\s+to\s+(\S+)$/i.exec(rhs);
      if (!arc) { fail('`center M r 90 from 0 to 180` 형식이어야 합니다.'); continue; }
      const radius = numeric(arc[2]!, 'substance', line.number, `${id}.r`);
      const start = numeric(arc[3]!, 'substance', line.number, `${id}.from`), end = numeric(arc[4]!, 'substance', line.number, `${id}.to`);
      if (radius === undefined || start === undefined || end === undefined) continue;
      if (!(radius > 0)) { fail('반지름은 양수여야 합니다.'); continue; }
      declare({ ...base, center: arc[1]!, radius, startDeg: start, endDeg: end });
    } else if (kind === 'polygon') {
      const vertices = rhs.split(/\s+/).filter(Boolean);
      if (vertices.length < 3 || !vertices.every(isIdent)) { fail('점 이름 세 개 이상이 필요합니다.'); continue; }
      declare({ ...base, vertices });
    } else if (kind === 'angle-mark') {
      const points = rhs.split(/\s+/).filter(Boolean);
      if (points.length !== 3 || !points.every(isIdent)) { fail('`A B C`(가운데가 꼭짓점) 형식이어야 합니다.'); continue; }
      declare({ ...base, angle: [points[0]!, points[1]!, points[2]!] });
    } else if (kind === 'label-anchor') {
      const label = /^(".*?(?<!\\)"|'.*?(?<!\\)')\s+at\s+(point|center|midpoint|bisector)\s+([A-Za-z_]\w*)(?:\s+(offset|normal)\s+(\([^)]*\)|\S+))?(\s+card)?$/i.exec(rhs);
      if (!label) { fail('`"텍스트" at midpoint AB normal 14 [card]` 형식이어야 합니다.'); continue; }
      const textValue = unquote(label[1]!) ?? '';
      if (!textValue) { fail('라벨 텍스트가 비어 있습니다.'); continue; }
      let offset: Instance['offset'] = { mode: 'normal', d: label[2]!.toLowerCase() === 'bisector' ? 26 : 12 };
      if (label[4]) {
        const value = label[5]!.trim();
        const vector = /^\(\s*([^,]+),\s*([^)]+)\)$/.exec(value);
        if (vector) {
          const x = numeric(vector[1]!, 'substance', line.number, `${id}.offset.x`), y = numeric(vector[2]!, 'substance', line.number, `${id}.offset.y`);
          if (x === undefined || y === undefined) continue;
          offset = { mode: 'vector', x, y };
        } else {
          const d = numeric(value, 'substance', line.number, `${id}.offset`);
          if (d === undefined) continue;
          offset = { mode: 'normal', d };
        }
      }
      declare({ ...base, text: textValue, anchor: { kind: label[2]!.toLowerCase() as LabelAnchor['kind'], target: label[3]! }, offset, ...(label[6] ? { card: true } : {}) });
    }
  }

  // Reference checks.
  const kindOf = (id: string | undefined) => id === undefined ? undefined : instances[id]?.kind;
  const expectKind = (owner: Instance, ref: string | undefined, kinds: readonly KitePrimitiveKind[], what: string) => {
    if (ref === undefined) return;
    const kind = kindOf(ref);
    if (!kind) error('substance', owner.line, `${owner.id}: ${ref} 개체를 찾을 수 없습니다.`);
    else if (!kinds.includes(kind)) error('substance', owner.line, `${owner.id}: ${ref}은(는) ${what}이(가) 아닙니다.`);
  };
  for (const id of order) {
    const instance = instances[id]!;
    expectKind(instance, instance.a, ['point'], '점');
    expectKind(instance, instance.b, ['point'], '점');
    expectKind(instance, instance.center, ['point'], '점');
    expectKind(instance, instance.through, ['point'], '점');
    for (const vertex of instance.vertices ?? []) expectKind(instance, vertex, ['point'], '점');
    for (const vertex of instance.angle ?? []) expectKind(instance, vertex, ['point'], '점');
    if (instance.anchor) {
      const allowed: Record<LabelAnchor['kind'], readonly KitePrimitiveKind[]> = { point: ['point'], center: ['circle', 'arc', 'polygon'], midpoint: LINE_KINDS, bisector: ['angle-mark'] };
      expectKind(instance, instance.anchor.target, allowed[instance.anchor.kind], `${instance.anchor.kind} 앵커 대상`);
    }
  }
  for (const id of pins) if (kindOf(id) !== 'point') error('substance', 0, `pin ${id}: 점이 아닙니다.`);

  // ── DOF layout ──────────────────────────────────────────────────────────
  const dofs: DofSlot[] = [];
  const pointOff: Record<string, number> = {};
  const scalarOff: Record<string, number> = {};
  let dofCount = 0;
  for (const id of order) {
    const instance = instances[id]!;
    if (instance.kind === 'point') {
      pointOff[id] = dofCount;
      dofs.push({ substanceId: id, kind: 'point', off: dofCount, declared: instance.at ? [...instance.at] : [], fixed: Boolean(instance.pinned) || pins.has(id) });
      dofCount += 2;
    } else if (instance.kind === 'circle' || instance.kind === 'arc') {
      scalarOff[id] = dofCount;
      let declared: number[] = instance.radius !== undefined ? [instance.radius] : [];
      const c = instance.center ? instances[instance.center]?.at : undefined, t = instance.through ? instances[instance.through]?.at : undefined;
      if (!declared.length && c && t) declared = [Math.hypot(t[0] - c[0], t[1] - c[1])];
      dofs.push({ substanceId: id, kind: 'scalar', off: dofCount, declared, fixed: instance.kind === 'arc' });
      dofCount += 1;
    }
  }

  // ── Constraints ─────────────────────────────────────────────────────────
  const consts: number[] = [];
  const constant = (value: number) => { consts.push(value); return consts.length - 1; };
  const constraints: CompiledConstraint[] = [];
  const fixedPoints = new Set<string>([...pins]);
  const records: number[] = [];
  let recordCount = 0;
  const lineEnds = (id: string) => { const instance = instances[id]!; return [instance.a!, instance.b!] as const; };
  const softDefaults = styleFor(['@soft']);
  for (const entry of raw) {
    const domain = predicates[entry.name];
    const builtin = (domain?.builtin ?? entry.name) as BuiltinPredicate;
    const text = `${entry.soft ? 'soft ' : ''}${entry.name}(${entry.args.join(', ')})`;
    const fail = (message: string) => error('substance', entry.line, `${text}: ${message}`);
    if (!BUILTIN_PREDICATES.includes(builtin)) { fail('Domain에 선언되지 않은 술어입니다.'); continue; }
    const signature = SIGNATURES[builtin];
    if (entry.args.length !== signature.length) { fail(`인자 ${signature.length}개가 필요합니다.`); continue; }
    let ok = true, value = 0;
    const touches: string[] = [];
    signature.forEach((expected, index) => {
      const arg = entry.args[index]!;
      if (expected === 'number') {
        const number = numeric(arg, 'substance', entry.line, `${entry.name} 인자 ${index + 1}`);
        if (number === undefined) ok = false; else value = number;
        return;
      }
      const instance = instances[arg];
      const kinds = expected === 'line' ? LINE_KINDS : expected === 'circle' ? ['circle'] as const : ['point'] as const;
      if (!instance) { fail(`${arg} 개체를 찾을 수 없습니다.`); ok = false; return; }
      if (!kinds.includes(instance.kind)) { fail(`${arg}의 종류(${instance.kind})가 맞지 않습니다.`); ok = false; return; }
      const typed = domain?.args[index];
      if (typed && !isSubtype(instance.type, typed)) { fail(`${arg}은(는) ${typed} 타입이 아닙니다.`); ok = false; return; }
      touches.push(arg);
    });
    if (!ok) continue;
    if (builtin === 'Fixed') { fixedPoints.add(entry.args[0]!); continue; }
    const style = { ...softDefaults, ...styleFor([`@${entry.name}`, `@${builtin}`]) };
    const compliance = entry.soft ? safeNumber(Number(style.compliance ?? DEFAULT_SOFT_COMPLIANCE), DEFAULT_SOFT_COMPLIANCE) : 0;
    if (builtin === 'AngleAt') value = value * Math.PI / 180;
    if ((builtin === 'Distance' || builtin === 'Radius') && !(value >= 0)) { fail('거리/반지름은 0 이상이어야 합니다.'); continue; }
    const P = (id: string) => pointOff[id]!;
    const C = (id: string) => pointOff[instances[id]!.center!] ?? -1;
    let refs: number[] = [-1, -1, -1, -1], scalar = -1;
    const [a0, a1, a2] = entry.args as [string, string, string];
    switch (builtin) {
      case 'Distance': case 'Coincident': refs = [P(a0), P(a1), -1, -1]; break;
      case 'Midpoint': refs = [P(a0), P(a1), P(a2), -1]; break;
      case 'OnCircle': refs = [P(a0), C(a1), -1, -1]; scalar = scalarOff[a1]!; break;
      case 'OnLine': { const [p, q] = lineEnds(a1); refs = [P(a0), P(p), P(q), -1]; break; }
      case 'Perpendicular': case 'Parallel': case 'EqualLength': { const [p, q] = lineEnds(a0), [r, s] = lineEnds(a1); refs = [P(p), P(q), P(r), P(s)]; break; }
      case 'Horizontal': case 'Vertical': { const [p, q] = lineEnds(a0); refs = [P(p), P(q), -1, -1]; break; }
      case 'Tangent': { const [p, q] = lineEnds(a0); refs = [P(p), P(q), C(a1), -1]; scalar = scalarOff[a1]!; break; }
      case 'Radius': scalar = scalarOff[a0]!; break;
      case 'AngleAt': refs = [P(a0), P(a1), P(a2), -1]; break;
    }
    if (refs.some(ref => Number.isNaN(ref)) || [refs[0], refs[1], refs[2], refs[3]].some(ref => ref === undefined)) { fail('참조 오프셋을 만들 수 없습니다.'); continue; }
    const extended = new Set(touches);
    for (const id of touches) { const instance = instances[id]!; for (const end of [instance.a, instance.b, instance.center]) if (end) extended.add(end); }
    constraints.push({ index: constraints.length, predicate: builtin, name: entry.name, args: entry.args, soft: entry.soft, line: entry.line, text, value, compliance, touches: [...extended], implicit: entry.implicit });
    records.push(OP_CONSTRAINT, CONSTRAINT_CODES[builtin as keyof typeof CONSTRAINT_CODES], entry.soft ? 1 : 0, refs[0]!, refs[1]!, refs[2]!, refs[3]!, scalar, constant(value), constant(compliance));
    recordCount++;
  }

  // ── Tape: DOFs, primitives ──────────────────────────────────────────────
  const head: number[] = [];
  for (const slot of dofs) {
    const fixed = slot.kind === 'point' ? fixedPoints.has(slot.substanceId) || slot.fixed : slot.fixed;
    head.push(slot.kind === 'point' ? OP_POINT : OP_SCALAR, slot.off, fixed ? FLAG_FIXED : 0);
    recordCount++;
  }
  const finalDofs = dofs.map(slot => slot.kind === 'point' ? { ...slot, fixed: fixedPoints.has(slot.substanceId) || slot.fixed } : slot);
  const prims: number[] = [];
  const primIndex: Record<string, number> = {};
  let primCount = 0;
  const P = (id: string | undefined) => id !== undefined && pointOff[id] !== undefined ? pointOff[id]! : -1;
  const styles: Record<string, StyleMap> = {};
  for (const id of order) {
    const instance = instances[id]!;
    styles[id] = Object.freeze({ ...BASE_STYLE[instance.kind], ...styleFor([instance.kind, instance.type, id]) });
    const code = PRIM_CODES[instance.kind];
    if (instance.kind === 'polygon') {
      const offs = instance.vertices!.map(P);
      if (offs.some(off => off < 0)) continue;
      prims.push(OP_POLY, offs.length, ...offs);
    } else {
      let refs: number[] = [-1, -1, -1], scalar = -1, a = -1, b = -1, anchor = 0, tail: number[] = [];
      switch (instance.kind) {
        case 'point': refs = [P(id), -1, -1]; break;
        case 'segment': case 'line': case 'ray': refs = [P(instance.a), P(instance.b), -1]; break;
        case 'circle': refs = [P(instance.center), -1, -1]; scalar = scalarOff[id]!; break;
        case 'arc': refs = [P(instance.center), -1, -1]; scalar = scalarOff[id]!; a = constant((instance.startDeg ?? 0) * Math.PI / 180); b = constant((instance.endDeg ?? 180) * Math.PI / 180); break;
        case 'angle-mark': refs = instance.angle!.length === 3 ? [P(instance.angle![1]), P(instance.angle![0]), P(instance.angle![2])] : [-1, -1, -1]; break;
        case 'label-anchor': {
          const target = instances[instance.anchor!.target];
          if (!target) continue;
          if (instance.anchor!.kind === 'point') { refs = [P(target.id), -1, -1]; anchor = ANCHOR_POINT; }
          else if (instance.anchor!.kind === 'midpoint') { refs = [P(target.a), P(target.b), -1]; anchor = ANCHOR_MIDPOINT; }
          else if (instance.anchor!.kind === 'bisector') { const [x, v, y] = target.angle ?? []; refs = [P(v), P(x), P(y)]; anchor = ANCHOR_BISECTOR; }
          else if (target.kind === 'polygon') { const offs = target.vertices!.map(P); anchor = ANCHOR_POLYGON; tail = [offs.length, ...offs]; refs = [offs[0] ?? -1, -1, -1]; }
          else { refs = [P(target.center), -1, -1]; anchor = ANCHOR_CENTER; }
          if (instance.offset?.mode === 'normal') anchor |= ANCHOR_NORMAL;
          break;
        }
        default: break;
      }
      const needed = instance.kind === 'segment' || instance.kind === 'line' || instance.kind === 'ray' ? 2 : instance.kind === 'angle-mark' ? 3 : 1;
      if (refs.slice(0, needed).some(ref => ref < 0) || (instance.kind === 'label-anchor' && anchor === 0)) continue;
      if (instance.kind === 'label-anchor' && (anchor & 0xff) === ANCHOR_MIDPOINT && refs[1]! < 0) continue;
      if (instance.kind === 'label-anchor' && (anchor & 0xff) === ANCHOR_BISECTOR && refs.some(ref => ref < 0)) continue;
      prims.push(OP_PRIM, code, refs[0]!, refs[1]!, refs[2]!, scalar, a, b, anchor, ...tail);
    }
    primIndex[id] = primCount++;
    recordCount++;
  }

  const tape = [MAGIC, VERSION, dofCount, recordCount, ...head, ...records, ...prims];
  return {
    key: scopeSourceKey(scope),
    ok: diagnostics.length === 0,
    diagnostics,
    canvas,
    types, predicates, constructors,
    params,
    instances,
    order,
    dofs: finalDofs,
    dofCount,
    constraints,
    primIndex,
    tape,
    consts,
    styles,
    bindings: { ...(scope.entityBindings ?? {}) },
  };
}

/** The declared local start value for each DOF (seeds absent). */
export function declaredDofValues(compiled: CompiledScope): number[] {
  const values = new Array<number>(compiled.dofCount).fill(0);
  const hash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h; };
  const point = (id: string, depth = 0): [number, number] => {
    const instance = compiled.instances[id];
    if (instance?.at) return [instance.at[0], instance.at[1]];
    if (depth < 8) {
      const made = compiled.constraints.find(constraint => constraint.implicit && constraint.args[0] === id);
      if (made?.predicate === 'Midpoint') { const a = point(made.args[1]!, depth + 1), b = point(made.args[2]!, depth + 1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      if (made?.predicate === 'OnCircle') {
        const circle = compiled.instances[made.args[1]!];
        if (circle?.center) { const c = point(circle.center, depth + 1); return [c[0] + (circle.radius ?? compiled.canvas.width / 5), c[1]]; }
      }
    }
    const h = hash(id);
    return [compiled.canvas.width * (0.3 + 0.4 * ((h & 0xffff) / 0xffff)), compiled.canvas.height * (0.3 + 0.4 * ((h >>> 16) / 0xffff))];
  };
  for (const slot of compiled.dofs) {
    if (slot.kind === 'point') { const [x, y] = point(slot.substanceId); values[slot.off] = x; values[slot.off + 1] = y; }
    else {
      const instance = compiled.instances[slot.substanceId]!;
      let radius = slot.declared[0];
      if (radius === undefined && instance.center && instance.through) { const c = point(instance.center), t = point(instance.through); radius = Math.hypot(t[0] - c[0], t[1] - c[1]); }
      values[slot.off] = radius !== undefined && radius > 0 ? radius : Math.min(compiled.canvas.width, compiled.canvas.height) / 4;
    }
  }
  return values;
}
