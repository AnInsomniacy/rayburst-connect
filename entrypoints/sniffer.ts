/** Page-world instrumentation. Never receives extension credentials or privileged commands. */
export default defineUnlistedScript(() => {
  const marker = '__rayburstSniffer';
  if (Reflect.get(window, marker)) return;
  Reflect.set(window, marker, true);
  const nativeFetch = window.fetch;
  const NativeBytes = Uint8Array;
  const nativeBtoa = window.btoa;
  const nativeParse = JSON.parse;
  const nativeDecode = TextDecoder.prototype.decode;
  const nativeAtob = window.atob;
  const nativePost = window.postMessage.bind(window);
  const MAX_TEXT = 512 * 1024;
  const found = new Set<string>();
  let foundBytes = 0;
  const restorers: (() => void)[] = [];
  let active = false;
  let capture = false;
  let recorder: MediaRecorder | undefined;
  const recorders = new Set<MediaRecorder>();
  let captureEpoch = 0;
  let sessionId = '';
  let stopping = false;
  let captureError: string | undefined;
  let ownedSource: MediaSource | undefined;
  let panel: HTMLElement | undefined;
  let streamIndex = 0;
  let labels: Record<string, string> = {};
  let theme: Record<string, string> = {};
  let pendingBytes = 0;
  let queue = Promise.resolve();
  const acknowledgements = new Map<string, (ok: boolean) => void>();
  const send = (data: Record<string, unknown>) =>
    nativePost({ channel: 'rayburst-observation', sessionId, ...data }, location.origin);

  function remember(value: string) {
    if (found.has(value)) return false;
    while (found.size && (found.size >= 512 || foundBytes + value.length * 2 > 2 * 1024 * 1024)) {
      const first = found.values().next().value!;
      foundBytes -= first.length * 2;
      found.delete(first);
    }
    found.add(value);
    foundBytes += value.length * 2;
    return true;
  }

  function key(value: string | ArrayBuffer | ArrayBufferView) {
    let bytes: Uint8Array;
    if (typeof value === 'string') {
      if (/^[a-f\d]{32}$/i.test(value))
        bytes = NativeBytes.from(value.match(/../g) ?? [], (hex) => parseInt(hex, 16));
      else if (/^[A-Za-z\d+/]{22}==$/.test(value)) {
        try {
          bytes = NativeBytes.from(nativeAtob(value), (c) => c.charCodeAt(0));
        } catch {
          return;
        }
      } else return;
    } else
      bytes =
        value instanceof ArrayBuffer
          ? new NativeBytes(value)
          : new NativeBytes(value.buffer, value.byteOffset, value.byteLength);
    if (bytes.length !== 16 || bytes.every((byte) => byte === 0)) return;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!remember(`key:${hex}`)) return;
    send({ type: 'key', key: hex });
  }
  function text(value: string, source = location.href) {
    if (!active || value.length > MAX_TEXT) return;
    key(value);
    const trimmed = value.trimStart();
    const kind = trimmed.startsWith('#EXTM3U')
      ? 'hls'
      : /^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(trimmed)
        ? 'dash'
        : undefined;
    if (kind) {
      const identity = `${source}:${value}`;
      if (!remember(identity)) return;
      const address =
        source === location.href
          ? new URL(
              `rayburst-captured-${crypto.randomUUID()}.${kind === 'hls' ? 'm3u8' : 'mpd'}`,
              document.baseURI,
            ).href
          : source;
      send({ type: 'manifest', url: address, kind, content: value });
      return;
    }
    if (/^https?:\/\//i.test(value) && value.length <= 16384) {
      if (remember(value)) send({ type: 'url', url: value });
      return;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        inspect(nativeParse(value));
      } catch {
        /* Non-JSON text is not evaluated. */
      }
    }
    for (const match of value.matchAll(
      /https?:\/\/[^\s"'<>\\]{1,16300}\.(?:m3u8|mpd)(?:\?[^\s"'<>\\]*)?/gi,
    ))
      send({ type: 'url', url: match[0] });
  }
  function inspect(value: unknown) {
    const pending: [unknown, number][] = [[value, 0]];
    const seen = new WeakSet<object>();
    for (let count = 0; pending.length && count < 1000; count++) {
      const [item, depth] = pending.pop()!;
      if (typeof item === 'string') text(item);
      else if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) key(item);
      else if (item && typeof item === 'object' && depth < 8 && !seen.has(item)) {
        seen.add(item);
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const words: unknown = descriptors.words?.value;
        if (
          descriptors.sigBytes?.value === 16 &&
          Array.isArray(words) &&
          words.length >= 4 &&
          words.slice(0, 4).every(Number.isInteger)
        ) {
          const bytes = new ArrayBuffer(16);
          const view = new DataView(bytes);
          words.slice(0, 4).forEach((word: number, index) => view.setInt32(index * 4, word));
          key(bytes);
        }
        if (
          Array.isArray(item) &&
          item.length === 16 &&
          item.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
        )
          key(new NativeBytes(item));
        // Descriptors avoid invoking arbitrary page getters.
        for (const descriptor of Object.values(descriptors).slice(0, 256))
          if ('value' in descriptor) pending.push([descriptor.value, depth + 1]);
      }
    }
  }
  async function responseBody(response: Response, source: string) {
    if (
      !response.body ||
      !response.ok ||
      Number(response.headers.get('content-length') ?? 0) > MAX_TEXT
    )
      return;
    const mime = response.headers.get('content-type') ?? '';
    if (/^(?:video|audio|image)\//i.test(mime) && !/mpegurl/i.test(mime)) return;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_TEXT) return;
        chunks.push(value);
      }
      const bytes = new NativeBytes(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (size === 16) key(bytes);
      else text(nativeDecode.call(new TextDecoder(), bytes), response.url || source);
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  function patch<T extends object, K extends keyof T>(object: T, name: K, value: T[K]) {
    const original = object[name];
    object[name] = value;
    restorers.push(() => {
      if (object[name] === value) object[name] = original;
    });
  }
  function deep() {
    patch(window, 'fetch', function (this: Window, ...args: Parameters<typeof fetch>) {
      const promise = Reflect.apply(nativeFetch, this, args) as Promise<Response>;
      void promise
        .then((response) => {
          if (active) void responseBody(response.clone(), String(args[0])).catch(() => undefined);
        })
        .catch(() => undefined);
      return promise;
    });
    const open = XMLHttpRequest.prototype.open;
    // Proxy preserves every overload and the native return/throw behavior.
    patch(
      XMLHttpRequest.prototype,
      'open',
      new Proxy(open, {
        apply(target, self: XMLHttpRequest, args) {
          self.addEventListener(
            'load',
            () => {
              if (!active) return;
              try {
                if (self.responseType === 'json') inspect(self.response);
                else if (
                  self.responseType === 'arraybuffer' &&
                  self.response instanceof ArrayBuffer
                ) {
                  if (self.response.byteLength === 16) key(self.response);
                  else if (self.response.byteLength <= MAX_TEXT)
                    text(nativeDecode.call(new TextDecoder(), self.response), self.responseURL);
                } else if (self.responseType === '' || self.responseType === 'text')
                  text(self.responseText, self.responseURL);
              } catch {
                /* A page can revoke access to its response. */
              }
            },
            { once: true },
          );
          return Reflect.apply(target, self, args);
        },
      }),
    );
    patch(
      JSON,
      'parse',
      new Proxy(nativeParse, {
        apply(target, self, args) {
          const value: unknown = Reflect.apply(target, self, args);
          if (active) inspect(value);
          return value;
        },
      }),
    );
    patch(
      TextDecoder.prototype,
      'decode',
      new Proxy(nativeDecode, {
        apply(target, self, args) {
          const value = Reflect.apply(target, self, args) as string;
          if (active) text(value);
          return value;
        },
      }),
    );
    patch(
      window,
      'atob',
      new Proxy(nativeAtob, {
        apply(target, self, args) {
          const value = Reflect.apply(target, self, args) as string;
          if (active) {
            if (value.length === 16) key(NativeBytes.from(value, (c) => c.charCodeAt(0)));
            else text(value);
          }
          return value;
        },
      }),
    );
    patch(
      window,
      'btoa',
      new Proxy(nativeBtoa, {
        apply(target, self, args) {
          const result = Reflect.apply(target, self, args) as string;
          if (active) key(result);
          return result;
        },
      }),
    );
    if (crypto.subtle) {
      const importKey = crypto.subtle.importKey;
      patch(
        crypto.subtle,
        'importKey',
        new Proxy(importKey, {
          apply(target, self, args) {
            if (
              active &&
              args[0] === 'raw' &&
              (args[1] instanceof ArrayBuffer || ArrayBuffer.isView(args[1]))
            )
              key(args[1]);
            return Reflect.apply(target, self, args);
          },
        }),
      );
    }
    patch(
      NativeBytes.prototype,
      'set',
      new Proxy(NativeBytes.prototype.set, {
        apply(target, self, args) {
          const result: unknown = Reflect.apply(target, self, args);
          if (active && self instanceof NativeBytes && self.byteLength === 16) key(self);
          return result;
        },
      }),
    );
    patch(
      NativeBytes.prototype,
      'subarray',
      new Proxy(NativeBytes.prototype.subarray, {
        apply(target, self, args) {
          const result = Reflect.apply(target, self, args) as Uint8Array;
          if (active && result.byteLength === 16) key(result);
          return result;
        },
      }),
    );
    for (const element of document.querySelectorAll(
      'script[type="application/json"],script[type="application/ld+json"]',
    ))
      text(element.textContent ?? '');
  }

  function append(blob: Blob, stream: number, mime: string, offsetMs = 0) {
    if (!capture || captureError || !blob.size) return;
    if (pendingBytes + blob.size > 16 * 1024 * 1024 || stream > 31) {
      stop('capture_overflow');
      return;
    }
    pendingBytes += blob.size;
    queue = queue
      .then(async () => {
        for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
          const id = crypto.randomUUID();
          let delivered = false;
          for (let attempt = 0; attempt < 3 && !delivered; attempt++) {
            try {
              const acknowledged = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  acknowledgements.delete(id);
                  reject(new Error('capture_timeout'));
                }, 15000);
                acknowledgements.set(id, (ok) => {
                  clearTimeout(timeout);
                  acknowledgements.delete(id);
                  if (ok) resolve();
                  else reject(new Error('capture_failed'));
                });
              });
              send({
                type: 'chunk',
                id,
                stream,
                mime,
                offsetMs,
                blob: blob.slice(offset, offset + 256 * 1024),
              });
              await acknowledged;
              delivered = true;
            } catch {
              if (attempt === 2) throw new Error('capture_failed');
            }
          }
        }
      })
      .finally(() => {
        pendingBytes -= blob.size;
      })
      .catch(() => stop('capture_failed'));
  }
  function cache() {
    const add = MediaSource.prototype.addSourceBuffer;
    patch(
      MediaSource.prototype,
      'addSourceBuffer',
      new Proxy(add, {
        apply(target, self: MediaSource, args) {
          const buffer = Reflect.apply(target, self, args) as SourceBuffer;
          let stream: number | undefined;
          let mime = String(args[0]);
          if (buffer.changeType)
            patch(
              buffer,
              'changeType',
              new Proxy(buffer.changeType, {
                apply(fn, source, values) {
                  const result: unknown = Reflect.apply(fn, source, values);
                  if (capture && ownedSource === self && String(values[0]) !== mime)
                    stop('capture_format_changed');
                  mime = String(values[0]);
                  return result;
                },
              }),
            );
          const nativeAppend = buffer.appendBuffer;
          patch(
            buffer,
            'appendBuffer',
            new Proxy(nativeAppend, {
              apply(fn, source, values) {
                const value = values[0] as BufferSource;
                if (!capture || (ownedSource && ownedSource !== self))
                  return Reflect.apply(fn, source, values);
                if (value.byteLength + pendingBytes > 16 * 1024 * 1024) {
                  stop('capture_overflow');
                  return Reflect.apply(fn, source, values);
                }
                // Copy before a player reuses or transfers its buffer.
                const data = ArrayBuffer.isView(value)
                  ? new NativeBytes(value.buffer, value.byteOffset, value.byteLength).slice()
                  : new NativeBytes(value).slice();
                const result: unknown = Reflect.apply(fn, source, values);
                ownedSource ??= self;
                stream ??= streamIndex++;
                if (capture) append(new Blob([data]), stream, mime);
                return result;
              },
            }),
          );
          return buffer;
        },
      }),
    );
  }
  function record(stream: MediaStream) {
    const audioOnly = stream.getVideoTracks().length === 0;
    const mimeType = (
      audioOnly
        ? ['audio/webm;codecs=opus', 'audio/mp4']
        : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4']
    ).find((mime) => MediaRecorder.isTypeSupported(mime));
    const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder = current;
    recorders.add(current);
    const index = streamIndex++;
    const offsetMs = Math.max(0, Math.round(performance.now() - captureEpoch));
    current.addEventListener('dataavailable', (event) =>
      append(event.data, index, event.data.type, offsetMs),
    );
    current.addEventListener('stop', () => {
      recorders.delete(current);
      if (recorder === current) recorder = undefined;
      if (!recorders.size) stop();
    });
    current.addEventListener('error', () => stop('capture_failed'));
    current.start(1000);
    return current;
  }
  function controls(mode: string) {
    if (panel || !document.documentElement) return;
    panel = document.createElement('div');
    for (const [name, value] of Object.entries(theme))
      if (name.startsWith('--color-')) panel.style.setProperty(name, value);
    const shadow = panel.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{all:initial;position:fixed;top:16px;right:16px;z-index:2147483647}section{font:14px system-ui;color:var(--color-on-surface);background:var(--color-surface-container);padding:12px;border:1px solid var(--color-outline-variant);border-radius:12px;display:flex;gap:8px;align-items:center}button{font:inherit;padding:8px 12px;background:var(--color-primary);color:var(--color-on-primary);border:0;border-radius:6px;cursor:pointer}';
    const section = document.createElement('section');
    const label = document.createElement('span');
    label.textContent = `Rayburst · ${labels[mode] ?? mode}`;
    const start = document.createElement('button');
    start.textContent = labels.start ?? 'Start';
    const finish = document.createElement('button');
    finish.textContent = labels.stop ?? 'Stop';
    finish.onclick = () => stop();
    start.onclick = async () => {
      start.disabled = true;
      try {
        let stream: MediaStream;
        if (mode === 'screen')
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        else {
          const media =
            [...document.querySelectorAll('video,audio')].find(
              (item) => item instanceof HTMLMediaElement && !item.paused,
            ) ?? document.querySelector('video,audio');
          if (!(media instanceof HTMLMediaElement)) throw new Error('No media player');
          if (media.srcObject instanceof MediaStream) stream = media.srcObject;
          else {
            const captureStream: unknown =
              Reflect.get(media, 'captureStream') ?? Reflect.get(media, 'mozCaptureStream');
            if (typeof captureStream !== 'function') throw new Error('Recording unavailable');
            stream = Reflect.apply(captureStream, media, []) as MediaStream;
          }
        }
        record(stream);
        if (mode === 'screen')
          recorder?.addEventListener('stop', () =>
            stream.getTracks().forEach((track) => track.stop()),
          );
        start.disabled = true;
        label.textContent = labels.recording ?? 'Rayburst';
      } catch {
        start.disabled = false;
        label.textContent = labels.error ?? 'Rayburst';
      }
    };
    if (mode === 'cache' || mode === 'rtc') start.hidden = true;
    section.append(label, start, finish);
    shadow.append(style, section);
    document.documentElement.append(panel);
  }
  function stop(error?: string) {
    captureError ??= error;
    active = false;
    for (const restore of restorers.splice(0).reverse()) restore();
    panel?.remove();
    panel = undefined;
    if (recorders.size) {
      for (const current of recorders) if (current.state !== 'inactive') current.stop();
      return; // Final MediaRecorder chunks arrive before each stop event.
    }
    if (stopping) return;
    stopping = true;
    void queue.then(() => {
      capture = false;
      send({ type: captureError ? 'error' : 'finished', error: captureError });
    });
  }
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      !event.data ||
      typeof event.data !== 'object'
    )
      return;
    const data = event.data as Record<string, unknown>;
    if (data.channel === 'rayburst-ack' && typeof data.id === 'string') {
      acknowledgements.get(data.id)?.(data.ok === true);
      return;
    }
    if (data.channel !== 'rayburst-control') return;
    if (data.mode === 'stop' && data.sessionId === sessionId) {
      stop();
      return;
    }
    if (
      active ||
      capture ||
      typeof data.sessionId !== 'string' ||
      !['deep', 'cache', 'video', 'screen', 'rtc'].includes(String(data.mode))
    )
      return;
    const strings = (value: unknown): Record<string, string> =>
      value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
    labels = strings(data.labels);
    const dark =
      data.theme === 'dark' ||
      (data.theme === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    theme = strings(dark ? data.dark : data.light);
    active = true;
    sessionId = data.sessionId;
    stopping = false;
    captureError = undefined;
    ownedSource = undefined;
    capture = data.mode !== 'deep';
    streamIndex = 0;
    captureEpoch = performance.now();
    found.clear();
    foundBytes = 0;
    if (data.mode === 'deep') deep();
    else if (data.mode === 'cache') {
      deep();
      cache();
    } else if (data.mode === 'rtc') {
      let owner: RTCPeerConnection | undefined;
      patch(
        window,
        'RTCPeerConnection',
        new Proxy(RTCPeerConnection, {
          construct(target, args) {
            const connection = Reflect.construct(target, args) as RTCPeerConnection;
            const tracks = new Set<string>();
            connection.addEventListener('track', (event) => {
              if (
                !capture ||
                !active ||
                (owner && owner !== connection) ||
                tracks.has(event.track.id)
              )
                return;
              owner ??= connection;
              tracks.add(event.track.id);
              record(new MediaStream([event.track]));
            });
            return connection;
          },
        }),
      );
    }
    if (capture) {
      if (document.documentElement) controls(String(data.mode));
      else
        document.addEventListener('DOMContentLoaded', () => controls(String(data.mode)), {
          once: true,
        });
    }
  });
});
