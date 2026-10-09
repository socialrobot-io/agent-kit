/**
 * Exclusive async sections for multi-call filesystem transactions.
 *
 * Use when a logical transaction spans multiple FS calls (e.g. memory
 * reload → mutate → persist). Per-call FS serialization alone cannot make
 * that atomic across concurrent callers.
 *
 * Two layers:
 *  - A filesystem can provide its own lock through {@link ExclusiveFs.exclusive}.
 *    Shared backends (Postgres, a remote volume) use it to serialize writers
 *    in different processes or machines.
 *  - Otherwise a process-local FIFO queue keyed by the filesystem object
 *    serializes writers inside one process (the AgentFS default).
 */

export type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Optional lock capability on a filesystem.
 *
 * Contract for implementers:
 *  - Run `fn` while no other `exclusive` section for the same tenant store
 *    runs, in any process that shares the store.
 *  - Reads and writes that `fn` makes on the same filesystem must see the
 *    latest committed state and must not wait for the lock that `fn` holds.
 *  - Reject with the error from `fn` when `fn` rejects.
 *
 * Callers keep `fn` short and limited to filesystem calls. Do not call a
 * model or the network inside it. Do not nest sections for the same store.
 */
export interface ExclusiveFs {
  exclusive?<T>(fn: () => Promise<T>): Promise<T>;
}

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

/**
 * Run `fn` under the filesystem's own lock when it has one
 * ({@link ExclusiveFs.exclusive}), else under the process-local queue for
 * that filesystem object.
 */
export function withExclusive<T>(fs: object & ExclusiveFs, fn: () => Promise<T>): Promise<T> {
  if (typeof fs.exclusive === "function") return fs.exclusive(fn);
  return exclusiveFor(fs)(fn);
}
