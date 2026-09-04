export type WebScreen = 'resident' | 'admin' | 'caretaker';

export function resolveWebScreen(pathname: string): WebScreen {
  if (pathname.startsWith('/beheer')) return 'admin';
  if (pathname.startsWith('/kastje-bijwerken/')) return 'caretaker';
  return 'resident';
}
