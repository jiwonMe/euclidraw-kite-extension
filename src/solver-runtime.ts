import { KITE_SOLVER_WASM_BASE64, KITE_SOLVER_WASM_SHA256 } from './generated/kite-solver-wasm.ts';
import { EXPRESSION_FUEL, type Expression } from './dsl/expr.ts';
import type { CompiledScope } from './dsl/compile.ts';

/**
 * The Wasm instance and its zero-copy views.
 *
 * One module instance per extension activation; one solver *slot* per Kite
 * scope. Typed-array views over `memory.buffer` are rebuilt whenever the buffer
 * object changes (memory.grow detaches the old one) — never cached across a
 * grow (AGENT.md §5). No strings or JSON cross into Wasm: the compiled tape,
 * constants and DOF values move as i32/f64 arrays.
 */

export const PRIM_STRIDE = 8;
const ABI_VERSION = 1;

interface Exports {
  memory: WebAssembly.Memory;
  kite_abi_version(): number;
  kite_alloc_tape(words: number): number;
  kite_alloc_consts(count: number): number;
  kite_alloc_params(count: number): number;
  kite_last_error(): number;
  kite_load(): number;
  kite_destroy(handle: number): void;
  kite_dof_count(handle: number): number;
  kite_constraint_count(handle: number): number;
  kite_row_count(handle: number): number;
  kite_prim_count(handle: number): number;
  kite_dof_state_ptr(handle: number): number;
  kite_world_prim_ptr(handle: number): number;
  kite_poly_vertex_ptr(handle: number): number;
  kite_poly_vertex_len(handle: number): number;
  kite_constraint_stress_ptr(handle: number): number;
  kite_set_frame(handle: number, cx: number, cy: number, scale: number, rotation: number, ox: number, oy: number, halfW: number, halfH: number): void;
  kite_set_damping(handle: number, damping: number): void;
  kite_clear_member_pins(handle: number): void;
  kite_fix_dof(handle: number, dof: number): void;
  kite_clear_pins(handle: number): void;
  kite_add_pin(handle: number, dof: number, isScalar: number, compliance: number): number;
  kite_set_pin_target(handle: number, slot: number, x: number, y: number): void;
  kite_step(handle: number, iterations: number): number;
  kite_project_manifold(handle: number, maxSweeps: number, tolerance: number): number;
  kite_initialize(handle: number, seedLo: number, seedHi: number, candidates: number, relax: number, polish: number): number;
  kite_energy(handle: number): number;
  kite_last_iterations(handle: number): number;
  kite_project(handle: number): number;
  kite_eval_expr(fuel: number): number;
  kite_set_unseeded(handle: number, off: number, isScalar: number, unseeded: number): void;
  kite_free_dof_count(handle: number): number;
  kite_jacobian_rank(handle: number): number;
}

let shared: { exports: Exports } | undefined;

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  const buffer = (globalThis as { Buffer?: { from(data: string, encoding: string): Uint8Array } }).Buffer;
  if (!buffer) throw new Error('Kite: base64 decoder unavailable.');
  return new Uint8Array(buffer.from(base64, 'base64'));
}

/**
 * The module is ~100 KB, over Chromium's 4 KB synchronous main-thread compile
 * limit, so it is always compiled asynchronously. Activation starts this; the
 * computed graph returns `undefined` (and the renderer a placeholder) until it
 * resolves, then invalidates.
 */
let loading: Promise<{ exports: Exports }> | undefined;
export function loadSolverModule(): Promise<{ exports: Exports }> {
  if (shared) return Promise.resolve(shared);
  loading ??= (async () => {
    if (typeof WebAssembly === 'undefined') throw new Error('Kite Studio requires WebAssembly.');
    const bytes = decodeBase64(KITE_SOLVER_WASM_BASE64);
    if (!WebAssembly.validate(bytes)) throw new Error('Kite: this browser cannot validate the solver module (WebAssembly SIMD is required).');
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports as unknown as Exports;
    if (exports.kite_abi_version() !== ABI_VERSION) throw new Error('Kite: solver ABI mismatch.');
    shared = { exports };
    return shared;
  })();
  loading.catch(() => { loading = undefined; });
  return loading;
}

