import { describe, expect, it } from 'vitest';
import { createMockHost } from './harness.ts';
import { applyDsl, insertDiagram } from '../src/tools/documents.ts';
import { deriveMember, memberAspect } from '../src/aspects.ts';
import { memberSvg } from '../src/render/member.ts';
import { toWorld, toLocal } from '../src/geometry.ts';
import type { ComputedReadView, DerivedGeometry, EntityId, MemberProps, ScopeProps } from '../src/types.ts';

function setup() {
  const host = createMockHost();
  const scopeId = insertDiagram(host.context);
  const scope = host.world.getCanonical<ScopeProps>(scopeId, 'kite.scope')!;
  return { host, scopeId, scope };
}

function derivedOf(host: ReturnType<typeof createMockHost>, entityId: EntityId): DerivedGeometry | undefined {
  const props = host.world.getCanonical<MemberProps>(entityId, 'kite.member')!;
  return deriveMember(props, entityId, host.world.getCanonicalView());
}

describe('pure member projection and SVG output', () => {
  it('projects every default member without writing', () => {
    const { host, scope } = setup();
    const before = host.writes();
    const values = Object.values(scope.entityBindings);
    expect(values.length).toBeGreaterThan(8);
    for (const entityId of values) {
      const geometry = derivedOf(host, entityId);
      expect(geometry).toBeDefined();
      for (const value of [geometry!.x, geometry!.y, geometry!.width, geometry!.height]) expect(Number.isFinite(value)).toBe(true);
      expect(geometry!.width).toBeGreaterThan(0);
      expect(geometry!.height).toBeGreaterThan(0);
    }
    expect(host.writes()).toBe(before);
    host.dispose();
  });

  it('renders the same headless SVG twice with no foreignObject', () => {
    const { host, scope } = setup();
    const segment = Object.entries(scope.entityBindings).find(([, id]) => host.world.getCanonical<MemberProps>(id, 'kite.member')?.substanceId === 'AB')!;
    const props = host.world.getCanonical<MemberProps>(segment[1], 'kite.member')!;
    const derived = deriveMember(props, segment[1], host.world.getCanonicalView())!;
    const first = memberSvg(derived);
    const second = memberSvg(derivedOf(host, segment[1])!);
    expect(first).toBe(second);
    expect(first).toContain('<line');
    expect(first).not.toContain('foreignObject');
    expect(first).not.toContain('url(');
    expect(first).not.toContain('<script');
    host.dispose();
  });

  it('draws numeric labels, ticks and right-angle badges as pure paths', () => {
    const { host, scope } = setup();
    const values = Object.values(scope.entityBindings);
    const svg = values.map(id => {
      const props = host.world.getCanonical<MemberProps>(id, 'kite.member')!;
      const derived = deriveMember(props, id, host.world.getCanonicalView());
      return derived ? memberSvg(derived) : '';
    }).join('');
    expect(svg).toContain('<circle');
    expect(svg).toContain('<line');
    expect(svg).toContain('<path');
    expect(svg).toContain('c₁');
    expect(svg).toContain('90°');
    host.dispose();
  });

  it('escapes document text before it reaches SVG', () => {
    const { host, scopeId } = setup();
    host.selection.splice(0, host.selection.length, scopeId);
    applyDsl(host.context, { entityId: scopeId, substanceDsl: `${host.world.getCanonical<ScopeProps>(scopeId, 'kite.scope')!.substanceDsl}\nLabel evil = "<script>alert(1)</script>" at point A offset (0, 0)` });
    const scope = host.world.getCanonical<ScopeProps>(scopeId, 'kite.scope')!;
    const evil = scope.entityBindings.evil!;
    const svg = memberSvg(derivedOf(host, evil)!);
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).not.toContain('<script>');
    host.dispose();
  });

  it('uses the same world transform for solve and hit testing', () => {
    const { host, scopeId } = setup();
    const transform = host.world.getCanonical<{ x: number; y: number; rotation: number }>(scopeId, 'core.transform')!;
    const bounds = host.world.getCanonical<{ width: number; height: number }>(scopeId, 'core.bounds')!;
    const box = { ...transform, width: bounds.width, height: bounds.height };
    const world = toWorld(box, 100, 80);
    const local = toLocal(box, world.x, world.y);
    expect(local.x).toBeCloseTo(100, 6);
    expect(local.y).toBeCloseTo(80, 6);
    host.dispose();
  });

  it('exposes exact selection geometry for members', () => {
    const { host, scope } = setup();
    const pointId = scope.entityBindings.P!;
    const derived = derivedOf(host, pointId)!;
    const view: ComputedReadView = {
      getCanonical: () => undefined,
      getComputed: <T>(id: EntityId) => id === pointId ? derived as unknown as T : undefined,
      isAlive: () => true,
    };
    const center = derived.points[0]!;
    expect(memberAspect.selection!.hitTest(pointId, view, center.x, center.y, 1)).toBe(0);
    expect(memberAspect.selection!.hitTest(pointId, view, center.x + 40, center.y, 1)).toBeGreaterThan(8);
    expect(memberAspect.selection!.getBounds(pointId, view, { x: 0, y: 0, width: 0, height: 0 })).toBe(true);
    expect(memberAspect.selection!.canTransform!(pointId, view)).toBe(false);
    host.dispose();
  });
});
