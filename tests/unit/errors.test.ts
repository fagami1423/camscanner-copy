import { describe, it, expect } from 'vitest';
import { isQuotaError } from '../../src/ui/errors';

describe('isQuotaError', () => {
  it('detects QuotaExceededError DOMExceptions', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
  });
  it('ignores other errors', () => {
    expect(isQuotaError(new DOMException('x', 'AbortError'))).toBe(false);
    expect(isQuotaError(new Error('QuotaExceededError'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });
});