export function solverReady(): boolean { return shared !== undefined; }
export function solverDigest(): string { return KITE_SOLVER_WASM_SHA256; }

/** Synchronous handle; throws if `loadSolverModule()` has not resolved yet. */
export function solverExports(): Exports {
  if (!shared) throw new Error('Kite solver is still loading.');
  return shared.exports;
}

/** Fuel-metered bytecode evaluation in Wasm (Style/Substance expressions). */
export function evaluateInVm(expression: Expression, values: readonly number[]): number {
  const wasm = solverExports();
  // Allocate first, then view: each allocation may grow (and detach) memory.
  const codePtr = wasm.kite_alloc_tape(expression.code.length);
  const constPtr = wasm.kite_alloc_consts(expression.consts.length);
  const paramPtr = wasm.kite_alloc_params(values.length);
  new Int32Array(wasm.memory.buffer, codePtr, expression.code.length).set(expression.code);
  new Float64Array(wasm.memory.buffer, constPtr, expression.consts.length).set(expression.consts);
  new Float64Array(wasm.memory.buffer, paramPtr, values.length).set(values);
  const value = wasm.kite_eval_expr(EXPRESSION_FUEL);
  const error = wasm.kite_last_error();
  if (error) throw new Error(['', '연료 초과', '스택 오류', '잘못된 피연산자', '값이 유한하지 않음', '알 수 없는 명령'][error - 100] ?? `VM 오류 ${error}`);
  return value;
}

export interface Frame {
  /** World centre of the scope box. */
  readonly cx: number;
  readonly cy: number;
  /** World units per local unit (uniform). */
  readonly scale: number;
  readonly rotation: number;
  /** Local point that maps to the centre, and the local half extents. */
  readonly ox: number;
  readonly oy: number;
  readonly halfW: number;
  readonly halfH: number;
}

/** One solver slot bound to one compiled topology. */
export class SolverInstance {
  readonly handle: number;
  private memory?: ArrayBufferLike;
  private dofView?: Float64Array;
  private primView?: Float64Array;
  private polyView?: Float64Array;
  private stressView?: Float32Array;
  private pinSlots = new Map<string, number>();
  private destroyed = false;

  constructor(readonly compiled: CompiledScope) {
    const wasm = solverExports();
    const tapePtr = wasm.kite_alloc_tape(compiled.tape.length);
    const constPtr = wasm.kite_alloc_consts(compiled.consts.length);
    new Int32Array(wasm.memory.buffer, tapePtr, compiled.tape.length).set(compiled.tape);
    new Float64Array(wasm.memory.buffer, constPtr, compiled.consts.length).set(compiled.consts);
    const handle = wasm.kite_load();
    if (handle < 0) throw new Error(`Kite: bytecode rejected (code ${wasm.kite_last_error()}).`);
    this.handle = handle;
  }

  private views(): void {
    const wasm = solverExports();
    if (this.memory === wasm.memory.buffer && this.dofView) return;
    this.memory = wasm.memory.buffer;
    const buffer = wasm.memory.buffer;
    this.dofView = new Float64Array(buffer, wasm.kite_dof_state_ptr(this.handle), wasm.kite_dof_count(this.handle));
    this.primView = new Float64Array(buffer, wasm.kite_world_prim_ptr(this.handle), wasm.kite_prim_count(this.handle) * PRIM_STRIDE);
    this.polyView = new Float64Array(buffer, wasm.kite_poly_vertex_ptr(this.handle), wasm.kite_poly_vertex_len(this.handle));
    this.stressView = new Float32Array(buffer, wasm.kite_constraint_stress_ptr(this.handle), wasm.kite_constraint_count(this.handle));
  }

