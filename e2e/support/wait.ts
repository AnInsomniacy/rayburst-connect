/** Poll until `check` returns a value; its last error or value explains a timeout. */
export async function until<T>(
  what: string,
  check: () => Promise<T | false | undefined | null>,
  { timeout = 30_000, every = 500 } = {},
): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
      last = value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  const reason = last instanceof Error ? last.message : JSON.stringify(last);
  throw new Error(`Timed out waiting for ${what}: ${reason}`);
}
