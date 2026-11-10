//! XPBD manifold projection.
//!
//! Each constraint row `C(x) = 0` is projected with the compliant XPBD update
//!
//!   Δλ = (−C − α̃·λ) / (Σ wᵢ‖∇ᵢC‖² + α̃),   xᵢ += wᵢ·∇ᵢC·Δλ,   α̃ = α / Δt²
//!
//! using analytic gradients. Hard rows use α = 0 (pure projection onto the
//! constraint manifold); `soft` rows and the pointer spring (the slack
//! constraint of a drag) use α > 0, so the dragged point is pulled toward the
//! cursor only as far as the hard manifold allows. Pinned DOFs have inverse
//! mass 0. Lambdas reset every substep (one Gauss–Seidel sweep per substep),
//! which keeps the iteration deterministic and warm-startable from the seed.

use crate::simd::V2;
use crate::vm::*;

pub const MAX_PINS: usize = 8;
const EPS: f64 = 1e-12;
const DT: f64 = 1.0 / 120.0;
const SWEEPS: u32 = 4;

#[derive(Clone, Copy, Debug, Default)]
pub struct PinTarget {
    /// DOF offset of a point (x lane) or of a scalar.
    pub dof: i32,
    pub is_scalar: bool,
    pub x: f64,
    pub y: f64,
    pub compliance: f64,
}

pub struct Solver {
    pub topology: Topology,
    pub x: Vec<f64>,
    pub w: Vec<f64>,
    pub residual: Vec<f32>,
    pub pins: [PinTarget; MAX_PINS],
    pub pin_count: usize,
    pub damping: f64,
    pub last_iterations: u32,
}

impl Solver {
    pub fn new(topology: Topology) -> Solver {
        let dofs = topology.dof_count;
        let rows = topology.constraints.len();
        let mut solver = Solver {
            topology,
            x: vec![0.0; dofs],
            w: vec![1.0; dofs],
            residual: vec![0.0; rows],
            pins: [PinTarget::default(); MAX_PINS],
            pin_count: 0,
            damping: 1.0,
            last_iterations: 0,
        };
        solver.reset_masses(&[]);
        solver
    }

    /// Inverse masses: 0 for fixed points/scalars, `FIXDOF` entries and the
    /// caller's extra pinned DOFs (member `pinnedDofs`).
    pub fn reset_masses(&mut self, extra_fixed: &[usize]) {
        for value in self.w.iter_mut() { *value = 1.0; }
        for point in &self.topology.points {
            if point.fixed { self.w[point.off] = 0.0; self.w[point.off + 1] = 0.0; }
        }
        for scalar in &self.topology.scalars {
            if scalar.fixed { self.w[scalar.off] = 0.0; }
        }
        for &dof in self.topology.fixed_dofs.iter().chain(extra_fixed.iter()) {
            if dof < self.w.len() { self.w[dof] = 0.0; }
        }
    }

    #[inline(always)]
    fn p(&self, off: i32) -> V2 { let o = off as usize; V2::new(self.x[o], self.x[o + 1]) }

    #[inline(always)]
    fn wp(&self, off: i32) -> f64 { self.w[off as usize] }

    #[inline(always)]
    fn ws(&self, off: i32) -> f64 { self.w[off as usize] }

    #[inline(always)]
    fn move_p(&mut self, off: i32, delta: V2) {
        let o = off as usize;
        self.x[o] += self.w[o] * delta.x();
        self.x[o + 1] += self.w[o + 1] * delta.y();
    }

    #[inline(always)]
    fn move_s(&mut self, off: i32, delta: f64) {
        let o = off as usize;
        self.x[o] += self.w[o] * delta;
        if self.x[o] < 1e-6 { self.x[o] = 1e-6; }
    }

    /// Pointer-free projection onto the hard manifold: the last stage of each
    /// interactive frame, so what is shown satisfies the constraints. Sweeps
    /// until the max hard residual is below `tolerance` or `max_sweeps` runs out.
    pub fn project_manifold(&mut self, max_sweeps: u32, tolerance: f64) -> f64 {
        let mut residual = self.measure();
        let mut sweeps = 0u32;
        while residual > tolerance && sweeps < max_sweeps {
            for _ in 0..4 {
                for index in 0..self.topology.constraints.len() {
                    let constraint = self.topology.constraints[index];
                    if !constraint.soft { self.project(&constraint, 0.0); }
                }
            }
            sweeps += 4;
            residual = self.measure();
        }
        self.last_iterations = sweeps;
        residual
    }

