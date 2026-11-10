//! Kite Studio solver: a standalone Wasm module owned by the extension.
//!
//! The FFI is a plain C ABI over integers, floats and pointers into linear
//! memory — no strings and no JSON cross the boundary on the hot path.
//! JavaScript writes the compiled tape and constants into buffers obtained from
//! `kite_alloc_*`, calls `kite_load`, then reads the fixed-layout views
//! described in [`memory_view`].
//!
//! Instances are slots in a small table; one Kite scope owns one slot.

pub mod discrete_init;
pub mod memory_view;
pub mod simd;
pub mod vm;
pub mod xpbd_manifold;

use memory_view::{Frame, Views};
use xpbd_manifold::{PinTarget, Solver, MAX_PINS};

struct Instance {
    solver: Solver,
    views: Views,
    frame: Frame,
    extra_fixed: Vec<usize>,
}

struct Scratch {
    tape: Vec<i32>,
    consts: Vec<f64>,
    params: Vec<f64>,
}

static mut INSTANCES: Vec<Option<Instance>> = Vec::new();
static mut SCRATCH: Scratch = Scratch { tape: Vec::new(), consts: Vec::new(), params: Vec::new() };
static mut LAST_ERROR: i32 = 0;

#[allow(static_mut_refs)]
fn instances() -> &'static mut Vec<Option<Instance>> { unsafe { &mut INSTANCES } }
#[allow(static_mut_refs)]
fn scratch() -> &'static mut Scratch { unsafe { &mut SCRATCH } }
fn set_error(code: i32) { unsafe { LAST_ERROR = code; } }

fn instance(handle: i32) -> Option<&'static mut Instance> {
    if handle < 0 { return None; }
    instances().get_mut(handle as usize).and_then(|slot| slot.as_mut())
}

// ── staging buffers ───────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn kite_alloc_tape(words: u32) -> *mut i32 {
    let s = scratch();
    s.tape.clear();
    s.tape.resize(words as usize, 0);
    s.tape.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn kite_alloc_consts(count: u32) -> *mut f64 {
    let s = scratch();
    s.consts.clear();
    s.consts.resize(count as usize, 0.0);
    s.consts.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn kite_alloc_params(count: u32) -> *mut f64 {
    let s = scratch();
    s.params.clear();
    s.params.resize(count as usize, 0.0);
    s.params.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn kite_last_error() -> i32 { unsafe { LAST_ERROR } }

#[no_mangle]
pub extern "C" fn kite_abi_version() -> i32 { 1 }

// ── lifecycle ─────────────────────────────────────────────────────────────

/// Load the staged tape. Returns a handle (≥ 0) or −1 (see `kite_last_error`).
#[no_mangle]
pub extern "C" fn kite_load() -> i32 {
    let s = scratch();
    let topology = match vm::load(&s.tape, &s.consts) {
        Ok(topology) => topology,
        Err(error) => { set_error(error as i32); return -1; }
    };
    let solver = Solver::new(topology);
    let views = Views::new(&solver);
    let created = Instance { solver, views, frame: Frame { cx: 0.0, cy: 0.0, scale: 1.0, rotation: 0.0, ox: 0.0, oy: 0.0, half_w: 1.0, half_h: 1.0 }, extra_fixed: Vec::new() };
    let table = instances();
    let handle = match table.iter().position(|slot| slot.is_none()) {
        Some(index) => { table[index] = Some(created); index }
        None => { table.push(Some(created)); table.len() - 1 }
    };
    set_error(0);
    handle as i32
}

#[no_mangle]
pub extern "C" fn kite_destroy(handle: i32) {
    if handle >= 0 {
        if let Some(slot) = instances().get_mut(handle as usize) { *slot = None; }
    }
}

#[no_mangle]
pub extern "C" fn kite_dof_count(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.topology.dof_count as u32) }
#[no_mangle]
pub extern "C" fn kite_constraint_count(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.topology.constraints.len() as u32) }
#[no_mangle]
pub extern "C" fn kite_row_count(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.topology.row_count as u32) }
#[no_mangle]
pub extern "C" fn kite_prim_count(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.topology.prims.len() as u32) }

