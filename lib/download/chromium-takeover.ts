export type ChromiumCancellation = { ok: true } | { ok: false; error: unknown };

/** Cancel within the filename event turn and immediately observe rejection. */
export function startChromiumTakeover(
  cancel: () => Promise<void>,
  continueTakeover: (cancellation: Promise<ChromiumCancellation>) => Promise<void>,
  onError: (error: unknown) => void,
  releaseFilename: () => void,
): true | undefined {
  let cancellation: Promise<ChromiumCancellation>;
  try {
    cancellation = cancel().then(
      () => ({ ok: true }),
      (error: unknown) => {
        releaseFilename();
        return { ok: false, error };
      },
    );
  } catch (error) {
    onError(error);
    return;
  }

  void continueTakeover(cancellation).catch(onError);
  // Cancellation terminates filename determination. Suppress Chromium's
  // implicit suggest(), which would otherwise target the cancelled download.
  return true;
}
