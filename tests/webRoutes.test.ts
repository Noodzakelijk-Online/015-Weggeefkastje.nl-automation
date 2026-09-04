import { describe, expect, it } from 'vitest';
import { resolveWebScreen } from '../web/src/route.js';

describe('web screen routing', () => {
  it('keeps the resident finder at the root and isolates administration and owner links', () => {
    expect(resolveWebScreen('/')).toBe('resident');
    expect(resolveWebScreen('/beheer')).toBe('admin');
    expect(resolveWebScreen('/beheer/bronregister')).toBe('admin');
    expect(resolveWebScreen('/kastje-bijwerken/a-secure-token')).toBe('caretaker');
  });
});
