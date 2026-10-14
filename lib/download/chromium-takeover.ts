/**
 * Defer filename selection until handoff settles, preserving the original request.
 * A claimed download is already cancelled, so only a released one gets a filename.
 */
export function holdChromiumDownload(
  handoff: () => Promise<boolean>,
  onError: (error: unknown) => void,
  suggest: () => void,
): true {
  void Promise.resolve()
    .then(handoff)
    .catch((error: unknown) => {
      onError(error);
      return false;
    })
    .then((claimed) => {
      if (!claimed) suggest();
    });
  return true;
}