  /** `dof_state_buf` (scope-local DOFs). Valid until the next Wasm call that may grow memory. */
  get dofs(): Float64Array { this.views(); return this.dofView!; }
  /** `world_prim_buf`: 8 floats per primitive. */
  get prims(): Float64Array { this.views(); return this.primView!; }
  get polyVertices(): Float64Array { this.views(); return this.polyView!; }
  /** `constraint_stress_buf`: normalised residual per constraint. */
  get stress(): Float32Array { this.views(); return this.stressView!; }

  setFrame(frame: Frame): void {
    solverExports().kite_set_frame(this.handle, frame.cx, frame.cy, frame.scale, frame.rotation, frame.ox, frame.oy, frame.halfW, frame.halfH);
  }
  setDamping(value: number): void { solverExports().kite_set_damping(this.handle, value); }
  setMemberPins(dofs: readonly number[]): void {
    const wasm = solverExports();
    wasm.kite_clear_member_pins(this.handle);
    for (const dof of dofs) wasm.kite_fix_dof(this.handle, dof);
  }
  markUnseeded(off: number, scalar: boolean, unseeded: boolean): void { solverExports().kite_set_unseeded(this.handle, off, scalar ? 1 : 0, unseeded ? 1 : 0); }
  writeDofs(values: ArrayLike<number>): void { this.dofs.set(values as ArrayLike<number>); }
  readDofs(): number[] { return Array.from(this.dofs); }

  clearPins(): void { solverExports().kite_clear_pins(this.handle); this.pinSlots.clear(); }
  addPin(key: string, dof: number, scalar: boolean, compliance: number): boolean {
    const slot = solverExports().kite_add_pin(this.handle, dof, scalar ? 1 : 0, compliance);
    if (slot < 0) return false;
    this.pinSlots.set(key, slot);
    return true;
  }
  setPinTarget(key: string, x: number, y: number): void {
    const slot = this.pinSlots.get(key);
    if (slot !== undefined) solverExports().kite_set_pin_target(this.handle, slot, x, y);
  }

  step(iterations: number): number { return solverExports().kite_step(this.handle, iterations); }
  /** Hard-constraint projection with the pointer springs suspended. */
  projectManifold(maxSweeps: number, tolerance = 1e-6): number { return solverExports().kite_project_manifold(this.handle, maxSweeps, tolerance); }
  initialize(seed: number, candidates: number, relax: number, polish: number): number {
    return solverExports().kite_initialize(this.handle, seed >>> 0, 0, candidates, relax, polish);
  }
  project(): number { return solverExports().kite_project(this.handle); }
  energy(): number { return solverExports().kite_energy(this.handle); }
  lastIterations(): number { return solverExports().kite_last_iterations(this.handle); }
  freeDofCount(): number { return solverExports().kite_free_dof_count(this.handle); }
  jacobianRank(): number { return solverExports().kite_jacobian_rank(this.handle); }
  rowCount(): number { return solverExports().kite_row_count(this.handle); }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (shared) shared.exports.kite_destroy(this.handle);
    this.memory = undefined;
  }
}

/** Bounded pool; least-recently-used slots are released. */
export class SolverPool {
  private readonly entries = new Map<string, SolverInstance>();
  constructor(private readonly limit = 64) {}
  get(key: string, compiled: CompiledScope): SolverInstance {
    let instance = this.entries.get(key);
    if (instance && instance.compiled !== compiled) { instance.dispose(); instance = undefined; this.entries.delete(key); }
    if (!instance) {
      instance = new SolverInstance(compiled);
      this.entries.set(key, instance);
      while (this.entries.size > this.limit) {
        const [oldest, value] = this.entries.entries().next().value as [string, SolverInstance];
        value.dispose(); this.entries.delete(oldest);
      }
    } else { this.entries.delete(key); this.entries.set(key, instance); }
    return instance;
  }
  release(key: string): void { const instance = this.entries.get(key); if (instance) { instance.dispose(); this.entries.delete(key); } }
  clear(): void { for (const instance of this.entries.values()) instance.dispose(); this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
