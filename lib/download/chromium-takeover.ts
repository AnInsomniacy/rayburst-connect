/** Defer filename selection until handoff settles, preserving the original request. */
export function holdChromiumDownload(
  handoff: () => Promise<boolean>,
  onError: (error: unknown) => void,
  suggest: () => void,
): true {
  void Promise.resolve().then(handoff).catch(onError).finally(suggest);
  return true;
}
