//! Bytecode loader and the fuel-metered expression VM.
//!
//! The TypeScript front end tokenises the three DSL texts and assembles a flat
//! `i32` tape plus an `f64` constant pool. This module validates the tape and
//! builds the constraint topology (DOF layout, row counts, primitive table) in
//! one linear pass, so a topology change costs a single upload. It never
//! receives strings across the Wasm boundary.
//!
//! Style expressions (`r: k * 3`) compile to the stack bytecode evaluated by
//! [`eval_expr`]. Every instruction spends one unit of fuel; running out of
//! fuel, stack underflow/overflow or a non-finite result is a hard error, so a
//! document can never hang or poison the solver.

pub const MAGIC: i32 = 0x4B49_5445; // "KITE"
pub const VERSION: i32 = 1;

pub const OP_POINT: i32 = 1;
pub const OP_SCALAR: i32 = 2;
pub const OP_FIXDOF: i32 = 3;
pub const OP_CONSTRAINT: i32 = 4;
pub const OP_PRIM: i32 = 5;
pub const OP_POLY: i32 = 6;

pub const FLAG_FIXED: i32 = 1;
pub const FLAG_UNSEEDED: i32 = 2;

pub const C_DISTANCE: i32 = 1;
pub const C_COINCIDENT: i32 = 2;
pub const C_MIDPOINT: i32 = 3;
pub const C_ON_CIRCLE: i32 = 4;
pub const C_ON_LINE: i32 = 5;
pub const C_PERPENDICULAR: i32 = 6;
pub const C_PARALLEL: i32 = 7;
pub const C_EQUAL_LENGTH: i32 = 8;
pub const C_HORIZONTAL: i32 = 9;
pub const C_VERTICAL: i32 = 10;
pub const C_TANGENT: i32 = 11;
pub const C_RADIUS: i32 = 12;
pub const C_ANGLE: i32 = 13;

pub const P_POINT: i32 = 1;
pub const P_SEGMENT: i32 = 2;
pub const P_LINE: i32 = 3;
pub const P_RAY: i32 = 4;
pub const P_CIRCLE: i32 = 5;
pub const P_ARC: i32 = 6;
pub const P_POLYGON: i32 = 7;
pub const P_ANGLE: i32 = 8;
pub const P_LABEL: i32 = 9;

pub const ANCHOR_POINT: i32 = 1;
pub const ANCHOR_CENTER: i32 = 2;
pub const ANCHOR_MIDPOINT: i32 = 3;
pub const ANCHOR_POLYGON: i32 = 4;
/// Angle bisector: refs = [vertex, a, b]; `a` is the distance from the vertex.
pub const ANCHOR_BISECTOR: i32 = 5;
/// OR-ed into `anchor`: `a` is a distance along the anchor normal, not a vector.
pub const ANCHOR_NORMAL: i32 = 0x100;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LoadError {
    Header = 1,
    Truncated = 2,
    UnknownOp = 3,
    BadRef = 4,
    BadConst = 5,
    BadKind = 6,
}

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub off: usize,
    pub fixed: bool,
    pub unseeded: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Scalar {
    pub off: usize,
    pub fixed: bool,
    pub unseeded: bool,
}

/// One logical constraint. `refs` are DOF offsets of points (x lane), `-1` when
/// unused; `scalar` is the DOF offset of a radius.
#[derive(Clone, Copy, Debug)]
pub struct Constraint {
    pub kind: i32,
    pub soft: bool,
    pub refs: [i32; 4],
    pub scalar: i32,
    pub value: f64,
    pub compliance: f64,
}

