//! Non-convex initial placement.
//!
//! XPBD from a bad start can settle in the wrong branch of a non-convex
//! manifold (a point on the far side of a circle, a mirrored right angle).
//! When the topology is dirty we try a small deterministic set of candidate
//! placements for the unseeded DOFs, run a short relaxation from each, keep the
//! lowest-energy result, then warm-start the full solve from it. Seeded DOFs
//! are never perturbed, so existing geometry does not jump.

use crate::xpbd_manifold::Solver;

/// splitmix64: a tiny deterministic generator, so every client agrees.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn unit(&mut self) -> f64 { (self.next() >> 11) as f64 / (1u64 << 53) as f64 }
}

pub struct InitReport {
    pub candidates: u32,
    pub best_energy: f64,
}

/// `extent` = (origin x, origin y, half width, half height) of the scope box in
/// local units; candidates stay inside it.
pub fn place(solver: &mut Solver, seed: u64, candidates: u32, relax: u32, polish: u32, extent: (f64, f64, f64, f64)) -> InitReport {
    let (ox, oy, hw, hh) = extent;
    let unseeded_points: Vec<usize> = solver.topology.points.iter().filter(|p| p.unseeded && !p.fixed).map(|p| p.off).collect();
    let unseeded_scalars: Vec<usize> = solver.topology.scalars.iter().filter(|s| s.unseeded && !s.fixed).map(|s| s.off).collect();
    let base = solver.x.clone();
    let mut best = base.clone();
    let mut best_energy = f64::INFINITY;
    let total = if unseeded_points.is_empty() && unseeded_scalars.is_empty() { 1 } else { candidates.max(1) };
    let mut rng = Rng(seed ^ 0xD1B5_4A32_D192_ED03);
    for index in 0..total {
        solver.x.copy_from_slice(&base);
        // Candidate 0 is the declared layout itself; the rest jitter around it
        // and mirror across the box centre to reach the other branches.
        if index > 0 {
            let spread = 0.15 + 0.35 * (index as f64 / total as f64);
            let mirror = index % 2 == 0;
            for &off in &unseeded_points {
                let (mut px, mut py) = (base[off], base[off + 1]);
                if mirror { px = 2.0 * ox - px; py = 2.0 * oy - py; }
                px += (rng.unit() - 0.5) * 2.0 * hw * spread;
                py += (rng.unit() - 0.5) * 2.0 * hh * spread;
                solver.x[off] = px.clamp(ox - hw, ox + hw);
                solver.x[off + 1] = py.clamp(oy - hh, oy + hh);
            }
            for &off in &unseeded_scalars {
                solver.x[off] = (base[off] * (0.6 + 0.8 * rng.unit())).max(1.0);
            }
        }
        solver.solve(relax);
        let energy = solver.energy();
        if energy < best_energy - 1e-12 {
            best_energy = energy;
            best.copy_from_slice(&solver.x);
        }
    }
    solver.x.copy_from_slice(&best);
    solver.solve(polish);
    InitReport { candidates: total, best_energy: solver.energy().min(best_energy) }
}
