import { CaptureChunkSchema } from './capture';
import { createThemeVars, resolveScheme } from '@/shared/theme-colors';
import { loadUiPrefs } from '../storage';
import { I18nEngine } from '@/shared/i18n/engine';
import { resolveLocaleId } from '@/shared/i18n/dictionaries';
import { PlayerCommandSchema } from './player-controls';
import { mediaErrorCode, type createMediaWorkflow } from './workflow';
import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';
import type { DesktopApiClient } from '../api';
import { MediaApiError } from '../api';
import type { MediaCatalog } from './catalog';
import { emptyMediaInput, MediaInputPlanSchema, type MediaInputPlan } from './contracts';
import type { DownloadSettings, MediaCandidate, MediaCapturedContext } from '../schema';
import { selectMedia } from './rules';
import { mediaOrigin } from './detection';

const ModeSchema = z.enum(['deep', 'cache', 'video', 'screen', 'rtc', 'stop']);
const SessionSchema = z.object({
  id: z.uuid(),
  mode: ModeSchema,
  captureId: z.uuid().optional(),
  frameId: z.number().int().optional(),
  documentId: z.string().optional(),
  automatic: z.boolean().optional(),
  streams: z.record(
    z.string(),
    z.object({
      index: z.number().int(),
      offset: z.number().int(),
      mime: z.string(),
      lastId: z.string().optional(),
      offsetMs: z.number().int().nonnegative().optional(),
    }),
  ),
});
const SessionsSchema = z.record(z.string(), SessionSchema);
const ObservationSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: z.string().max(16384) }),
    z.object({
      type: z.literal('manifest'),
      url: z.string().max(16384),
      kind: z.enum(['hls', 'dash']),
      content: z.string().max(512 * 1024),
    }),
    z.object({ type: z.literal('key'), key: z.string().regex(/^[a-f0-9]{32}$/i) }),
    CaptureChunkSchema,
    z.object({ type: z.literal('finished') }),
    z.object({ type: z.literal('error'), error: z.string().optional() }),
  ])
  .and(z.object({ sessionId: z.uuid() }));