// ── zero-copy views ───────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn kite_dof_state_ptr(handle: i32) -> *mut f64 { instance(handle).map_or(core::ptr::null_mut(), |i| i.solver.x.as_mut_ptr()) }
#[no_mangle]
pub extern "C" fn kite_world_prim_ptr(handle: i32) -> *const f64 { instance(handle).map_or(core::ptr::null(), |i| i.views.prim.as_ptr()) }
#[no_mangle]
pub extern "C" fn kite_poly_vertex_ptr(handle: i32) -> *const f64 { instance(handle).map_or(core::ptr::null(), |i| i.views.poly.as_ptr()) }
#[no_mangle]
pub extern "C" fn kite_poly_vertex_len(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.views.poly.len() as u32) }
#[no_mangle]
pub extern "C" fn kite_constraint_stress_ptr(handle: i32) -> *const f32 { instance(handle).map_or(core::ptr::null(), |i| i.views.stress.as_ptr()) }

// ── configuration ─────────────────────────────────────────────────────────

/// Local→world similarity: centre (cx, cy), uniform scale, rotation, local
/// origin (ox, oy) and the box half extents in local units.
#[no_mangle]
pub extern "C" fn kite_set_frame(handle: i32, cx: f64, cy: f64, scale: f64, rotation: f64, ox: f64, oy: f64, half_w: f64, half_h: f64) {
    if let Some(i) = instance(handle) {
        let safe = |v: f64, d: f64| if v.is_finite() { v } else { d };
        i.frame = Frame { cx: safe(cx, 0.0), cy: safe(cy, 0.0), scale: safe(scale, 1.0).max(1e-9), rotation: safe(rotation, 0.0), ox: safe(ox, 0.0), oy: safe(oy, 0.0), half_w: safe(half_w, 1.0).max(1e-9), half_h: safe(half_h, 1.0).max(1e-9) };
    }
}

#[no_mangle]
pub extern "C" fn kite_set_damping(handle: i32, damping: f64) {
    if let Some(i) = instance(handle) { i.solver.damping = if damping.is_finite() { damping.clamp(0.1, 1.0) } else { 1.0 }; }
}

/// Clear member-level pinned DOFs (`kite.member.pinnedDofs`).
#[no_mangle]
pub extern "C" fn kite_clear_member_pins(handle: i32) {
    if let Some(i) = instance(handle) { i.extra_fixed.clear(); let extra = i.extra_fixed.clone(); i.solver.reset_masses(&extra); }
}

#[no_mangle]
pub extern "C" fn kite_fix_dof(handle: i32, dof: i32) {
    if let Some(i) = instance(handle) {
        if dof >= 0 && (dof as usize) < i.solver.x.len() { i.extra_fixed.push(dof as usize); }
        let extra = i.extra_fixed.clone();
        i.solver.reset_masses(&extra);
    }
}

// ── pointer springs (soft pins / slack constraints) ───────────────────────

#[no_mangle]
pub extern "C" fn kite_clear_pins(handle: i32) { if let Some(i) = instance(handle) { i.solver.pin_count = 0; } }

/// Returns the pin slot or −1 when the table is full.
#[no_mangle]
pub extern "C" fn kite_add_pin(handle: i32, dof: i32, is_scalar: i32, compliance: f64) -> i32 {
    let Some(i) = instance(handle) else { return -1 };
    if i.solver.pin_count >= MAX_PINS || dof < 0 || (dof as usize) >= i.solver.x.len() { return -1; }
    if is_scalar == 0 && (dof as usize) + 1 >= i.solver.x.len() { return -1; }
    let slot = i.solver.pin_count;
    let (x, y) = if is_scalar != 0 { (i.solver.x[dof as usize], 0.0) } else { (i.solver.x[dof as usize], i.solver.x[dof as usize + 1]) };
    i.solver.pins[slot] = PinTarget { dof, is_scalar: is_scalar != 0, x, y, compliance: if compliance.is_finite() { compliance.max(0.0) } else { 1e-3 } };
    i.solver.pin_count += 1;
    slot as i32
}

#[no_mangle]
pub extern "C" fn kite_set_pin_target(handle: i32, slot: i32, x: f64, y: f64) {
    if let Some(i) = instance(handle) {
        if slot >= 0 && (slot as usize) < i.solver.pin_count && x.is_finite() && y.is_finite() {
            let pin = &mut i.solver.pins[slot as usize];
            pin.x = x; pin.y = y;
        }
    }
}

// ── solving ───────────────────────────────────────────────────────────────

/// Substeps of XPBD + manifold projection; returns the max hard residual.
#[no_mangle]
pub extern "C" fn kite_step(handle: i32, iterations: u32) -> f64 {
    instance(handle).map_or(f64::NAN, |i| i.solver.solve(iterations.min(10_000)))
}

