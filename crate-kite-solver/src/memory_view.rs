//! Fixed-layout buffers shared with JavaScript without copying.
//!
//! | buffer                  | type | layout                                              |
//! |-------------------------|------|-----------------------------------------------------|
//! | `dof_state_buf`         | f64  | `[dof_0, dof_1, …]` scope-local DOFs                 |
//! | `world_prim_buf`        | f64  | 8 per primitive: `[kind, x1, y1, x2, y2, r, a0, a1]` |
//! | `poly_vertex_buf`       | f64  | polygon vertices `[x, y, …]` referenced by prims     |
//! | `constraint_stress_buf` | f32  | 1 per constraint, `0.0 ~ 1.0+` normalised residual   |
//!
//! Buffers are allocated once per topology and never resized, so pointers stay
//! valid until the instance is destroyed. JS must still rebuild its typed-array
//! views whenever `memory.buffer` changes (another instance may grow memory).

use crate::simd::V2;
use crate::vm::*;
use crate::xpbd_manifold::Solver;

pub const PRIM_STRIDE: usize = 8;

/// One radian-valued residual of 1° counts as stress 1.0; lengths use 1 px.
const ANGULAR_UNIT: f64 = 0.017_453_292_519_943_295;

/// Similarity transform from solver-local (DSL) units to world units:
/// `world = centre + R(rotation) · scale · (p − origin)`. Uniform scale keeps
/// angles, so moving or resizing a scope never invalidates its constraints.
/// `half_w`/`half_h` are the scope box half extents in local units (clipping).
#[derive(Clone, Copy)]
pub struct Frame {
    pub cx: f64,
    pub cy: f64,
    pub scale: f64,
    pub rotation: f64,
    pub ox: f64,
    pub oy: f64,
    pub half_w: f64,
    pub half_h: f64,
}

impl Frame {
    #[inline(always)]
    pub fn world(&self, p: V2) -> V2 {
        let (cos, sin) = (self.rotation.cos(), self.rotation.sin());
        let d = p.sub(V2::new(self.ox, self.oy)).scale(self.scale);
        V2::new(self.cx + d.x() * cos - d.y() * sin, self.cy + d.x() * sin + d.y() * cos)
    }
    #[inline(always)]
    pub fn direction(&self, d: V2) -> V2 {
        let (cos, sin) = (self.rotation.cos(), self.rotation.sin());
        V2::new(d.x() * cos - d.y() * sin, d.x() * sin + d.y() * cos)
    }
}

pub struct Views {
    pub prim: Vec<f64>,
    pub poly: Vec<f64>,
    pub stress: Vec<f32>,
}

impl Views {
    pub fn new(solver: &Solver) -> Views {
        let poly_len: usize = solver.topology.prims.iter().map(|p| if p.kind == P_POLYGON { p.poly.len() * 2 } else { 0 }).sum();
        Views {
            prim: vec![0.0; solver.topology.prims.len() * PRIM_STRIDE],
            poly: vec![0.0; poly_len],
            stress: vec![0.0; solver.topology.constraints.len()],
        }
    }
}

fn point(solver: &Solver, off: i32) -> V2 { let o = off as usize; V2::new(solver.x[o], solver.x[o + 1]) }

/// Liang–Barsky clip of the infinite line (or ray from `a`) through `a`, `b`
/// against the scope box, in local coordinates.
fn clip(a: V2, b: V2, frame: &Frame, ray: bool) -> (V2, V2) {
    let d = b.sub(a);
    let (minx, maxx, miny, maxy) = (frame.ox - frame.half_w, frame.ox + frame.half_w, frame.oy - frame.half_h, frame.oy + frame.half_h);
    let p = [-d.x(), d.x(), -d.y(), d.y()];
    let q = [a.x() - minx, maxx - a.x(), a.y() - miny, maxy - a.y()];
    let (mut t0, mut t1) = (if ray { 0.0 } else { f64::NEG_INFINITY }, f64::INFINITY);
    for index in 0..4 {
        if p[index].abs() < 1e-12 {
            if q[index] < 0.0 { return (a, b); }
            continue;
        }
        let t = q[index] / p[index];
        if p[index] < 0.0 { if t > t1 { return (a, b); } if t > t0 { t0 = t; } }
        else { if t < t0 { return (a, b); } if t < t1 { t1 = t; } }
    }
    if !t0.is_finite() || !t1.is_finite() || t1 <= t0 { return (a, b); }
    (a.add(d.scale(t0)), a.add(d.scale(t1)))
}

