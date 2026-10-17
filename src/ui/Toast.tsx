import { useEffect, useState } from 'preact/hooks';

export type ToastKind = 'info' | 'error';
interface Item { id: number; msg: string; kind: ToastKind }

const DURATION_MS = 4000;
let items: Item[] = [];
let seq = 0;
const subs = new Set<(items: Item[]) => void>();

const emit = () => subs.forEach((cb) => cb(items));

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(msg: string, kind: ToastKind = 'info'): void {
  const id = ++seq;
  items = [...items, { id, msg, kind }];
  emit();
  setTimeout(() => dismiss(id), DURATION_MS);
}

export function Toast() {
  const [list, setList] = useState<Item[]>(items);
  useEffect(() => {
    subs.add(setList);
    setList(items);
    return () => {
      subs.delete(setList);
    };
  }, []);
  return (
    <div class="toasts">
      {list.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.msg}</span>
          <button type="button" class="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