impl Constraint {
    pub fn rows(&self) -> usize {
        match self.kind {
            C_COINCIDENT | C_MIDPOINT => 2,
            _ => 1,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Prim {
    pub kind: i32,
    pub refs: [i32; 3],
    pub scalar: i32,
    pub a: f64,
    pub b: f64,
    pub anchor: i32,
    /// Polygon vertices (DOF offsets) for `P_POLYGON`, or the polygon a label anchors to.
    pub poly: Vec<i32>,
}

#[derive(Clone, Debug, Default)]
pub struct Topology {
    pub dof_count: usize,
    pub points: Vec<Point>,
    pub scalars: Vec<Scalar>,
    pub fixed_dofs: Vec<usize>,
    pub constraints: Vec<Constraint>,
    pub prims: Vec<Prim>,
    pub row_count: usize,
}

fn word(tape: &[i32], at: usize) -> Result<i32, LoadError> {
    tape.get(at).copied().ok_or(LoadError::Truncated)
}

fn constant(consts: &[f64], index: i32) -> Result<f64, LoadError> {
    if index < 0 {
        return Ok(0.0);
    }
    let value = consts.get(index as usize).copied().ok_or(LoadError::BadConst)?;
    if value.is_finite() { Ok(value) } else { Err(LoadError::BadConst) }
}

/// Validate a tape and build its topology. Every reference is bounds-checked
/// against the declared DOF count so the solver can index without checks.
pub fn load(tape: &[i32], consts: &[f64]) -> Result<Topology, LoadError> {
    if word(tape, 0)? != MAGIC || word(tape, 1)? != VERSION {
        return Err(LoadError::Header);
    }
    let dof_count = word(tape, 2)?;
    let records = word(tape, 3)?;
    if dof_count < 0 || records < 0 || dof_count > 1 << 20 {
        return Err(LoadError::Header);
    }
    let dof_count = dof_count as usize;
    let point_ok = |off: i32| off >= 0 && (off as usize) + 1 < dof_count;
    let scalar_ok = |off: i32| off >= 0 && (off as usize) < dof_count;
    let mut topology = Topology { dof_count, ..Topology::default() };
    let mut at = 4usize;
    for _ in 0..records {
        match word(tape, at)? {
            OP_POINT => {
                let off = word(tape, at + 1)?;
                let flags = word(tape, at + 2)?;
                if !point_ok(off) { return Err(LoadError::BadRef); }
                topology.points.push(Point { off: off as usize, fixed: flags & FLAG_FIXED != 0, unseeded: flags & FLAG_UNSEEDED != 0 });
                at += 3;
            }
            OP_SCALAR => {
                let off = word(tape, at + 1)?;
                let flags = word(tape, at + 2)?;
                if !scalar_ok(off) { return Err(LoadError::BadRef); }
                topology.scalars.push(Scalar { off: off as usize, fixed: flags & FLAG_FIXED != 0, unseeded: flags & FLAG_UNSEEDED != 0 });
                at += 3;
            }
            OP_FIXDOF => {
                let off = word(tape, at + 1)?;
                if !scalar_ok(off) { return Err(LoadError::BadRef); }
                topology.fixed_dofs.push(off as usize);
                at += 2;
            }
            OP_CONSTRAINT => {
                let kind = word(tape, at + 1)?;
                if !(C_DISTANCE..=C_ANGLE).contains(&kind) { return Err(LoadError::BadKind); }
                let soft = word(tape, at + 2)? != 0;
                let mut refs = [-1i32; 4];
                for (slot, reference) in refs.iter_mut().enumerate() {
                    let value = word(tape, at + 3 + slot)?;
                    if value != -1 && !point_ok(value) { return Err(LoadError::BadRef); }
                    *reference = value;
                }
                let scalar = word(tape, at + 7)?;
                if scalar != -1 && !scalar_ok(scalar) { return Err(LoadError::BadRef); }
                let value = constant(consts, word(tape, at + 8)?)?;
                let compliance = constant(consts, word(tape, at + 9)?)?.max(0.0);
                let constraint = Constraint { kind, soft, refs, scalar, value, compliance };
                if !required_refs(&constraint) { return Err(LoadError::BadRef); }
                topology.row_count += constraint.rows();
                topology.constraints.push(constraint);
                at += 10;
            }
            OP_PRIM => {
                let kind = word(tape, at + 1)?;
                if !(P_POINT..=P_LABEL).contains(&kind) || kind == P_POLYGON { return Err(LoadError::BadKind); }
                let mut refs = [-1i32; 3];
                for (slot, reference) in refs.iter_mut().enumerate() {
                    let value = word(tape, at + 2 + slot)?;
                    if value != -1 && !point_ok(value) { return Err(LoadError::BadRef); }
                    *reference = value;
                }
                let scalar = word(tape, at + 5)?;
                if scalar != -1 && !scalar_ok(scalar) { return Err(LoadError::BadRef); }
                let a = constant(consts, word(tape, at + 6)?)?;
                let b = constant(consts, word(tape, at + 7)?)?;
                let anchor = word(tape, at + 8)?;
                let mut poly = Vec::new();
                if kind == P_LABEL && anchor & 0xFF == ANCHOR_POLYGON {
                    // The polygon's vertex list follows inline: [n, off...].
                    let count = word(tape, at + 9)?;
                    if count < 3 || count > 4096 { return Err(LoadError::BadRef); }
                    for index in 0..count as usize {
                        let off = word(tape, at + 10 + index)?;
                        if !point_ok(off) { return Err(LoadError::BadRef); }
                        poly.push(off);
                    }
                    at += 10 + count as usize;
                } else {
                    at += 9;
                }
                topology.prims.push(Prim { kind, refs, scalar, a, b, anchor, poly });
            }
            OP_POLY => {
                let count = word(tape, at + 1)?;
                if count < 3 || count > 4096 { return Err(LoadError::BadRef); }
                let mut poly = Vec::with_capacity(count as usize);
                for index in 0..count as usize {
                    let off = word(tape, at + 2 + index)?;
                    if !point_ok(off) { return Err(LoadError::BadRef); }
                    poly.push(off);
                }
                topology.prims.push(Prim { kind: P_POLYGON, refs: [-1; 3], scalar: -1, a: 0.0, b: 0.0, anchor: 0, poly });
                at += 2 + count as usize;
            }
            _ => return Err(LoadError::UnknownOp),
        }
    }
    if at != tape.len() { return Err(LoadError::Truncated); }
    Ok(topology)
}

fn required_refs(c: &Constraint) -> bool {
    let has = |slots: &[usize]| slots.iter().all(|&slot| c.refs[slot] >= 0);
    match c.kind {
        C_DISTANCE | C_COINCIDENT | C_HORIZONTAL | C_VERTICAL => has(&[0, 1]),
        C_MIDPOINT | C_ON_LINE | C_ANGLE => has(&[0, 1, 2]),
        C_ON_CIRCLE => has(&[0, 1]) && c.scalar >= 0,
        C_PERPENDICULAR | C_PARALLEL | C_EQUAL_LENGTH => has(&[0, 1, 2, 3]),
        C_TANGENT => has(&[0, 1, 2]) && c.scalar >= 0,
        C_RADIUS => c.scalar >= 0,
        _ => false,
    }
}

// ── expression VM ──────────────────────────────────────────────────────────

pub const X_CONST: i32 = 1;
pub const X_PARAM: i32 = 2;
pub const X_ADD: i32 = 3;
pub const X_SUB: i32 = 4;
pub const X_MUL: i32 = 5;
pub const X_DIV: i32 = 6;
pub const X_NEG: i32 = 7;
pub const X_POW: i32 = 8;
pub const X_SIN: i32 = 9;
pub const X_COS: i32 = 10;
pub const X_TAN: i32 = 11;
pub const X_SQRT: i32 = 12;
pub const X_ABS: i32 = 13;
pub const X_MIN: i32 = 14;
pub const X_MAX: i32 = 15;
pub const X_RAD: i32 = 16;

const STACK: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ExprError {
    Fuel = 1,
    Stack = 2,
    Operand = 3,
    NonFinite = 4,
    Opcode = 5,
}

/// Evaluate one expression. `fuel` bounds the instruction count.
pub fn eval_expr(code: &[i32], consts: &[f64], params: &[f64], fuel: u32) -> Result<f64, ExprError> {
    let mut stack = [0f64; STACK];
    let mut top = 0usize;
    let mut pc = 0usize;
    let mut remaining = fuel;
    macro_rules! pop { () => {{ if top == 0 { return Err(ExprError::Stack); } top -= 1; stack[top] }}; }
    macro_rules! push { ($v:expr) => {{ if top >= STACK { return Err(ExprError::Stack); } stack[top] = $v; top += 1; }}; }
    while pc < code.len() {
        if remaining == 0 { return Err(ExprError::Fuel); }
        remaining -= 1;
        let op = code[pc];
        pc += 1;
        match op {
            X_CONST | X_PARAM => {
                let index = *code.get(pc).ok_or(ExprError::Operand)?;
                pc += 1;
                if index < 0 { return Err(ExprError::Operand); }
                let source = if op == X_CONST { consts } else { params };
                push!(*source.get(index as usize).ok_or(ExprError::Operand)?);
            }
            X_ADD => { let b = pop!(); let a = pop!(); push!(a + b); }
            X_SUB => { let b = pop!(); let a = pop!(); push!(a - b); }
            X_MUL => { let b = pop!(); let a = pop!(); push!(a * b); }
            X_DIV => { let b = pop!(); let a = pop!(); push!(a / b); }
            X_POW => { let b = pop!(); let a = pop!(); push!(a.powf(b)); }
            X_MIN => { let b = pop!(); let a = pop!(); push!(a.min(b)); }
            X_MAX => { let b = pop!(); let a = pop!(); push!(a.max(b)); }
            X_NEG => { let a = pop!(); push!(-a); }
            X_SIN => { let a = pop!(); push!(a.sin()); }
            X_COS => { let a = pop!(); push!(a.cos()); }
            X_TAN => { let a = pop!(); push!(a.tan()); }
            X_SQRT => { let a = pop!(); push!(a.sqrt()); }
            X_ABS => { let a = pop!(); push!(a.abs()); }
            X_RAD => { let a = pop!(); push!(a * core::f64::consts::PI / 180.0); }
            _ => return Err(ExprError::Opcode),
        }
    }
    if top != 1 { return Err(ExprError::Stack); }
    let value = stack[0];
    if value.is_finite() { Ok(value) } else { Err(ExprError::NonFinite) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(dofs: i32, records: i32) -> Vec<i32> { vec![MAGIC, VERSION, dofs, records] }

    #[test]
    fn rejects_bad_headers_and_refs() {
        assert_eq!(load(&[1, 2, 3, 4], &[]).unwrap_err(), LoadError::Header);
        let mut tape = header(2, 1);
        tape.extend([OP_POINT, 2, 0]);
        assert_eq!(load(&tape, &[]).unwrap_err(), LoadError::BadRef);
        let mut tape = header(4, 1);
        tape.extend([OP_CONSTRAINT, C_DISTANCE, 0, 0, 2, -1, -1, -1, 5, -1]);
        assert_eq!(load(&tape, &[1.0]).unwrap_err(), LoadError::BadConst);
    }

    #[test]
    fn counts_rows() {
        let mut tape = header(6, 4);
        tape.extend([OP_POINT, 0, 0, OP_POINT, 2, 0, OP_POINT, 4, 0]);
        tape.extend([OP_CONSTRAINT, C_MIDPOINT, 0, 4, 0, 2, -1, -1, -1, -1]);
        let topology = load(&tape, &[]).unwrap();
        assert_eq!(topology.points.len(), 3);
        assert_eq!(topology.row_count, 2);
    }

    #[test]
    fn expressions_are_fuel_bounded() {
        let code = [X_PARAM, 0, X_CONST, 0, X_MUL];
        assert_eq!(eval_expr(&code, &[3.0], &[2.0], 100).unwrap(), 6.0);
        assert_eq!(eval_expr(&code, &[3.0], &[2.0], 2).unwrap_err(), ExprError::Fuel);
        assert_eq!(eval_expr(&[X_ADD], &[], &[], 10).unwrap_err(), ExprError::Stack);
        assert_eq!(eval_expr(&[X_CONST, 0, X_CONST, 1, X_DIV], &[1.0, 0.0], &[], 10).unwrap_err(), ExprError::NonFinite);
        assert_eq!(eval_expr(&[X_CONST, 0, X_RAD], &[180.0], &[], 10).unwrap(), core::f64::consts::PI);
    }
}
