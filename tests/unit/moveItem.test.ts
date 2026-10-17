import { describe, it, expect } from 'vitest';
import { moveItem } from '../../src/ui/moveItem';

describe('moveItem', () => {
  it('moves an item forward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('moves an item backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('returns an equal copy when from === to', () => {
    const arr = ['a', 'b'];
    const out = moveItem(arr, 1, 1);
    expect(out).toEqual(arr);
    expect(out).not.toBe(arr);
  });
  it('does not mutate the input', () => {
    const arr = [1, 2, 3];
    moveItem(arr, 0, 2);
    expect(arr).toEqual([1, 2, 3]);
  });
  it('clamps out-of-range targets', () => {
    expect(moveItem([1, 2, 3], 0, 10)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, -5)).toEqual([3, 1, 2]);
  });
  it('returns a copy for an out-of-range source', () => {
    expect(moveItem([1, 2, 3], 7, 0)).toEqual([1, 2, 3]);
  });
});
