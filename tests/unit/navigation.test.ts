import { describe, it, expect } from 'vitest';
import { initNav, navigate, popTo } from '../../src/ui/navigation';

type S = { name: string; id?: string };
const eq = (a: S, b: S) => a.name === b.name && a.id === b.id;
const lib: S = { name: 'library' };
const cam: S = { name: 'camera', id: 'd' };
const doc: S = { name: 'doc', id: 'd' };
const crop: S = { name: 'crop', id: 'p' };
const filter: S = { name: 'filter', id: 'p' };

describe('screen history stack', () => {
  it('starts at the root', () => {
    expect(initNav(lib)).toEqual({ stack: [lib], index: 0 });
  });

  it('pushes a new screen, truncating any forward entries', () => {
    const r1 = navigate(initNav(lib), doc, eq);
    expect(r1.op).toEqual({ kind: 'push', index: 1 });
    expect(r1.state).toEqual({ stack: [lib, doc], index: 1 });
    const back = popTo(r1.state, 0);
    const r2 = navigate(back, cam, eq);
    expect(r2.state).toEqual({ stack: [lib, cam], index: 1 });
  });

  it('replace swaps the current entry (camera Done -> doc, crop Apply -> filter)', () => {
    const s = navigate(initNav(lib), cam, eq).state;
    const r = navigate(s, doc, eq, { replace: true });
    expect(r.op).toEqual({ kind: 'replace', index: 1 });
    expect(r.state).toEqual({ stack: [lib, doc], index: 1 });
  });

  it('navigating to a screen already below goes back to it instead of pushing (no loops)', () => {
    let s = initNav(lib);
    s = navigate(s, doc, eq).state;
    s = navigate(s, crop, eq).state;
    s = navigate(s, filter, eq, { replace: true }).state; // [lib, doc, filter]
    const r = navigate(s, doc, eq);
    expect(r.op).toEqual({ kind: 'go', delta: -1 });
    expect(r.state).toBe(s); // state moves when popstate arrives
    const toRoot = navigate(s, lib, eq);
    expect(toRoot.op).toEqual({ kind: 'go', delta: -2 });
  });

  it('navigating to the current screen is a no-op', () => {
    const s = navigate(initNav(lib), doc, eq).state;
    expect(navigate(s, { ...doc }, eq).op).toEqual({ kind: 'none' });
  });

  it('popTo moves to a known entry (back or forward) and falls back to the root otherwise', () => {
    let s = initNav(lib);
    s = navigate(s, doc, eq).state;
    s = navigate(s, crop, eq).state;
    expect(popTo(s, 1)).toEqual({ stack: [lib, doc, crop], index: 1 });
    expect(popTo(popTo(s, 0), 2).index).toBe(2); // browser Forward
    expect(popTo(s, 7).index).toBe(0); // entry from before a reload
    expect(popTo(s, undefined).index).toBe(0);
    expect(popTo(s, 'x').index).toBe(0);
  });
});
