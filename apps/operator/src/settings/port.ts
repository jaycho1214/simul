/** The range a TCP port the server can bind falls in; mirrors normalizeSettings. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/**
 * What the engineer typed into the port field, as a number the settings store
 * would accept — or null for anything it would silently reset to the default,
 * so the panel can refuse it while the field is still open rather than have
 * the QR quietly go back to 8080.
 */
export function parsePort(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= MIN_PORT && n <= MAX_PORT ? n : null;
}