/// Write every primitive into `world_prim_buf` and the residual stress buffer.
pub fn project(solver: &Solver, views: &mut Views, frame: Frame) {
    let mut poly_at = 0usize;
    for (index, prim) in solver.topology.prims.iter().enumerate() {
        let out = &mut views.prim[index * PRIM_STRIDE..(index + 1) * PRIM_STRIDE];
        for value in out.iter_mut() { *value = 0.0; }
        out[0] = prim.kind as f64;
        match prim.kind {
            P_POINT => {
                let w = frame.world(point(solver, prim.refs[0]));
                out[1] = w.x(); out[2] = w.y();
            }
            P_SEGMENT | P_LINE | P_RAY => {
                let (mut a, mut b) = (point(solver, prim.refs[0]), point(solver, prim.refs[1]));
                if prim.kind != P_SEGMENT { let clipped = clip(a, b, &frame, prim.kind == P_RAY); a = clipped.0; b = clipped.1; }
                let (wa, wb) = (frame.world(a), frame.world(b));
                out[1] = wa.x(); out[2] = wa.y(); out[3] = wb.x(); out[4] = wb.y();
            }
            P_CIRCLE | P_ARC => {
                let c = frame.world(point(solver, prim.refs[0]));
                out[1] = c.x(); out[2] = c.y();
                out[5] = solver.x[prim.scalar as usize] * frame.scale;
                if prim.kind == P_ARC { out[6] = prim.a + frame.rotation; out[7] = prim.b + frame.rotation; }
            }
            P_POLYGON => {
                let count = prim.poly.len();
                let mut sum = V2::splat(0.0);
                for (vertex, &off) in prim.poly.iter().enumerate() {
                    let w = frame.world(point(solver, off));
                    views.poly[poly_at + vertex * 2] = w.x();
                    views.poly[poly_at + vertex * 2 + 1] = w.y();
                    sum = sum.add(w);
                }
                let centroid = sum.scale(1.0 / count as f64);
                out[1] = centroid.x(); out[2] = centroid.y();
                out[3] = poly_at as f64; out[4] = count as f64;
                poly_at += count * 2;
            }
            P_ANGLE => {
                // refs = [vertex, a, b]; out = [8, ox, oy, ux, uy, vx, vy, shortest arm (world)].
                let (o, a, b) = (point(solver, prim.refs[0]), point(solver, prim.refs[1]), point(solver, prim.refs[2]));
                let (u, v) = (a.sub(o), b.sub(o));
                let (lu, lv) = (u.len().max(1e-9), v.len().max(1e-9));
                let w = frame.world(o);
                let (du, dv) = (frame.direction(u.scale(1.0 / lu)), frame.direction(v.scale(1.0 / lv)));
                out[1] = w.x(); out[2] = w.y(); out[3] = du.x(); out[4] = du.y(); out[5] = dv.x(); out[6] = dv.y();
                out[7] = lu.min(lv) * frame.scale;
            }
            P_LABEL => {
                // out = [9, anchor x, anchor y, normal x, normal y, 0, 0, 0] in world units;
                // offsets are visual (screen-independent world px) and applied by the renderer.
                let (anchor, normal) = label_anchor(solver, prim);
                let w = frame.world(anchor);
                let n = frame.direction(normal);
                out[1] = w.x(); out[2] = w.y(); out[3] = n.x(); out[4] = n.y();
            }
            _ => {}
        }
    }
    for (index, constraint) in solver.topology.constraints.iter().enumerate() {
        let residual = solver.row_residual(constraint);
        let unit = match constraint.kind { C_PERPENDICULAR | C_PARALLEL => 0.017_452_406, C_ANGLE => ANGULAR_UNIT, _ => 1.0 };
        views.stress[index] = (residual / unit) as f32;
    }
}

fn label_anchor(solver: &Solver, prim: &Prim) -> (V2, V2) {
    match prim.anchor & 0xFF {
        ANCHOR_MIDPOINT => {
            let (a, b) = (point(solver, prim.refs[0]), point(solver, prim.refs[1]));
            let d = b.sub(a);
            let len = d.len().max(1e-9);
            (a.add(b).scale(0.5), d.perp().scale(1.0 / len))
        }
        ANCHOR_BISECTOR => {
            let (o, a, b) = (point(solver, prim.refs[0]), point(solver, prim.refs[1]), point(solver, prim.refs[2]));
            let (u, v) = (a.sub(o), b.sub(o));
            let (lu, lv) = (u.len().max(1e-9), v.len().max(1e-9));
            let mut bisector = u.scale(1.0 / lu).add(v.scale(1.0 / lv));
            let len = bisector.len();
            bisector = if len < 1e-9 { u.perp().scale(1.0 / lu) } else { bisector.scale(1.0 / len) };
            (o, bisector)
        }
        ANCHOR_POLYGON => {
            let mut sum = V2::splat(0.0);
            for &off in &prim.poly { sum = sum.add(point(solver, off)); }
            (sum.scale(1.0 / prim.poly.len().max(1) as f64), V2::new(0.0, -1.0))
        }
        _ => (point(solver, prim.refs[0]), V2::new(0.0, -1.0)),
    }
}
