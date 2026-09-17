import { detectMedia } from './detection';
import type { MediaObservations } from './messages';

/** Observe public DOM and resource timing only. Player functions and response bodies are untouched. */
export function observePageMedia(send: (message: MediaObservations) => Promise<unknown>) {
  type Observation = MediaObservations['observations'][number];
  const seen = new Set<string>();
  const roots = new Set<Document | ShadowRoot>();
  const scanRoots = new Set<Document | ShadowRoot | Element>();
  const pending: Observation[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  function publish(observation: Observation) {
    if (stopped || !detectMedia(observation)) return;
    const key = `${observation.evidence}:${observation.url}:${observation.mime ?? ''}`;
    if (seen.has(key)) return;
    if (seen.size >= 256) seen.delete(seen.values().next().value ?? '');
    seen.add(key);
    pending.push(observation);
    timer ??= setTimeout(flush, 150);
  }

  function flush() {
    timer = undefined;
    if (stopped || !pending.length) return;
    const observations = pending.splice(0, 32);
    void send({
      type: 'MEDIA_OBSERVATIONS',
      title: document.title.slice(0, 512),
      observations,
    }).catch(() => undefined);
    if (pending.length) timer = setTimeout(flush, 150);
  }

  function inspect(element: Element) {
    if (element instanceof HTMLMediaElement) {
      const elementType = element instanceof HTMLVideoElement ? 'video' : 'audio';
      for (const url of new Set([element.currentSrc, element.src].filter(Boolean)))
        publish({ url, elementType, evidence: 'element' });
      for (const source of element.querySelectorAll('source')) {
        if (source.src)
          publish({
            url: source.src,
            elementType,
            evidence: 'element',
            mime: source.type.slice(0, 128),
          });
      }
    }
  }

  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'attributes' && change.target instanceof Element) {
        inspect(change.target.closest('video,audio') ?? change.target);
      }
      for (const node of change.addedNodes) if (node instanceof Element) scheduleScan(node);
    }
    if (changes.some((change) => change.removedNodes.length > 0)) {
      const detached = [...roots].filter(
        (root) => root instanceof ShadowRoot && !root.host.isConnected,
      );
      if (detached.length) {
        observer.disconnect();
        for (const root of detached) {
          roots.delete(root);
          for (const event of ['loadedmetadata', 'loadstart', 'play'])
            root.removeEventListener(event, mediaEvent, true);
        }
        for (const root of roots)
          observer.observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['src', 'type'],
          });
      }
    }
  });

  function attach(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'type'],
    });
    for (const event of ['loadedmetadata', 'loadstart', 'play'])
      root.addEventListener(event, mediaEvent, true);
  }

  function mediaEvent(event: Event) {
    if (event.target instanceof Element) inspect(event.target);
  }

  function scan(root: Document | ShadowRoot | Element) {
    if (root instanceof Element) {
      if (!root.isConnected) return;
      inspect(root);
      if (root instanceof HTMLSourceElement && root.parentElement) inspect(root.parentElement);
      if (root.shadowRoot) scan(root.shadowRoot);
    } else attach(root);
    root.querySelectorAll('video,audio').forEach(inspect);
    // Open shadow trees have independent mutation and event boundaries.
    for (const element of root.querySelectorAll('*'))
      if (element.shadowRoot) scan(element.shadowRoot);
  }

  function scheduleScan(root: Document | ShadowRoot | Element = document) {
    if (stopped) return;
    if (scanRoots.size >= 128) {
      scanRoots.clear();
      scanRoots.add(document);
    } else if (!scanRoots.has(document)) scanRoots.add(root);
    if (scanTimer !== undefined) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      for (const target of scanRoots) scan(target);
      scanRoots.clear();
    }, 350);
  }

  const resources = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) publish({ url: entry.name, evidence: 'resource' });
  });
  resources.observe({ type: 'resource', buffered: true });
  attach(document);
  scheduleScan();

  function rescan() {
    seen.clear();
    for (const entry of performance.getEntriesByType('resource'))
      publish({ url: entry.name, evidence: 'resource' });
    scheduleScan();
  }

  function stop() {
    stopped = true;
    observer.disconnect();
    resources.disconnect();
    clearTimeout(timer);
    clearTimeout(scanTimer);
    for (const root of roots)
      for (const event of ['loadedmetadata', 'loadstart', 'play'])
        root.removeEventListener(event, mediaEvent, true);
    roots.clear();
    scanRoots.clear();
    pending.length = 0;
    seen.clear();
  }
  return { stop, rescan };
}