/// Discrete initial placement for unseeded DOFs, then a warm-started polish.
#[no_mangle]
pub extern "C" fn kite_initialize(handle: i32, seed_lo: u32, seed_hi: u32, candidates: u32, relax: u32, polish: u32) -> f64 {
    let Some(i) = instance(handle) else { return f64::NAN };
    let seed = ((seed_hi as u64) << 32) | seed_lo as u64;
    let extent = (i.frame.ox, i.frame.oy, i.frame.half_w, i.frame.half_h);
    let report = discrete_init::place(&mut i.solver, seed, candidates.min(64), relax.min(2000), polish.min(10_000), extent);
    report.best_energy
}

/// Hard-constraint projection with the pointer springs suspended.
#[no_mangle]
pub extern "C" fn kite_project_manifold(handle: i32, max_sweeps: u32, tolerance: f64) -> f64 {
    let tolerance = if tolerance.is_finite() && tolerance > 0.0 { tolerance } else { 1e-6 };
    instance(handle).map_or(f64::NAN, |i| i.solver.project_manifold(max_sweeps.min(100_000), tolerance))
}

#[no_mangle]
pub extern "C" fn kite_energy(handle: i32) -> f64 { instance(handle).map_or(f64::NAN, |i| i.solver.energy()) }

/// Mark a point (`is_scalar` = 0) or scalar DOF as having no persisted seed.
#[no_mangle]
pub extern "C" fn kite_set_unseeded(handle: i32, off: i32, is_scalar: i32, unseeded: i32) {
    let Some(i) = instance(handle) else { return };
    if is_scalar != 0 {
        for scalar in i.solver.topology.scalars.iter_mut() { if scalar.off as i32 == off { scalar.unseeded = unseeded != 0; } }
    } else {
        for point in i.solver.topology.points.iter_mut() { if point.off as i32 == off { point.unseeded = unseeded != 0; } }
    }
}

#[no_mangle]
pub extern "C" fn kite_free_dof_count(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.free_dofs().len() as u32) }

/// Numerical rank of the constraint Jacobian over free DOFs (diagnostics only).
#[no_mangle]
pub extern "C" fn kite_jacobian_rank(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.jacobian_rank() as u32) }

#[no_mangle]
pub extern "C" fn kite_last_iterations(handle: i32) -> u32 { instance(handle).map_or(0, |i| i.solver.last_iterations) }

/// Fill `world_prim_buf`, `poly_vertex_buf` and `constraint_stress_buf`.
#[no_mangle]
pub extern "C" fn kite_project(handle: i32) -> f64 {
    let Some(i) = instance(handle) else { return f64::NAN };
    memory_view::project(&i.solver, &mut i.views, i.frame);
    i.solver.measure()
}

/// Evaluate a staged expression (`kite_alloc_tape` holds code, consts and
/// params staged separately). Returns NaN on error and sets `kite_last_error`.
#[no_mangle]
pub extern "C" fn kite_eval_expr(fuel: u32) -> f64 {
    let s = scratch();
    match vm::eval_expr(&s.tape, &s.consts, &s.params, fuel) {
        Ok(value) => { set_error(0); value }
        Err(error) => { set_error(100 + error as i32); f64::NAN }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vm::*;

    #[test]
    fn ffi_round_trip() {
        let tape = [MAGIC, VERSION, 5, 4, OP_POINT, 0, FLAG_FIXED, OP_POINT, 2, 0, OP_SCALAR, 4, FLAG_FIXED,
            OP_CONSTRAINT, C_ON_CIRCLE, 0, 2, 0, -1, -1, 4, -1, -1];
        let ptr = kite_alloc_tape(tape.len() as u32);
        unsafe { core::ptr::copy_nonoverlapping(tape.as_ptr(), ptr, tape.len()); }
        kite_alloc_consts(0);
        let handle = kite_load();
        assert!(handle >= 0);
        let state = kite_dof_state_ptr(handle);
        unsafe { for (index, value) in [0.0, 0.0, 100.0, 0.0, 100.0].iter().enumerate() { *state.add(index) = *value; } }
        kite_set_frame(handle, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 200.0, 200.0);
        let slot = kite_add_pin(handle, 2, 0, 1e-3);
        kite_set_pin_target(handle, slot, 0.0, 250.0);
        for _ in 0..40 { kite_step(handle, 12); }
        let (x, y) = unsafe { (*state.add(2), *state.add(3)) };
        assert!(((x * x + y * y).sqrt() - 100.0).abs() < 1e-6);
        assert!(y > 99.0);
        kite_destroy(handle);
    }
}
