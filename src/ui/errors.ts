import { toast } from './Toast';

export const QUOTA_MESSAGE = 'Storage full — delete some scans';

export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

/** Toasts a storage-full message for quota errors, `fallback` otherwise. */
export function reportError(err: unknown, fallback: string): void {
  console.warn(fallback, err);
  toast(isQuotaError(err) ? QUOTA_MESSAGE : fallback, 'error');
}
