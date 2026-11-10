import { describe, expect, it } from 'vitest';
import { measureText, parseFontSize } from '../labels.ts';
import { topologyDigest } from '../digest.ts';
import { scopeDigest } from '../schema.ts';

describe('deterministic text metrics', () => {
  it('measures without a DOM and is stable across calls', () => {
    const first = measureText('Penrose × alid', 14);
    expect(first).toEqual(measureText('Penrose × alid', 14));
    expect(first.width).toBeGreaterThan(50);
    expect(first.height).toBeCloseTo(16.8, 5);
    expect(first.ascent + first.descent).toBeCloseTo(16.8, 5);
  });

  it('treats Hangul as full width and unknown glyphs as a constant', () => {
    expect(measureText('한글', 10).width).toBeCloseTo(20, 5);
    expect(measureText('\u2603', 10).width).toBeCloseTo(5.56, 2);
  });

  it('parses CSS font sizes', () => {
    expect(parseFontSize('14px')).toBe(14);
    expect(parseFontSize('1.5em')).toBe(24);
    expect(parseFontSize(undefined)).toBe(14);
    expect(parseFontSize('12pt')).toBe(16);
  });
});

describe('topology digest', () => {
  const source = { domainDsl: 'type A', substanceDsl: 'A a', styleDsl: 'forall A a {}' };

  it('changes with the trio, variation and engine version', () => {
    const base = scopeDigest(source, '0');
    expect(scopeDigest(source, '0')).toBe(base);
    expect(scopeDigest(source, '1')).not.toBe(base);
    expect(scopeDigest({ ...source, styleDsl: 'x' }, '0')).not.toBe(base);
  });

  it('is a fixed-width, length-suffixed key', () => {
    expect(topologyDigest(['a', 1])).toMatch(/^[0-9a-f]{16}-[0-9a-f]+$/);
  });
});
