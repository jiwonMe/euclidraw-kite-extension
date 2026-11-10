import { describe, expect, it } from 'vitest';
import { compileScope } from '../src/dsl/compile.ts';
import { createScopeDefaults, DEFAULT_SUBSTANCE } from '../src/defaults.ts';
import { KiteDragSession } from '../src/tools/drag-session.ts';

function freePointScope(): ReturnType<typeof createScopeDefaults> {
  return { ...createScopeDefaults(), substanceDsl: `${DEFAULT_SUBSTANCE}\nPoint Q = (200, 200)\n` };
}

describe('Shift topological snap promotion', () => {
  it('promotes a free point near a segment midpoint', () => {
    const scope = freePointScope();
    const compiled = compileScope(scope);
    const session = new KiteDragSession(scope, compiled, { pinnedDofs: new Map(), slackWeight: new Map() }, 'Q', 'point');
    for (let frame = 0; frame < 20; frame++) session.moveTo(170, 240, true, 14);
    const finished = session.finish();
    expect(finished.promotion?.kind).toBe('midpoint');
    expect(finished.promotion?.line).toBe('Midpoint(Q, A, B)');
    expect(finished.substanceDsl).toContain('Midpoint(Q, A, B)');
    expect(finished.state.residual).toBeLessThan(1e-2);
  });

  it('promotes a free point near a circle rim', () => {
    const scope = freePointScope();
    const compiled = compileScope(scope);
    const session = new KiteDragSession(scope, compiled, { pinnedDofs: new Map(), slackWeight: new Map() }, 'Q', 'point');
    for (let frame = 0; frame < 20; frame++) session.moveTo(43, 150, true, 14);
    const finished = session.finish();
    expect(finished.promotion?.kind).toBe('onCircle');
    expect(finished.promotion?.line).toBe('OnCircle(Q, c1)');
  });

  it('does not promote without Shift', () => {
    const scope = freePointScope();
    const compiled = compileScope(scope);
    const session = new KiteDragSession(scope, compiled, { pinnedDofs: new Map(), slackWeight: new Map() }, 'Q', 'point');
    for (let frame = 0; frame < 10; frame++) session.moveTo(170, 240, false, 14);
    const finished = session.finish();
    expect(finished.promotion).toBeNull();
    expect(finished.substanceDsl).not.toContain('Midpoint(Q');
  });
});
