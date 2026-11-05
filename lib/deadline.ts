/**
 * Settles with `fallback()` when `work` takes longer than `ms`. The work goes
 * on; only the wait for it ends, so one stuck browser or native call cannot
 * hold every later download (#108).
 */
export function withDeadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback()), ms);
    }),
  ]);
}
