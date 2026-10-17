/** Returns a copy of `arr` with the item at `from` moved to index `to` (clamped). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}
