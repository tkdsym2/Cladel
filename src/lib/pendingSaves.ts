/**
 * Registry of debounced editor saves that have not reached the DB yet.
 *
 * Editors (Core / Note / Translate settings) save a short while after the last
 * keystroke. Anything that swaps or snapshots the document — switching tabs,
 * saving the file, closing a detached window — must first `flushPendingSaves()`,
 * otherwise the last keystrokes are lost (or, after a tab switch, sent to the
 * other tab's database).
 */
type Flusher = () => Promise<void> | void;

const flushers = new Set<Flusher>();

/** Register a flusher; returns the unregister function (use as an effect cleanup). */
export function registerPendingSave(flusher: Flusher): () => void {
  flushers.add(flusher);
  return () => {
    flushers.delete(flusher);
  };
}

/** Write every pending editor save now. Never rejects. */
export async function flushPendingSaves(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => Promise.resolve().then(f)));
}
