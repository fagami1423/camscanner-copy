import { describe, it, expect } from 'vitest';
import { fitWithin } from '../../src/image';

describe('fitWithin', () => {
  it('downscales preserving aspect', () => {
    expect(fitWithin(4000, 3000, 480)).toEqual({ width: 480, height: 360 });
  });
  it('clamps each dimension to at least 1 px', () => {
    expect(fitWithin(10000, 10, 480)).toEqual({ width: 480, height: 1 });
    expect(fitWithin(10, 10000, 480)).toEqual({ width: 1, height: 480 });
  });
  it('never upscales', () => {
    expect(fitWithin(100, 50, 480)).toEqual({ width: 100, height: 50 });
  });
});