export const MediaToolSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MEDIA_FRAME_READY'),
    tabId: z.number().int(),
    frameId: z.number().int(),
    url: z.string(),
  }),
  z.object({ type: z.literal('MEDIA_AUTOMATIC'), tabId: z.number().int(), enabled: z.boolean() }),
  z.object({ type: z.literal('MEDIA_MOBILE'), tabId: z.number().int(), enabled: z.boolean() }),
  z.object({
    type: z.literal('MEDIA_BATCH'),
    tabId: z.number().int(),
    ids: z.array(z.uuid()).min(1).max(1000),
  }),
  z.object({
    type: z.literal('MEDIA_PLAYER'),
    tabId: z.number().int(),
    frameId: z.number().int().optional(),
    command: PlayerCommandSchema,
  }),
  z.object({
    type: z.literal('MEDIA_MODE'),
    tabId: z.number().int(),
    mode: ModeSchema,
    reload: z.boolean(),
  }),
  z.object({ type: z.literal('MEDIA_TOOLS'), tabId: z.number().int() }),
  z.object({
    type: z.literal('MEDIA_IMPORT'),
    title: z.string().max(512).optional(),
    tabId: z.number().int(),
    frameId: z.number().int().nonnegative().optional(),
    url: z.string().max(16384),
    kind: z.enum(['hls', 'dash', 'collection']),
    input: MediaInputPlanSchema,
  }),
  z.object({
    type: z.literal('MEDIA_MERGE'),
    tabId: z.number().int(),
    ids: z.array(z.uuid()).min(1).max(256),
    sequence: z.boolean(),
  }),
]);
export type MediaTool = z.infer<typeof MediaToolSchema>;
export function startMediaTools(options: {
  ensureConfig: () => Promise<void>;
  onDownloadError?: (candidateId: string, error: string) => void;
  catalog: MediaCatalog;
  client: DesktopApiClient;
  allowed: (pageUrl: string, url: string) => boolean;
  workflow: ReturnType<typeof createMediaWorkflow>;
  probe: (tabId: number, candidateId: string) => Promise<void>;
  observe: (candidate: MediaCandidate) => Promise<void>;
  contextFor: (candidate: MediaCandidate) => MediaCapturedContext | undefined;
  settings: () => DownloadSettings;
}) {
  let tail = Promise.resolve();
  const run = <T>(work: () => Promise<T>) => {
    const result = tail.then(work);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  async function sessions() {
    return SessionsSchema.catch({}).parse(
      (await browser.storage.session.get('mediaTools')).mediaTools,
    );
  }
  async function inject(tabId: number, frameId: number, mode: z.infer<typeof ModeSchema>) {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ['/sniffer.js'],
      world: 'MAIN',
      injectImmediately: true,
    });
    const prefs = await loadUiPrefs();
    const i18n = new I18nEngine(
      prefs.locale === 'auto' ? resolveLocaleId(browser.i18n.getUILanguage()) : prefs.locale,
    );
    const labels = Object.fromEntries(
      ['start', 'stop', 'deep', 'cache', 'video', 'screen', 'rtc'].map((key) => [
        key,
        i18n.t(`resources_${key}`),
      ]),
    );
    labels.error = i18n.t('media_failed');
    labels.recording = i18n.t('media_live');
    const seedHex = resolveScheme(prefs.colorScheme).seed;
    const session = (await sessions())[String(tabId)];
    await browser.tabs.sendMessage(
      tabId,
      {
        type: 'MEDIA_CONTROL',
        mode,
        sessionId: session?.id,
        labels,
        theme: prefs.theme,
        light: createThemeVars({ seedHex, isDark: false }),
        dark: createThemeVars({ seedHex, isDark: true }),
      },
      { frameId },
    );
  }
  async function candidate(
    tabId: number,
    frameId: number,
    url: string,
    kind: MediaCandidate['kind'],
    input?: MediaInputPlan,
    variant?: string,
  ) {
    const tab = await browser.tabs.get(tabId);
    const frame = await browser.webNavigation.getFrame({ tabId, frameId });
    if (!tab.url || !frame || !options.allowed(tab.url, url))
      throw new MediaApiError('source_expired');
    const item: MediaCandidate = {
      id: crypto.randomUUID(),
      tabId,
      frameId,
      documentId: frame.documentId ?? '',
      frameUrl: frame.url,
      pageUrl: tab.url,
      title: tab.title ?? '',
      url,
      kind,
      input,
      variant,
      filename: '',
      mime: '',
      size: null,
      method: 'GET',
      evidence: 'script',
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    };
    item.context = options.contextFor(item);
    await options.observe(item);
    return (
      (await options.catalog.run((state) =>
        state.candidates.find(
          (value) =>
            value.tabId === tabId &&
            value.frameId === frameId &&
            value.url === url &&
            value.variant === variant,
        ),
      )) ?? item
    );
  }
  async function finishCapture(
    tabId: number,
    frameId: number,
    all: z.infer<typeof SessionsSchema>,
  ) {
    const session = all[String(tabId)];
    if (!session?.captureId || session.mode === 'stop') return;
    const receipt = await options.client.sealCapture(session.captureId!);
    const input = emptyMediaInput();
    for (const stored of receipt.streams) {
      const metadata = Object.values(session.streams).find((item) => item.index === stored.stream);
      const resource = options.client.captureResource(session.captureId!, stored.stream);
      input.tracks.push({
        id: `capture-${stored.stream}`,
        type: metadata?.mime.startsWith('audio/')
          ? 'audio'
          : session.mode === 'cache' && !/mp4a|opus|aac|vorbis/i.test(metadata?.mime ?? '')
            ? 'video'
            : 'muxed',
        urls: [resource.url],
        offsetMs: metadata?.offsetMs ?? 0,
      });
    }
    const resource = options.client.captureResource(session.captureId!, receipt.streams[0]!.stream);
    const item = await candidate(tabId, frameId, resource.url, 'collection', input);
    item.evidence = 'capture';
    item.context = { ...resource, capturedAt: Date.now() };
    await options.observe(item);
    session.mode = 'stop';
    await browser.storage.session.set({ mediaTools: all });
  }
  async function observation(raw: unknown, sender: Browser.runtime.MessageSender) {
    const parsed = ObservationSchema.safeParse(raw);
    if (
      !parsed.success ||
      sender.id !== browser.runtime.id ||
      sender.tab?.id === undefined ||
      sender.frameId === undefined
    )
      return { ok: false };
    const tabId = sender.tab.id;
    const frameId = sender.frameId;
    const all = await sessions();
    const session = all[String(tabId)];
    if (
      !session ||
      session.id !== parsed.data.sessionId ||
      session.mode === 'stop' ||
      !options.allowed(sender.tab.url ?? '', sender.url ?? '')
    )
      return { ok: false };
    const frame = await browser.webNavigation.getFrame({ tabId, frameId });
    if (
      !frame ||
      (sender.documentId && frame.documentId && sender.documentId !== frame.documentId) ||
      (sender.url && frame.url !== sender.url)
    )
      return { ok: false };
    const data = parsed.data;
    if (data.type === 'key' && ['deep', 'cache'].includes(session.mode)) {
      await options.catalog.run((state) => {
        if (
          !state.keys.some(
            (key) => key.tabId === tabId && key.frameId === frameId && key.key === data.key,
          )
        )
          state.keys.push({
            tabId,
            frameId,
            key: data.key,
            url: sender.url ?? '',
            capturedAt: Date.now(),
          });
      }, true);
    } else if (data.type === 'url' && ['deep', 'cache'].includes(session.mode)) {
      const detected = selectMedia(
        { url: data.url, evidence: 'script' },
        options.settings().mediaDiscovery,
      );
      if (detected) await candidate(tabId, frameId, detected.url, detected.kind);
    } else if (data.type === 'manifest' && ['deep', 'cache'].includes(session.mode)) {
      const detected = selectMedia(
        {
          url: data.url,
          evidence: 'script',
          mime: data.kind === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml',
        },
        options.settings().mediaDiscovery,
      );
      if (!detected) return { ok: true };
      const input = emptyMediaInput();
      input.manifests.push({ url: data.url, content: data.content });
      await candidate(tabId, frameId, data.url, data.kind, input);
    } else if (data.type === 'chunk' && session.captureId && session.mode !== 'deep') {
      // One recording owns one native frame; iframe streams cannot be accidentally mixed.
      if (session.frameId !== undefined && session.frameId !== frameId) return { ok: false };
      if (session.documentId && frame.documentId && session.documentId !== frame.documentId)
        return { ok: false };
      session.frameId = frameId;
      session.documentId = frame.documentId;
      const stream = (session.streams[String(data.stream)] ??= {
        index: Object.keys(session.streams).length,
        offset: 0,
        mime: data.mime,
        offsetMs: data.offsetMs,
      });
      if (stream.mime !== data.mime) return { ok: false };
      if (stream.lastId === data.id) return { ok: true };
      const bytes = Uint8Array.from(atob(data.data), (char) => char.charCodeAt(0));
      const result = await options.client.appendCapture(
        session.captureId,
        stream.index,
        stream.offset,
        bytes,
      );
      stream.offset = result.offset;
      stream.lastId = data.id;
      await browser.storage.session.set({ mediaTools: all });
    } else if (data.type === 'finished' && session.captureId && session.frameId === frameId) {
      await finishCapture(tabId, frameId, all);
    } else if (data.type === 'error') {
      session.mode = 'stop';
      await browser.storage.session.set({ mediaTools: all });
      return { ok: false };
    }
    return { ok: true };
  }
  const queueSchema = z.array(z.object({ tabId: z.number().int(), candidateId: z.uuid() }));
  async function processQueue() {
    await options.ensureConfig();
    const pending = queueSchema
      .catch([])
      .parse((await browser.storage.session.get('mediaQueue')).mediaQueue);
    const remaining: typeof pending = pending.slice(8);
    for (const entry of pending.slice(0, 8)) {
      try {
        let item = await options.catalog.run((state) => ({
          source: state.candidates.find((value) => value.id === entry.candidateId),
          operation: state.operations.find((value) => value.candidateId === entry.candidateId),
        }));
        if (!item.source) continue;
        if (item.operation?.state === 'submitted') continue;
        if (item.source.kind === 'embedded' || item.source.method !== 'GET')
          throw new MediaApiError('unsupported_source');
        if (['hls', 'dash', 'collection'].includes(item.source.kind)) {
          if (!item.operation || ['cancelled', 'failed'].includes(item.operation.state))
            await options.workflow.probe(entry.tabId, entry.candidateId);
          else await options.workflow.poll(entry.tabId, entry.candidateId);
          item = await options.catalog.run((state) => ({
            source: state.candidates.find((value) => value.id === entry.candidateId),
            operation: state.operations.find((value) => value.candidateId === entry.candidateId),
          }));
          if (item.operation?.probe?.state === 'ready' && !item.operation.probe.presentation.live) {
            await options.workflow.submit(
              entry.tabId,
              entry.candidateId,
              item.operation.probe.presentation.defaults,
            );
            const result = await options.catalog.run((state) =>
              state.operations.find((op) => op.candidateId === entry.candidateId),
            );
            if (result?.state === 'submitting') remaining.push(entry);
            else if (result?.error) throw new MediaApiError(result.error);
          } else if (item.operation?.state === 'submitted') continue;
          else if (item.operation?.state === 'failed')
            throw new MediaApiError(item.operation.error ?? 'operation_failed');
          else if (item.operation?.probe?.state === 'ready')
            throw new MediaApiError('unsupported_selection');
          else remaining.push(entry);
        } else await options.workflow.downloadFile(entry.tabId, entry.candidateId);
      } catch (error) {
        const code = mediaErrorCode(error);
        await options.catalog.run((state) => {
          const candidate = state.candidates.find((item) => item.id === entry.candidateId);
          if (candidate) candidate.downloadError = code;
        }, true);
        options.onDownloadError?.(entry.candidateId, code);
      }
    }
    await browser.storage.session.set({ mediaQueue: remaining });
    if (remaining.length) {
      await browser.alarms.create('media-queue', { delayInMinutes: 0.5 });
      setTimeout(() => {
        void run(processQueue).catch(() => undefined);
      }, 1500);
    }
  }
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'media-queue') void run(processQueue).catch(() => undefined);
  });
  let automaticTimer: ReturnType<typeof setTimeout> | undefined;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.mediaSession || automaticTimer) return;
    automaticTimer = setTimeout(() => {
      automaticTimer = undefined;
      void run(async () => {
        const saved = await browser.storage.session.get(['mediaAutomaticTabs', 'mediaQueue']);
        const tabs = z.array(z.number().int()).catch([]).parse(saved.mediaAutomaticTabs);
        if (!tabs.length) return;
        const queued = queueSchema.catch([]).parse(saved.mediaQueue);
        const fresh = await options.catalog.run((state) =>
          state.candidates.filter(
            (item) =>
              tabs.includes(item.tabId) &&
              ['hls', 'dash', 'collection', 'file'].includes(item.kind) &&
              !item.sentToDesktop &&
              !state.operations.some((operation) => operation.candidateId === item.id) &&
              !queued.some((entry) => entry.candidateId === item.id),
          ),
        );
        if (!fresh.length) return;
        await browser.storage.session.set({
          mediaQueue: [
            ...queued,
            ...fresh.map((item) => ({ tabId: item.tabId, candidateId: item.id })),
          ],
        });
        await processQueue();
      }).catch(() => undefined);
    }, 300);
  });
  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    if (
      raw &&
      typeof raw === 'object' &&
      'type' in raw &&
      raw.type === 'MEDIA_SCRIPT_DATA' &&
      'data' in raw
    )
      return run(() => observation(raw.data, sender)).catch(() => ({ ok: false }));
    const frameReady =
      raw &&
      typeof raw === 'object' &&
      'type' in raw &&
      raw.type === 'MEDIA_FRAME_READY' &&
      sender.id === browser.runtime.id &&
      sender.tab?.id !== undefined &&
      sender.frameId !== undefined;
    const parsed = MediaToolSchema.safeParse(
      frameReady
        ? {
            type: 'MEDIA_FRAME_READY',
            tabId: sender.tab!.id,
            frameId: sender.frameId,
            url: sender.url ?? '',
          }
        : raw,
    );
    if (
      !parsed.success ||
      sender.id !== browser.runtime.id ||
      (!frameReady && !sender.url?.startsWith(browser.runtime.getURL('')))
    )
      return;
    return run(async () => {
      await options.ensureConfig();
      const command = parsed.data;
      const tab = await browser.tabs.get(command.tabId);
      if (!tab.url || !options.allowed(tab.url, tab.url)) throw new MediaApiError('source_expired');
      const all = await sessions();
      if (command.type === 'MEDIA_AUTOMATIC') {
        const saved = z
          .array(z.number().int())
          .catch([])
          .parse((await browser.storage.session.get('mediaAutomaticTabs')).mediaAutomaticTabs);
        await browser.storage.session.set({
          mediaAutomaticTabs: command.enabled
            ? [...new Set([...saved, command.tabId])]
            : saved.filter((id) => id !== command.tabId),
        });
        return { ok: true };
      }
      if (command.type === 'MEDIA_MOBILE') {
        const id = command.tabId + 1000;
        await browser.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [id],
          addRules: command.enabled
            ? [
                {
                  id,
                  priority: 1,
                  action: {
                    type: 'modifyHeaders',
                    requestHeaders: [
                      {
                        header: 'user-agent',
                        operation: 'set',
                        value:
                          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
                      },
                    ],
                  },
                  condition: {
                    tabIds: [command.tabId],
                    urlFilter: '|http',
                    resourceTypes: [
                      'main_frame',
                      'sub_frame',
                      'xmlhttprequest',
                      'media',
                      'script',
                      'image',
                      'other',
                    ],
                  },
                },
              ]
            : [],
        });
        await browser.tabs.reload(command.tabId, { bypassCache: true });
        return { ok: true };
      }
      if (command.type === 'MEDIA_BATCH') {
        await options.catalog.run((state) => {
          for (const item of state.candidates)
            if (command.ids.includes(item.id)) item.downloadError = undefined;
          state.operations = state.operations.filter(
            (operation) =>
              !command.ids.includes(operation.candidateId) ||
              !['submitted', 'cancelled', 'failed'].includes(operation.state),
          );
        }, true);
        const items = await options.catalog.run((state) =>
          state.candidates.filter((item) => command.ids.includes(item.id)),
        );
        const queue = queueSchema
          .catch([])
          .parse((await browser.storage.session.get('mediaQueue')).mediaQueue);
        for (const item of items)
          if (!queue.some((entry) => entry.candidateId === item.id))
            queue.push({ tabId: item.tabId, candidateId: item.id });
        await browser.storage.session.set({ mediaQueue: queue });
        void run(processQueue).catch(() => undefined);
        return { ok: true };
      }
      if (command.type === 'MEDIA_PLAYER') {
        if (command.command.action === 'list') {
          const frames = await browser.webNavigation.getAllFrames({ tabId: command.tabId });
          const players = await Promise.allSettled(
            (frames ?? []).map(async (frame) => ({
              frameId: frame.frameId,
              players: await browser.tabs.sendMessage(
                command.tabId,
                { type: 'MEDIA_PLAYER', command: command.command },
                { frameId: frame.frameId },
              ),
            })),
          );
          return players.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        }
        const result: unknown = await browser.tabs.sendMessage(
          command.tabId,
          { type: 'MEDIA_PLAYER', command: command.command },
          { frameId: command.frameId ?? 0 },
        );
        if (command.command.action === 'screenshot' && typeof result === 'string') {
          const id = crypto.randomUUID();
          await options.client.createCapture(id);
          const bytes = Uint8Array.from(atob(result), (char) => char.charCodeAt(0));
          for (let offset = 0; offset < bytes.length; offset += 256 * 1024)
            await options.client.appendCapture(
              id,
              0,
              offset,
              bytes.slice(offset, offset + 256 * 1024),
            );
          await options.client.sealCapture(id);
          const resource = options.client.captureResource(id, 0);
          const item = await candidate(command.tabId, command.frameId ?? 0, resource.url, 'image');
          item.evidence = 'capture';
          item.filename = `${item.title || 'Screenshot'}.png`;
          item.context = { ...resource, capturedAt: Date.now() };
          await options.observe(item);
          await options.workflow.downloadFile(item.tabId, item.id);
          return true;
        }
        return result;
      }
      if (command.type === 'MEDIA_FRAME_READY') {
        const tab = await browser.tabs.get(command.tabId);
        if (!tab.url || !options.allowed(tab.url, command.url)) return { ok: true };
        let session = all[String(command.tabId)];
        if (session?.automatic && !options.settings().mediaDiscovery.alwaysDeepSearch) {
          await inject(command.tabId, command.frameId, 'stop');
          delete all[String(command.tabId)];
          await browser.storage.session.set({ mediaTools: all });
          return { ok: true };
        }
        if (!session && options.settings().mediaDiscovery.alwaysDeepSearch) {
          session = { id: crypto.randomUUID(), mode: 'deep', automatic: true, streams: {} };
          all[String(command.tabId)] = session;
          await browser.storage.session.set({ mediaTools: all });
        }
        if (session && session.mode !== 'stop')
          await inject(command.tabId, command.frameId, session.mode);
        return { ok: true };
      }
      if (command.type === 'MEDIA_TOOLS')
        return {
          automatic: z
            .array(z.number())
            .catch([])
            .parse((await browser.storage.session.get('mediaAutomaticTabs')).mediaAutomaticTabs)
            .includes(command.tabId),
          mobile: (await browser.declarativeNetRequest.getSessionRules()).some(
            (rule) => rule.id === command.tabId + 1000,
          ),
          mode: all[String(command.tabId)]?.mode ?? 'stop',
          keys: await options.catalog.run((state) =>
            state.keys.filter((key) => key.tabId === command.tabId),
          ),
        };
      if (command.type === 'MEDIA_MODE') {
        if (command.mode !== 'stop') {
          if (all[String(command.tabId)]?.captureId && all[String(command.tabId)]?.mode !== 'stop')
            throw new MediaApiError('conflict');
          const captureId = command.mode === 'deep' ? undefined : crypto.randomUUID();
          if (captureId) await options.client.createCapture(captureId);
          all[String(command.tabId)] = {
            id: crypto.randomUUID(),
            mode: command.mode,
            captureId,
            streams: {},
          };
          await browser.storage.session.set({ mediaTools: all });
        }
        const frames = await browser.webNavigation.getAllFrames({ tabId: command.tabId });
        await Promise.allSettled(
          (frames ?? []).map((frame) => inject(command.tabId, frame.frameId, command.mode)),
        );
        if (command.mode === 'stop' && !all[String(command.tabId)]?.captureId) {
          const current = all[String(command.tabId)];
          if (current) {
            current.mode = 'stop';
            current.automatic = false;
          }
          await browser.storage.session.set({ mediaTools: all });
        }
        const session = all[String(command.tabId)];
        if (command.mode === 'stop' && session?.captureId && !Object.keys(session.streams).length) {
          await options.client.discardCapture(session.captureId);
          session.mode = 'stop';
          await browser.storage.session.set({ mediaTools: all });
        }
        if (command.reload && command.mode !== 'stop')
          await browser.tabs.reload(command.tabId, { bypassCache: true });
        return { ok: true };
      }
      if (command.type === 'MEDIA_IMPORT') {
        const item = await candidate(
          command.tabId,
          command.frameId ?? 0,
          command.url,
          command.kind,
          command.input,
          crypto.randomUUID(),
        );
        if (command.title) {
          item.title = command.title;
          await options.observe(item);
        }
        await options.probe(command.tabId, item.id);
        return { id: item.id };
      }
      const sources = await options.catalog.run((state) =>
        state.candidates.filter(
          (item) => item.tabId === command.tabId && command.ids.includes(item.id),
        ),
      );
      if (
        sources.length !== command.ids.length ||
        sources.some(
          (item) =>
            item.frameId !== sources[0]?.frameId || item.documentId !== sources[0]?.documentId,
        ) ||
        sources.some((item) => !['file', 'fragment', 'subtitle'].includes(item.kind))
      )
        throw new MediaApiError('unsupported_source');
      const input = emptyMediaInput();
      if (command.sequence)
        input.tracks.push({
          id: 'sequence',
          type: 'muxed',
          urls: command.ids.map((id) => sources.find((source) => source.id === id)!.url),
        });
      else
        input.tracks = sources.map((item) => ({
          id: item.id,
          type:
            item.kind === 'subtitle'
              ? 'subtitle'
              : item.mime.startsWith('audio/')
                ? 'audio'
                : 'video',
          urls: [item.url],
        }));
      const item = await candidate(
        command.tabId,
        sources[0]!.frameId,
        `https://rayburst.invalid/collection/${crypto.randomUUID()}`,
        'collection',
        input,
      );
      item.context = sources[0]!.context;
      await options.observe(item);
      await options.catalog.run((state) => {
        for (const source of sources)
          if (
            source.context &&
            !state.contexts.some(
              (context) =>
                context.tabId === source.tabId &&
                mediaOrigin(context.url) === mediaOrigin(source.url),
            )
          )
            state.contexts.push({
              ...source.context,
              tabId: source.tabId,
              frameId: source.frameId,
              documentId: source.documentId,
              frameUrl: source.frameUrl,
              pageUrl: source.pageUrl,
            });
      }, true);
      await options.probe(command.tabId, item.id);
      return { id: item.id };
    }).catch((error: unknown) => ({
      error: mediaErrorCode(error),
    }));
  });
  if (import.meta.env.FIREFOX) {
    type StreamFilter = {
      ondata: ((event: { data: ArrayBuffer }) => void) | null;
      onstop: (() => void) | null;
      onerror: (() => void) | null;
      write: (data: ArrayBuffer) => void;
      close: () => void;
      disconnect: () => void;
    };
    // WXT's common browser type omits this Firefox-only native API.
    const filterResponseData = Reflect.get(browser.webRequest, 'filterResponseData') as
      | ((id: string) => StreamFilter)
      | undefined;
    let deepTabs = new Set<number>();
    const sync = async () => {
      const value = await sessions();
      deepTabs = new Set(
        Object.entries(value)
          .filter(([, session]) => ['deep', 'cache'].includes(session.mode))
          .map(([id]) => Number(id)),
      );
    };
    void sync().catch(() => undefined);
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.mediaTools) void sync().catch(() => undefined);
    });
    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (!filterResponseData || !deepTabs.has(details.tabId)) return;
        const filter = filterResponseData(details.requestId);
        const chunks: Uint8Array[] = [];
        let size = 0;
        filter.ondata = ({ data }) => {
          filter.write(data);
          size += data.byteLength;
          if (size > 512 * 1024) {
            chunks.length = 0;
            filter.disconnect();
            return;
          }
          chunks.push(new Uint8Array(data).slice());
        };
        filter.onerror = () => {
          chunks.length = 0;
          filter.disconnect();
        };
        filter.onstop = () => {
          filter.close();
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const content = new TextDecoder().decode(bytes).trimStart();
          const kind = content.startsWith('#EXTM3U')
            ? 'hls'
            : /^(?:<\?xml[^>]*>\s*)?<MPD[\s>]/i.test(content)
              ? 'dash'
              : undefined;
          if (!kind && bytes.length !== 16) return;
          void run(async () => {
            const tab = await browser.tabs.get(details.tabId);
            const frame = await browser.webNavigation.getFrame({
              tabId: details.tabId,
              frameId: details.frameId,
            });
            if (!frame) return;
            const session = (await sessions())[String(details.tabId)];
            if (!session) return;
            const documentUrl =
              'documentUrl' in details && typeof details.documentUrl === 'string'
                ? details.documentUrl
                : frame.url;
            await observation(
              kind
                ? { sessionId: session.id, type: 'manifest', kind, url: details.url, content }
                : {
                    sessionId: session.id,
                    type: 'key',
                    key: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
                  },
              {
                id: browser.runtime.id,
                tab,
                frameId: details.frameId,
                documentId: details.documentId,
                url: documentUrl,
              },
            );
          }).catch(() => undefined);
        };
        return undefined;
      },
      { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest', 'media'] },
      ['blocking'],
    );
  }
  browser.tabs.onRemoved.addListener((tabId) => {
    void run(async () => {
      const all = await sessions();
      const session = all[String(tabId)];
      if (session?.captureId && session.mode !== 'stop')
        await options.client.discardCapture(session.captureId).catch(() => undefined);
      delete all[String(tabId)];
      const saved = await browser.storage.session.get(['mediaAutomaticTabs', 'mediaQueue']);
      await browser.storage.session.set({
        mediaTools: all,
        mediaAutomaticTabs: z
          .array(z.number())
          .catch([])
          .parse(saved.mediaAutomaticTabs)
          .filter((id) => id !== tabId),
        mediaQueue: queueSchema
          .catch([])
          .parse(saved.mediaQueue)
          .filter((item) => item.tabId !== tabId),
      });
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId + 1000] });
    }).catch(() => undefined);
  });
  browser.webNavigation.onCommitted.addListener((details) => {
    void run(async () => {
      const all = await sessions();
      const session = all[String(details.tabId)];
      if (!session || session.mode === 'stop') return;
      if (
        session.captureId &&
        Object.keys(session.streams).length &&
        (details.frameId === 0 || session.frameId === details.frameId)
      ) {
        // A new document cannot append bytes to the previous player's capture.
        await finishCapture(details.tabId, details.frameId, all);
        return;
      }
      // The new content frame requests injection once its message listener is installed.
    }).catch(() => undefined);
  });
}
