/**
 * Chromium waits at most 15 seconds for an extension to name a download, then
 * names it itself and reports any later `suggest()` as an error
 * (`determine_filename_timeout_` in downloads_api.cc).
 */
export const CHROMIUM_FILENAME_DEADLINE_MS = 12_000;

/**
 * Defer filename selection until handoff settles, preserving the original request.
 * A claimed download is already cancelled, so only a released one gets a filename.
 * A handoff still open near Chromium's deadline names the paused download then.
 */
export function holdChromiumDownload(
  handoff: () => Promise<boolean>,
  onError: (error: unknown) => void,
  suggest: () => void,
): true {
  let suggested = false;
  const release = () => {
    if (suggested) return;
    suggested = true;
    suggest();
  };
  const deadline = setTimeout(release, CHROMIUM_FILENAME_DEADLINE_MS);
  void Promise.resolve()
    .then(handoff)
    .catch((error: unknown) => {
      onError(error);
      return false;
    })
    .then((claimed) => {
      clearTimeout(deadline);
      if (!claimed) release();
    });
  return true;
}
