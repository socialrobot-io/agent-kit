/**
 * Process-local exclusive async queues.
 *
 * Use when a logical transaction spans multiple FS calls (e.g. memory
 * reload → mutate → persist). Per-call FS serialization alone cannot make
 * that atomic across concurrent callers.
 */

export type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

/** Create a new FIFO async mutex. */
export function createExclusiveQueue(): Exclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

/** One queue per object identity (e.g. shared tenant volume / InMemoryFs). */
const queues = new WeakMap<object, Exclusive>();

/**
 * Return the exclusive queue for `key`. All callers that pass the same object
 * share one mutex for the process lifetime of that object.
 */
export function exclusiveFor(key: object): Exclusive {
  let q = queues.get(key);
  if (!q) {
    q = createExclusiveQueue();
    queues.set(key, q);
  }
  return q;
}