    /// Run `iterations` substeps. Returns the maximum hard residual.
    pub fn solve(&mut self, iterations: u32) -> f64 {
        let compliance_scale = 1.0 / (DT * DT);
        for _ in 0..iterations {
            for index in 0..self.pin_count {
                let pin = self.pins[index];
                self.project_pin(pin, compliance_scale);
            }
            // Several Gauss–Seidel sweeps per substep: the pointer spring is
            // applied once, then the hard manifold is re-projected until the
            // coupled rows (shared centres, radii) agree again.
            for _ in 0..SWEEPS {
                for index in 0..self.topology.constraints.len() {
                    let constraint = self.topology.constraints[index];
                    let alpha = if constraint.soft { constraint.compliance.max(1e-4) * compliance_scale } else { 0.0 };
                    self.project(&constraint, alpha);
                }
            }
        }
        self.last_iterations = iterations;
        self.measure()
    }

    fn project_pin(&mut self, pin: PinTarget, scale: f64) {
        let alpha = pin.compliance.max(0.0) * scale;
        if pin.is_scalar {
            let w = self.ws(pin.dof);
            let c = self.x[pin.dof as usize] - pin.x;
            let denom = w + alpha;
            if denom > EPS { self.move_s(pin.dof, -c / denom); }
        } else {
            let p = self.p(pin.dof);
            let d = p.sub(V2::new(pin.x, pin.y));
            let w = self.wp(pin.dof);
            let denom = w + alpha;
            if denom > EPS { self.move_p(pin.dof, d.scale(-1.0 / denom)); }
        }
    }

