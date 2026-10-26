// ADR-0008: the company the user is working in. The server decides what is allowed; this only
// remembers the choice in this browser so every request names the same company.
const KEY = 'vop.entity';
const listeners = new Set<() => void>();

export function getActiveEntity(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveEntity(code: string | null): void {
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the server's default company is used */
  }
  for (const fn of listeners) fn();
}

/** Called when the company changes, so cached answers for the old company are dropped. */
export function onEntityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
