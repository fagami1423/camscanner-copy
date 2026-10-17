/**
 * Screen history as a stack mirrored onto browser history (one entry per screen, `{ idx }` as the
 * history state). The root (index 0) is the first app entry, so Back from it leaves the app natively.
 */
export interface NavState<T> {
  stack: T[];
  index: number;
}

export type NavOp =
  | { kind: 'push'; index: number } // history.pushState({ idx: index })
  | { kind: 'replace'; index: number } // history.replaceState({ idx: index })
  | { kind: 'go'; delta: number } // history.go(delta); the state moves on the resulting popstate
  | { kind: 'none' };

export function initNav<T>(root: T): NavState<T> {
  return { stack: [root], index: 0 };
}

/**
 * Plans a navigation to `target`. A screen already below the current one is reached by going back
 * to it (so Back never cycles through stale screens); `replace` swaps the current entry; otherwise
 * the target is pushed and any forward entries are dropped.
 */
export function navigate<T>(
  s: NavState<T>,
  target: T,
  eq: (a: T, b: T) => boolean,
  opts: { replace?: boolean } = {},
): { state: NavState<T>; op: NavOp } {
  if (eq(s.stack[s.index], target)) return { state: s, op: { kind: 'none' } };
  for (let j = s.index - 1; j >= 0; j--) {
    if (eq(s.stack[j], target)) return { state: s, op: { kind: 'go', delta: j - s.index } };
  }
  if (opts.replace) {
    const stack = [...s.stack.slice(0, s.index), target];
    return { state: { stack, index: s.index }, op: { kind: 'replace', index: s.index } };
  }
  const index = s.index + 1;
  return { state: { stack: [...s.stack.slice(0, index), target], index }, op: { kind: 'push', index } };
}

/** Applies a popstate to entry `idx`; unknown entries (e.g. from before a reload) map to the root. */
export function popTo<T>(s: NavState<T>, idx: unknown): NavState<T> {
  const ok = typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < s.stack.length;
  return { stack: s.stack, index: ok ? idx : 0 };
}