    /// One compliant projection of a single constraint.
    fn project(&mut self, c: &Constraint, alpha: f64) {
        let damping = self.damping;
        let r = c.refs;
        match c.kind {
            C_DISTANCE => {
                let d = self.p(r[1]).sub(self.p(r[0]));
                let len = d.len();
                if len < EPS { return; }
                let n = d.scale(1.0 / len);
                let cv = len - c.value;
                let denom = self.wp(r[0]) + self.wp(r[1]) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], n.scale(-l));
                self.move_p(r[1], n.scale(l));
            }
            C_COINCIDENT => {
                let d = self.p(r[1]).sub(self.p(r[0]));
                let denom = self.wp(r[0]) + self.wp(r[1]) + alpha;
                if denom < EPS { return; }
                let l = d.scale(damping / denom);
                self.move_p(r[0], l);
                self.move_p(r[1], l.scale(-1.0));
            }
            C_MIDPOINT => {
                let (m, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let cv = m.sub(a.add(b).scale(0.5));
                let denom = self.wp(r[0]) + 0.25 * self.wp(r[1]) + 0.25 * self.wp(r[2]) + alpha;
                if denom < EPS { return; }
                let l = cv.scale(-damping / denom);
                self.move_p(r[0], l);
                self.move_p(r[1], l.scale(-0.5));
                self.move_p(r[2], l.scale(-0.5));
            }
            C_ON_CIRCLE => {
                let (p, o) = (self.p(r[0]), self.p(r[1]));
                let d = p.sub(o);
                let len = d.len();
                if len < EPS { return; }
                let n = d.scale(1.0 / len);
                let cv = len - self.x[c.scalar as usize];
                let denom = self.wp(r[0]) + self.wp(r[1]) + self.ws(c.scalar) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], n.scale(l));
                self.move_p(r[1], n.scale(-l));
                self.move_s(c.scalar, -l);
            }
            C_ON_LINE => {
                let (p, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let u = b.sub(a);
                let len = u.len();
                if len < EPS { return; }
                let n = u.perp().scale(1.0 / len);
                let cv = p.sub(a).dot(n);
                let t = p.sub(a).dot(u) / (len * len);
                let (ga, gb) = (n.scale(-(1.0 - t)), n.scale(-t));
                let denom = self.wp(r[0]) + self.wp(r[1]) * ga.dot(ga) + self.wp(r[2]) * gb.dot(gb) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], n.scale(l));
                self.move_p(r[1], ga.scale(l));
                self.move_p(r[2], gb.scale(l));
            }
            C_PERPENDICULAR | C_PARALLEL => {
                let (a, b, cc, d) = (self.p(r[0]), self.p(r[1]), self.p(r[2]), self.p(r[3]));
                let u = b.sub(a);
                let v = d.sub(cc);
                let (lu, lv) = (u.len(), v.len());
                if lu < EPS || lv < EPS { return; }
                // Normalised so the residual is the sine/cosine of the angle error.
                let (cv, gu, gv) = if c.kind == C_PERPENDICULAR {
                    let dot = u.dot(v) / (lu * lv);
                    (dot, v.scale(1.0 / (lu * lv)).sub(u.scale(dot / (lu * lu))), u.scale(1.0 / (lu * lv)).sub(v.scale(dot / (lv * lv))))
                } else {
                    let cross = u.cross(v) / (lu * lv);
                    (cross, V2::new(v.y(), -v.x()).scale(1.0 / (lu * lv)).sub(u.scale(cross / (lu * lu))), V2::new(-u.y(), u.x()).scale(1.0 / (lu * lv)).sub(v.scale(cross / (lv * lv))))
                };
                let denom = (self.wp(r[0]) + self.wp(r[1])) * gu.dot(gu) + (self.wp(r[2]) + self.wp(r[3])) * gv.dot(gv) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], gu.scale(-l));
                self.move_p(r[1], gu.scale(l));
                self.move_p(r[2], gv.scale(-l));
                self.move_p(r[3], gv.scale(l));
            }
            C_EQUAL_LENGTH => {
                let (a, b, cc, d) = (self.p(r[0]), self.p(r[1]), self.p(r[2]), self.p(r[3]));
                let (u, v) = (b.sub(a), d.sub(cc));
                let (lu, lv) = (u.len(), v.len());
                if lu < EPS || lv < EPS { return; }
                let (nu, nv) = (u.scale(1.0 / lu), v.scale(1.0 / lv));
                let cv = lu - lv;
                let denom = self.wp(r[0]) + self.wp(r[1]) + self.wp(r[2]) + self.wp(r[3]) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], nu.scale(-l));
                self.move_p(r[1], nu.scale(l));
                self.move_p(r[2], nv.scale(l));
                self.move_p(r[3], nv.scale(-l));
            }
            C_HORIZONTAL | C_VERTICAL => {
                let (a, b) = (self.p(r[0]), self.p(r[1]));
                let (cv, g) = if c.kind == C_HORIZONTAL { (b.y() - a.y(), V2::new(0.0, 1.0)) } else { (b.x() - a.x(), V2::new(1.0, 0.0)) };
                let denom = self.wp(r[0]) + self.wp(r[1]) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[0], g.scale(-l));
                self.move_p(r[1], g.scale(l));
            }
            C_TANGENT => {
                // r = [line a, line b, centre]; signed distance keeps the side.
                let (a, b, o) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let u = b.sub(a);
                let len = u.len();
                if len < EPS { return; }
                let n = u.perp().scale(1.0 / len);
                let signed = o.sub(a).dot(n);
                let side = if signed < 0.0 { -1.0 } else { 1.0 };
                let cv = signed * side - self.x[c.scalar as usize];
                let t = o.sub(a).dot(u) / (len * len);
                let go = n.scale(side);
                let (ga, gb) = (go.scale(-(1.0 - t)), go.scale(-t));
                let denom = self.wp(r[2]) + self.wp(r[0]) * ga.dot(ga) + self.wp(r[1]) * gb.dot(gb) + self.ws(c.scalar) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[2], go.scale(l));
                self.move_p(r[0], ga.scale(l));
                self.move_p(r[1], gb.scale(l));
                self.move_s(c.scalar, -l);
            }
            C_RADIUS => {
                let cv = self.x[c.scalar as usize] - c.value;
                let denom = self.ws(c.scalar) + alpha;
                if denom < EPS { return; }
                self.move_s(c.scalar, -cv / denom * damping);
            }
            C_ANGLE => {
                // r = [vertex, a, b]; C = atan2(u×v, u·v) − θ, sign-agnostic.
                let (o, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let (u, v) = (a.sub(o), b.sub(o));
                let (lu2, lv2) = (u.dot(u), v.dot(v));
                if lu2 < EPS || lv2 < EPS { return; }
                let angle = u.cross(v).atan2(u.dot(v));
                let sign = if angle < 0.0 { -1.0 } else { 1.0 };
                let cv = angle * sign - c.value;
                let gu = V2::new(u.y(), -u.x()).scale(sign / lu2);
                let gv = V2::new(-v.y(), v.x()).scale(sign / lv2);
                let go = gu.add(gv).scale(-1.0);
                let denom = self.wp(r[1]) * gu.dot(gu) + self.wp(r[2]) * gv.dot(gv) + self.wp(r[0]) * go.dot(go) + alpha;
                if denom < EPS { return; }
                let l = -cv / denom * damping;
                self.move_p(r[1], gu.scale(l));
                self.move_p(r[2], gv.scale(l));
                self.move_p(r[0], go.scale(l));
            }
            _ => {}
        }
    }

    /// Absolute residual of a constraint in its natural units.
    pub fn row_residual(&self, c: &Constraint) -> f64 {
        let r = c.refs;
        match c.kind {
            C_DISTANCE => (self.p(r[1]).sub(self.p(r[0])).len() - c.value).abs(),
            C_COINCIDENT => self.p(r[1]).sub(self.p(r[0])).len(),
            C_MIDPOINT => self.p(r[0]).sub(self.p(r[1]).add(self.p(r[2])).scale(0.5)).len(),
            C_ON_CIRCLE => (self.p(r[0]).sub(self.p(r[1])).len() - self.x[c.scalar as usize]).abs(),
            C_ON_LINE => {
                let (p, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let u = b.sub(a);
                let len = u.len();
                if len < EPS { 0.0 } else { (p.sub(a).cross(u) / len).abs() }
            }
            C_PERPENDICULAR | C_PARALLEL => {
                let u = self.p(r[1]).sub(self.p(r[0]));
                let v = self.p(r[3]).sub(self.p(r[2]));
                let (lu, lv) = (u.len(), v.len());
                if lu < EPS || lv < EPS { 0.0 } else if c.kind == C_PERPENDICULAR { (u.dot(v) / (lu * lv)).abs() } else { (u.cross(v) / (lu * lv)).abs() }
            }
            C_EQUAL_LENGTH => (self.p(r[1]).sub(self.p(r[0])).len() - self.p(r[3]).sub(self.p(r[2])).len()).abs(),
            C_HORIZONTAL => (self.p(r[1]).y() - self.p(r[0]).y()).abs(),
            C_VERTICAL => (self.p(r[1]).x() - self.p(r[0]).x()).abs(),
            C_TANGENT => {
                let (a, b, o) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let u = b.sub(a);
                let len = u.len();
                if len < EPS { 0.0 } else { ((o.sub(a).cross(u) / len).abs() - self.x[c.scalar as usize]).abs() }
            }
            C_RADIUS => (self.x[c.scalar as usize] - c.value).abs(),
            C_ANGLE => {
                let (o, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                let (u, v) = (a.sub(o), b.sub(o));
                (u.cross(v).atan2(u.dot(v)).abs() - c.value).abs()
            }
            _ => 0.0,
        }
    }

    /// Signed residual rows (C(x), not |C(x)|), for the numerical Jacobian.
    pub fn rows_into(&self, out: &mut Vec<f64>) {
        out.clear();
        for c in &self.topology.constraints {
            let r = c.refs;
            match c.kind {
                C_DISTANCE => out.push(self.p(r[1]).sub(self.p(r[0])).len() - c.value),
                C_COINCIDENT => { let d = self.p(r[1]).sub(self.p(r[0])); out.push(d.x()); out.push(d.y()); }
                C_MIDPOINT => { let d = self.p(r[0]).sub(self.p(r[1]).add(self.p(r[2])).scale(0.5)); out.push(d.x()); out.push(d.y()); }
                C_ON_CIRCLE => out.push(self.p(r[0]).sub(self.p(r[1])).len() - self.x[c.scalar as usize]),
                C_ON_LINE => {
                    let (p, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                    let u = b.sub(a);
                    let len = u.len().max(EPS);
                    out.push(p.sub(a).cross(u) / len);
                }
                C_PERPENDICULAR | C_PARALLEL => {
                    let u = self.p(r[1]).sub(self.p(r[0]));
                    let v = self.p(r[3]).sub(self.p(r[2]));
                    let n = (u.len() * v.len()).max(EPS);
                    out.push(if c.kind == C_PERPENDICULAR { u.dot(v) / n } else { u.cross(v) / n });
                }
                C_EQUAL_LENGTH => out.push(self.p(r[1]).sub(self.p(r[0])).len() - self.p(r[3]).sub(self.p(r[2])).len()),
                C_HORIZONTAL => out.push(self.p(r[1]).y() - self.p(r[0]).y()),
                C_VERTICAL => out.push(self.p(r[1]).x() - self.p(r[0]).x()),
                C_TANGENT => {
                    let (a, b, o) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                    let u = b.sub(a);
                    let len = u.len().max(EPS);
                    out.push((o.sub(a).cross(u) / len).abs() - self.x[c.scalar as usize]);
                }
                C_RADIUS => out.push(self.x[c.scalar as usize] - c.value),
                C_ANGLE => {
                    let (o, a, b) = (self.p(r[0]), self.p(r[1]), self.p(r[2]));
                    let (u, v) = (a.sub(o), b.sub(o));
                    out.push(u.cross(v).atan2(u.dot(v)).abs() - c.value);
                }
                _ => out.push(0.0),
            }
        }
    }

    /// Free DOFs (inverse mass > 0).
    pub fn free_dofs(&self) -> Vec<usize> {
        (0..self.x.len()).filter(|&i| self.w[i] > 0.0).collect()
    }

    /// Numerical rank of ∂C/∂x over the free DOFs (central differences and
    /// modified Gram–Schmidt with re-orthogonalisation). Restores `x`.
    pub fn jacobian_rank(&mut self) -> usize {
        let free = self.free_dofs();
        if free.is_empty() || self.topology.constraints.is_empty() { return 0; }
        let h = 1e-6;
        let mut plus = Vec::new();
        let mut minus = Vec::new();
        let mut columns: Vec<Vec<f64>> = Vec::with_capacity(free.len());
        for &dof in &free {
            let saved = self.x[dof];
            self.x[dof] = saved + h; self.rows_into(&mut plus);
            self.x[dof] = saved - h; self.rows_into(&mut minus);
            self.x[dof] = saved;
            columns.push(plus.iter().zip(minus.iter()).map(|(a, b)| (a - b) / (2.0 * h)).collect());
        }
        let rows = columns.first().map_or(0, |c| c.len());
        let mut basis: Vec<Vec<f64>> = Vec::new();
        for row in 0..rows {
            let mut vector: Vec<f64> = columns.iter().map(|column| column[row]).collect();
            let norm0 = vector.iter().map(|v| v * v).sum::<f64>().sqrt();
            if !norm0.is_finite() || norm0 < 1e-9 { continue; }
            for _ in 0..2 {
                for axis in &basis {
                    let dot: f64 = vector.iter().zip(axis.iter()).map(|(a, b)| a * b).sum();
                    for (value, component) in vector.iter_mut().zip(axis.iter()) { *value -= dot * component; }
                }
            }
            let norm = vector.iter().map(|v| v * v).sum::<f64>().sqrt();
            if norm > 1e-7 * norm0.max(1.0) {
                for value in vector.iter_mut() { *value /= norm; }
                basis.push(vector);
            }
        }
        basis.len()
    }

    /// Refresh the per-constraint residual buffer; returns the max hard residual.
    pub fn measure(&mut self) -> f64 {
        let mut worst = 0.0f64;
        for index in 0..self.topology.constraints.len() {
            let constraint = self.topology.constraints[index];
            let value = self.row_residual(&constraint);
            self.residual[index] = value as f32;
            if !constraint.soft && value > worst { worst = value; }
        }
        worst
    }

    /// Total residual energy E(x) = ½ Σ C²  (soft rows weighted by 1/(1+α)).
    pub fn energy(&self) -> f64 {
        let mut total = 0.0;
        for constraint in &self.topology.constraints {
            let value = self.row_residual(constraint);
            let weight = if constraint.soft { 1.0 / (1.0 + constraint.compliance) } else { 1.0 };
            total += 0.5 * weight * value * value;
        }
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vm;

    fn tape(dofs: i32, body: &[i32]) -> Vec<i32> {
        let mut records = 0;
        let mut at = 0;
        while at < body.len() {
            records += 1;
            at += match body[at] { OP_POINT | OP_SCALAR => 3, OP_FIXDOF => 2, OP_CONSTRAINT => 10, OP_PRIM => 9, OP_POLY => 2 + body[at + 1] as usize, _ => panic!() };
        }
        let mut out = vec![MAGIC, VERSION, dofs, records];
        out.extend_from_slice(body);
        out
    }

    #[test]
    fn projects_a_dragged_point_onto_its_circle() {
        // O fixed at (0,0), P free, radius 100 fixed.
        let body = [OP_POINT, 0, FLAG_FIXED, OP_POINT, 2, 0, OP_SCALAR, 4, FLAG_FIXED,
            OP_CONSTRAINT, C_ON_CIRCLE, 0, 2, 0, -1, -1, 4, -1, -1];
        let topology = vm::load(&tape(5, &body), &[]).unwrap();
        let mut solver = Solver::new(topology);
        solver.x.copy_from_slice(&[0.0, 0.0, 100.0, 0.0, 100.0]);
        solver.pins[0] = PinTarget { dof: 2, is_scalar: false, x: 300.0, y: 300.0, compliance: 1e-3 };
        solver.pin_count = 1;
        for _ in 0..30 { solver.solve(12); }
        let (px, py) = (solver.x[2], solver.x[3]);
        assert!(((px * px + py * py).sqrt() - 100.0).abs() < 1e-6, "radius drift");
        assert!((py / px - 1.0).abs() < 1e-3, "follows the pointer direction");
    }

    #[test]
    fn keeps_perpendicular_and_equal_length() {
        let body = [OP_POINT, 0, FLAG_FIXED, OP_POINT, 2, FLAG_FIXED, OP_POINT, 4, 0,
            OP_CONSTRAINT, C_PERPENDICULAR, 0, 0, 2, 2, 4, -1, -1, -1,
            OP_CONSTRAINT, C_EQUAL_LENGTH, 0, 0, 2, 2, 4, -1, -1, -1];
        let topology = vm::load(&tape(6, &body), &[]).unwrap();
        let mut solver = Solver::new(topology);
        solver.x.copy_from_slice(&[0.0, 0.0, 100.0, 0.0, 140.0, -70.0]);
        let residual = solver.solve(200);
        assert!(residual < 1e-6, "residual {residual}");
        assert!((solver.x[4] - 100.0).abs() < 1e-4 && (solver.x[5].abs() - 100.0).abs() < 1e-4);
    }

    #[test]
    fn is_deterministic() {
        let body = [OP_POINT, 0, 0, OP_POINT, 2, 0, OP_CONSTRAINT, C_DISTANCE, 0, 0, 2, -1, -1, -1, 0, -1];
        let run = || {
            let mut solver = Solver::new(vm::load(&tape(4, &body), &[50.0]).unwrap());
            solver.x.copy_from_slice(&[1.0, 2.0, 30.0, 40.0]);
            solver.solve(40);
            solver.x.clone()
        };
        assert_eq!(run(), run());
    }
}

#[cfg(test)]
mod rank_tests {
    use super::*;
    use crate::vm;

    #[test]
    fn rank_counts_independent_rows() {
        // Two free points, one distance: 4 DOFs, rank 1.
        let tape = [MAGIC, VERSION, 4, 3, OP_POINT, 0, 0, OP_POINT, 2, 0, OP_CONSTRAINT, C_DISTANCE, 0, 0, 2, -1, -1, -1, 0, -1];
        let mut solver = Solver::new(vm::load(&tape, &[50.0]).unwrap());
        solver.x.copy_from_slice(&[0.0, 0.0, 50.0, 0.0]);
        assert_eq!(solver.jacobian_rank(), 1);
        assert_eq!(solver.free_dofs().len(), 4);
    }
}

