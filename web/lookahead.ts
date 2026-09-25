// Runs up to `window` tasks ahead of the consumer and yields their results in
// index order. Work in progress stays bounded: a new task starts only after an
// earlier result has been taken. Aborting starts nothing new; failures of
// tasks that are never consumed are absorbed rather than left unhandled.
export async function* inOrder<T>(
  count: number,
  window: number,
  start: (index: number) => Promise<T>,
  signal?: AbortSignal,
): AsyncGenerator<T, void, undefined> {
  if (!Number.isInteger(window) || window < 1)
    throw new Error("The lookahead window must be a positive whole number.");
  const pending: Promise<T>[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    while (next < count && pending.length < window) {
      const index = next++;
      // A synchronous throw becomes this task's rejection, raised in order.
      const task = new Promise<T>((resolve) => resolve(start(index)));
      task.catch(() => {});
      pending.push(task);
    }
    yield await pending.shift()!;
  }
}
