import { useEffect, useState } from 'preact/hooks';
import { getPage } from '../store/store';
import type { Page } from '../types';
import { reportError } from './errors';

/** Loads a page by id; `null` while loading or if missing. */
export function usePage(pageId: string): Page | null {
  const [page, setPage] = useState<Page | null>(null);
  useEffect(() => {
    let live = true;
    setPage(null);
    getPage(pageId).then(
      (p) => live && setPage(p ?? null),
      (e) => reportError(e, 'Could not load page'),
    );
    return () => {
      live = false;
    };
  }, [pageId]);
  return page;
}
