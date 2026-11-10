import { describe, expect, it } from 'vitest';
import { compileScope } from '../src/dsl/compile.ts';
import { createScopeDefaults } from '../src/defaults.ts';
import { createMockWorld } from './harness.ts';
import { memberPinsFrom, pointOf, radiusOf, seedsAreClean, seedsFromValues, solveState } from '../src/solver/solve.ts';
import { analyzeScope } from '../src/solver/runtime.ts';
import { KiteDragSession } from '../src/tools/drag-session.ts';
import type { ScopeProps } from '../src/types.ts';

function boundScope(): ScopeProps {
  const base = createScopeDefaults();
  const compiled = compileScope(base);
  const entityBindings: Record<string, string> = {};
  for (const instance of compiled.instances.values()) entityBindings[instance.id] = `ent_${instance.id}`;
  return { ...base, entityBindings };
}

function solve(scope: ScopeProps, iterations = 240) {
  const compiled = compileScope(scope);
  const state = solveState(compiled, { seeds: scope.convergedSeeds, memberPins: { pinnedDofs: new Map(), slackWeight: new Map() }, config: scope.solverConfig, iterations });
  return { compiled, state };
}

describe('deterministic manifold solver', () => {
  it('converges the default construction from declarations', () => {
    const { state } = solve(createScopeDefaults());
    expect(state.dirty).toBe(true);
    expect(state.residual).toBeLessThan(1e-4);
    expect(state.converged).toBe(true);
    expect(state.iterations).toBe(240);
  });

  it('keeps a dragged point on its circle even when the pointer leaves it', () => {
    const scope = boundScope();
    const compiled = compileScope(scope);
    const pins = { pinnedDofs: new Map<string, number[]>(), slackWeight: new Map<string, number>() };
    const session = new KiteDragSession(scope, compiled, pins, 'P', 'point');
    for (let frame = 0; frame < 30; frame++) session.moveTo(460, 40, false, 14);
    const state = session.finish().state;
    const layout = compiled.dofs;
    const pSlot = layout.find(slot => slot.instanceId === 'P')!;
    const cSlot = layout.find(slot => slot.instanceId === 'c1')!;
    const mSlot = layout.find(slot => slot.instanceId === 'M')!;
    const p = { x: state.values[pSlot.offset]!, y: state.values[pSlot.offset + 1]! };
    const m = { x: state.values[mSlot.offset]!, y: state.values[mSlot.offset + 1]! };
    const radius = state.values[cSlot.offset]!;
    expect(Math.abs(Math.hypot(p.x - m.x, p.y - m.y) - radius)).toBeLessThan(0.02);
    expect(Math.hypot(p.x - 460, p.y - 40)).toBeGreaterThan(10);
    expect(state.residual).toBeLessThan(1e-2);
  });

  it('keeps perpendicular, equal-length and midpoint invariants while dragging', () => {
    const scope = boundScope();
    const compiled = compileScope(scope);
    const pins = { pinnedDofs: new Map<string, number[]>(), slackWeight: new Map<string, number>() };
    const session = new KiteDragSession(scope, compiled, pins, 'C', 'point');
    for (let frame = 0; frame < 24; frame++) session.moveTo(420, 90, false, 14);
    const state = session.finish().state;
    const offsets = new Map(compiled.dofs.map(slot => [slot.instanceId, slot.offset]));
    const get = (id: string) => ({ x: state.values[offsets.get(id)!]!, y: state.values[offsets.get(id)! + 1]! });
    const A = get('A'), B = get('B'), C = get('C'), M = get('M');
    const ab = { x: B.x - A.x, y: B.y - A.y }, bc = { x: C.x - B.x, y: C.y - B.y };
    expect(Math.abs((ab.x * bc.x + ab.y * bc.y) / (Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y)))).toBeLessThan(0.01);
    expect(Math.abs(Math.hypot(ab.x, ab.y) - Math.hypot(bc.x, bc.y))).toBeLessThan(0.05);
    expect(Math.hypot(M.x - (A.x + C.x) / 2, M.y - (A.y + C.y) / 2)).toBeLessThan(0.05);
  });

  it('detects a stale seed layout without writing', () => {
    const scope = createScopeDefaults();
    expect(seedsAreClean(compileScope(scope), {})).toBe(false);
    expect(seedsAreClean(compileScope(scope), { never: [1] })).toBe(false);
    const bound = boundScope();
    const compiled = compileScope(bound);
    const state = solveState(compiled, { seeds: {}, memberPins: { pinnedDofs: new Map(), slackWeight: new Map() }, config: bound.solverConfig, iterations: 180 });
    const seeds = seedsFromValues(compiled, state.values);
    expect(seedsAreClean(compiled, seeds)).toBe(true);
    expect(seedsAreClean(compiled, { ...seeds, ent_P: [1] })).toBe(false);
  });

  it('round-trips seeds deterministically', () => {
    const scope = boundScope();
    const first = solve(scope);
    const seeds = seedsFromValues(first.compiled, first.state.values);
    const second = solveState(first.compiled, { seeds, memberPins: { pinnedDofs: new Map(), slackWeight: new Map() }, config: scope.solverConfig, iterations: 0 });
    expect(second.dirty).toBe(false);
    expect(second.iterations).toBe(0);
    expect(second.values.length).toBe(first.state.values.length);
    for (let index = 0; index < second.values.length; index++) expect(second.values[index]).toBeCloseTo(first.state.values[index]!, 5);
    expect(seedsFromValues(first.compiled, first.state.values)).toEqual(seeds);
  });

  it('counts free / constrained / remaining DOFs for diagnostics', () => {
    const scope = boundScope();
    const compiled = compileScope(scope);
    const state = solveState(compiled, { seeds: {}, memberPins: { pinnedDofs: new Map(), slackWeight: new Map() }, config: scope.solverConfig, iterations: 240 });
    const report = analyzeScope(compiled, state);
    expect(report.totalDofs).toBe(7);
    expect(report.constrainedDofs).toBeGreaterThan(0);
    expect(report.constrainedDofs).toBeLessThanOrEqual(report.totalDofs);
    expect(report.remainingDofs).toBe(report.totalDofs - report.constrainedDofs);
    expect(report.entityCount).toBe(compiled.instances.size);
    expect(report.constraintCount).toBe(5);
    expect(report.overConstrained).toEqual([]);
    expect(report.converged).toBe(true);
  });

  it('reads member pins through the host view', () => {
    const scope = boundScope();
    const world = createMockWorld();
    for (const [substanceId, entityId] of Object.entries(scope.entityBindings)) {
      world.canonical.set(entityId, new Map([
        ['kite.member', { scopeId: 's', substanceId, primitiveKind: compiledKind(scope, substanceId), pinnedDofs: substanceId === 'C' ? [0] : [], slackWeight: 1 }],
      ]));
    }
    const compiled = compileScope(scope);
    const pins = memberPinsFrom(compiled, world.getCanonicalView());
    expect(pins.pinnedDofs.get('C')).toEqual([0]);
    const layoutPins = solveState(compiled, { seeds: {}, memberPins: pins, config: scope.solverConfig, iterations: 10 });
    expect(layoutPins.values.length).toBe(compiled.dofCount);
    // Sanity: the helper still reports the radius and a solved point.
    const layout = compiled.dofs;
    const pSlot = layout.find(slot => slot.instanceId === 'P')!;
    expect(Number.isFinite(layoutPins.values[pSlot.offset])).toBe(true);
    expect(radiusOf({ values: layoutPins.values, free: new Uint8Array(compiled.dofCount), offsets: new Map(compiled.dofs.map(slot => [slot.instanceId, { offset: slot.offset, size: slot.size, kind: slot.kind }])) }, 'c1')).toBeGreaterThan(0);
    expect(pointOf({ values: layoutPins.values, free: new Uint8Array(compiled.dofCount), offsets: new Map(compiled.dofs.map(slot => [slot.instanceId, { offset: slot.offset, size: slot.size, kind: slot.kind }])) }, 'A').x).toBe(80);
  });
});

function compiledKind(scope: ScopeProps, substanceId: string): string {
  return compileScope(scope).instances.get(substanceId)!.kind;
}
