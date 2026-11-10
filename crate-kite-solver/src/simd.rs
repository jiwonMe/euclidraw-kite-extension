//! Two-lane f64 vectors. On wasm32 every operation lowers to a single
//! `simd128` instruction; native builds (used by `cargo test`) use scalars with
//! identical IEEE-754 results, so tests and the shipped module agree.

#[cfg(target_arch = "wasm32")]
mod imp {
    use core::arch::wasm32::*;

    #[derive(Clone, Copy)]
    pub struct V2(v128);

    impl V2 {
        #[inline(always)]
        pub fn new(x: f64, y: f64) -> V2 { V2(f64x2(x, y)) }
        #[inline(always)]
        pub fn splat(v: f64) -> V2 { V2(f64x2_splat(v)) }
        #[inline(always)]
        pub fn x(self) -> f64 { f64x2_extract_lane::<0>(self.0) }
        #[inline(always)]
        pub fn y(self) -> f64 { f64x2_extract_lane::<1>(self.0) }
        #[inline(always)]
        pub fn add(self, o: V2) -> V2 { V2(f64x2_add(self.0, o.0)) }
        #[inline(always)]
        pub fn sub(self, o: V2) -> V2 { V2(f64x2_sub(self.0, o.0)) }
        #[inline(always)]
        pub fn mul(self, o: V2) -> V2 { V2(f64x2_mul(self.0, o.0)) }
        #[inline(always)]
        pub fn scale(self, s: f64) -> V2 { V2(f64x2_mul(self.0, f64x2_splat(s))) }
        #[inline(always)]
        pub fn dot(self, o: V2) -> f64 { let m = f64x2_mul(self.0, o.0); f64x2_extract_lane::<0>(m) + f64x2_extract_lane::<1>(m) }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    #[derive(Clone, Copy)]
    pub struct V2(f64, f64);

    impl V2 {
        #[inline(always)]
        pub fn new(x: f64, y: f64) -> V2 { V2(x, y) }
        #[inline(always)]
        pub fn splat(v: f64) -> V2 { V2(v, v) }
        #[inline(always)]
        pub fn x(self) -> f64 { self.0 }
        #[inline(always)]
        pub fn y(self) -> f64 { self.1 }
        #[inline(always)]
        pub fn add(self, o: V2) -> V2 { V2(self.0 + o.0, self.1 + o.1) }
        #[inline(always)]
        pub fn sub(self, o: V2) -> V2 { V2(self.0 - o.0, self.1 - o.1) }
        #[inline(always)]
        pub fn mul(self, o: V2) -> V2 { V2(self.0 * o.0, self.1 * o.1) }
        #[inline(always)]
        pub fn scale(self, s: f64) -> V2 { V2(self.0 * s, self.1 * s) }
        #[inline(always)]
        pub fn dot(self, o: V2) -> f64 { self.0 * o.0 + self.1 * o.1 }
    }
}

pub use imp::V2;

impl V2 {
    #[inline(always)]
    pub fn len(self) -> f64 { self.dot(self).sqrt() }
    #[inline(always)]
    pub fn cross(self, o: V2) -> f64 { self.x() * o.y() - self.y() * o.x() }
    #[inline(always)]
    pub fn perp(self) -> V2 { V2::new(-self.y(), self.x()) }
}
