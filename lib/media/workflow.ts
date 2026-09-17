import type {
  DuplicateDownloadGuard,
  DuplicateDownloadReservation,
} from '../download/duplicate-guard';
import {
  ApiAuthError,
  ApiTimeoutError,
  ApiUnreachableError,
  MediaApiError,
  type DesktopApiClient,
} from '../api';
import type { DownloadSettings, MediaCandidate, MediaOperation } from '../schema';
import {
  MediaSourceSchema,
  emptyMediaInput,
  selectionError,
  type MediaProbe,
  type MediaSelection,
} from './contracts';
import type { MediaCatalog } from './catalog';
import { submissionContext } from './request-context';
import { mediaOrigin } from './detection';

export function mediaErrorCode(error: unknown): string {
  if (error instanceof MediaApiError) return error.code;
  if (error instanceof ApiAuthError) return 'api_auth_failed';
  if (error instanceof ApiTimeoutError) return 'timeout';
  if (error instanceof ApiUnreachableError) return 'unreachable';
  return 'operation_failed';
}

export const MEDIA_OPERATION_TTL_MS = 5 * 60_000;

/** Client operation identity survives popup closure, network ambiguity, and worker restarts. */
export function createMediaWorkflow(options: {
  catalog: MediaCatalog;
  duplicateGuard: DuplicateDownloadGuard;
  client: DesktopApiClient;
  getSettings: () => DownloadSettings;
  connectionKey: () => Promise<string>;
  activate: () => Promise<boolean>;
  validateCandidate: (candidate: MediaCandidate) => Promise<boolean>;
  sendFile: (candidate: MediaCandidate) => Promise<boolean>;
}) {
  const { catalog, client } = options;
  const locks = new Map<string, Promise<unknown>>();

  function exclusive<T>(candidateId: string, action: () => Promise<T>): Promise<T> {
    const next = (locks.get(candidateId) ?? Promise.resolve()).catch(() => undefined).then(action);
    locks.set(candidateId, next);
    void next
      .finally(() => {
        if (locks.get(candidateId) === next) locks.delete(candidateId);
      })
      .catch(() => undefined);
    return next;
  }

  async function save(operation: MediaOperation): Promise<void> {
    if (operation.connectionKey !== (await options.connectionKey())) {
      operation.request.source.requestContexts = [];
      if (!['submitted', 'cancelled'].includes(operation.state)) {
        if (!['submitting', 'cancelling'].includes(operation.state)) operation.state = 'failed';
        operation.error = 'connection_changed';
      }
    }
    if (operation.probe || ['submitted', 'cancelled'].includes(operation.state)) {
      operation.request.source.requestContexts = [];
      // The desktop owns accepted input; retain bodies only while creation is ambiguous.
      operation.request.source.input = undefined;
    }
    await catalog.run((state) => {
      if (!state.candidates.some((item) => item.id === operation.candidateId))
        throw new MediaApiError('source_expired');
      if (
        !state.operations.some((item) => item.candidateId === operation.candidateId) &&
        state.operations.filter(
          (item) =>
            ['probing', 'ready', 'submitting', 'cancelling'].includes(item.state) &&
            item.createdAt + MEDIA_OPERATION_TTL_MS > Date.now(),
        ).length >= 8
      )
        throw new MediaApiError('inspection_limit');
      state.operations = state.operations.filter(
        (item) => item.candidateId !== operation.candidateId,
      );
      state.operations.push(operation);
    }, true);
  }

  async function load(tabId: number, candidateId: string) {
    const result = await catalog.run((state) => ({
      candidate: state.candidates.find((item) => item.id === candidateId && item.tabId === tabId),
      operation: state.operations.find((item) => item.candidateId === candidateId),
    }));
    if (!result.candidate || !(await options.validateCandidate(result.candidate)))
      throw new MediaApiError('source_expired');
    return { candidate: result.candidate, operation: result.operation };
  }

  async function checkConnection(operation: MediaOperation, allowExpired = false) {
    if (operation.connectionKey !== (await options.connectionKey()))
      throw new MediaApiError('connection_changed');
    if (
      !allowExpired &&
      Date.now() >= (operation.probe?.expiresAt ?? operation.createdAt + MEDIA_OPERATION_TTL_MS)
    )
      throw new MediaApiError('expired');
  }

  function accept(operation: MediaOperation, probe: MediaProbe) {
    if (
      probe.id !== operation.request.id ||
      probe.expiresAt > operation.createdAt + MEDIA_OPERATION_TTL_MS + 30_000
    )
      throw new MediaApiError('invalid_response');
    if (
      ['submitted', 'submitting'].includes(probe.state) &&
      'submissionId' in probe &&
      probe.submissionId !== operation.submissionId
    )
      throw new MediaApiError('conflict');
    operation.probe = probe;
    operation.error = undefined;
    operation.state = probe.state;
    if (probe.state === 'failed') operation.error = probe.error;
    if (probe.state === 'submitted') {
      operation.gid = probe.gid;
    }
  }

  async function fail(operation: MediaOperation, error: unknown) {
    operation.error = mediaErrorCode(error);
    // Transport/protocol failures do not prove that a mutating request failed.
    // Keep its identity and selection until the desktop reports a definitive outcome.
    if (
      error instanceof MediaApiError &&
      [
        'unsupported_source',
        'protected_media',
        'authentication_required',
        'source_expired',
        'unsupported_selection',
        'probe_failed',
        'expired',
        'not_found',
      ].includes(error.code)
    )
      operation.state = 'failed';
    if (
      error instanceof MediaApiError &&
      error.code === 'connection_changed' &&
      !['submitting', 'cancelling'].includes(operation.state)
    )
      operation.state = 'failed';
    await save(operation);
  }

  async function capabilities(kind: MediaCandidate['kind']) {
    try {
      const result = await client.mediaCapabilities();
      if (!result.sourceKinds.some((source) => source === kind))
        throw new MediaApiError('unsupported_source');
    } catch (error) {
      if (
        !(error instanceof ApiUnreachableError) ||
        options.getSettings().desktopUnavailable.action !== 'launch'
      )
        throw error;
      if (!(await options.activate())) throw new MediaApiError('unreachable');
      const result = await client.mediaCapabilities();
      if (!result.sourceKinds.some((source) => source === kind))
        throw new MediaApiError('unsupported_source');
    }
  }

  function probe(tabId: number, candidateId: string) {
    return exclusive(candidateId, async () => {
      const { candidate, operation: previous } = await load(tabId, candidateId);
      if (!['hls', 'dash', 'collection'].includes(candidate.kind) || candidate.method !== 'GET')
        throw new MediaApiError('unsupported_source');
      if (previous && !['failed', 'cancelled', 'submitted'].includes(previous.state)) return;
      const active = await catalog.run(
        (state) =>
          state.operations.filter(
            (item) =>
              ['probing', 'ready', 'submitting', 'cancelling'].includes(item.state) &&
              item.createdAt + MEDIA_OPERATION_TTL_MS > Date.now(),
          ).length,
      );
      if (active >= 8) throw new MediaApiError('inspection_limit');
      await capabilities(candidate.kind);
      const context = submissionContext(candidate, options.getSettings());
      const related = await catalog.run((state) =>
        state.contexts
          .filter(
            (item) =>
              item.tabId === candidate.tabId &&
              item.frameId === candidate.frameId &&
              item.documentId === candidate.documentId &&
              item.pageUrl === candidate.pageUrl &&
              item.frameUrl === candidate.frameUrl &&
              item.capturedAt >= Date.now() - 2 * 60_000 &&
              mediaOrigin(item.url) !== mediaOrigin(candidate.url),
          )
          .slice(0, 7),
      );
      if (!(await options.validateCandidate(candidate))) throw new MediaApiError('source_expired');
      const input = structuredClone(candidate.input ?? emptyMediaInput());
      if (candidate.input?.manifests.length) {
        const manifests = await catalog.run((state) =>
          state.candidates
            .filter(
              (item) =>
                item.tabId === tabId &&
                item.frameId === candidate.frameId &&
                item.documentId === candidate.documentId,
            )
            .flatMap((item) => item.input?.manifests ?? []),
        );
        let size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
        for (const manifest of manifests) {
          if (
            input.manifests.length >= 32 ||
            input.manifests.some((item) => item.url === manifest.url)
          )
            continue;
          const bytes = new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
          if (size + bytes > 2 * 1024 * 1024) continue;
          input.manifests.push(manifest);
          size += bytes;
        }
      }
      const operation: MediaOperation = {
        candidateId,
        connectionKey: await options.connectionKey(),
        createdAt: Date.now(),
        state: 'probing',
        request: {
          id: crypto.randomUUID(),
          source: MediaSourceSchema.parse({
            url: candidate.url,
            kind: candidate.kind,
            pageUrl: candidate.pageUrl,
            title: candidate.title,
            filename: candidate.filename,
            mime: candidate.mime,
            ...(candidate.input ? { input } : {}),
            requestContexts: [context, ...related]
              .filter((item) => item.headers.length)
              .map(({ url, headers }) => ({ url, headers })),
          }),
        },
      };
      await save(operation);
      try {
        await checkConnection(operation);
        accept(operation, await client.createMediaProbe(operation.request));
        await save(operation);
      } catch (error) {
        await fail(operation, error);
      }
    });
  }

  function poll(tabId: number, candidateId: string) {
    return exclusive(candidateId, async () => {
      const { operation } = await load(tabId, candidateId);
      if (!operation || ['failed', 'cancelled', 'submitted'].includes(operation.state)) return;
      try {
        await checkConnection(operation, ['submitting', 'cancelling'].includes(operation.state));
        if (operation.state === 'cancelling') {
          await cancelOperation(operation);
          return;
        }
        const result = operation.probe
          ? await client.getMediaProbe(operation.request.id)
          : await client.createMediaProbe(operation.request);
        const pending = operation.state === 'submitting';
        accept(operation, result);
        if (pending && result.state === 'ready') {
          await checkConnection(operation);
          operation.state = 'submitting';
        }
        await save(operation);
        if (pending && result.state === 'ready' && operation.selection && operation.submissionId)
          await submitOperation(operation);
      } catch (error) {
        await fail(operation, error);
      }
    });
  }

  async function submitOperation(operation: MediaOperation) {
    await checkConnection(operation);
    if (!operation.selection || !operation.submissionId)
      throw new MediaApiError('invalid_response');
    const result = await client.submitMediaProbe(operation.request.id, {
      submissionId: operation.submissionId,
      selection: operation.selection,
    });
    if (result.id !== operation.request.id || result.submissionId !== operation.submissionId)
      throw new MediaApiError('invalid_response');
    operation.state = 'submitted';
    operation.gid = result.gid;
    operation.error = undefined;
    await save(operation);
  }

  function submit(tabId: number, candidateId: string, selection: MediaSelection) {
    return exclusive(candidateId, async () => {
      const { candidate, operation } = await load(tabId, candidateId);
      if (!operation || operation.state !== 'ready' || operation.probe?.state !== 'ready')
        throw new MediaApiError('conflict');
      if (selectionError(operation.probe.presentation, selection))
        throw new MediaApiError('unsupported_selection');
      let reservation: DuplicateDownloadReservation | undefined;
      try {
        await checkConnection(operation);
        const duplicate = options.duplicateGuard.reserve(
          {
            url: candidate.url,
            filename: candidate.filename,
            fileSize: candidate.size ?? -1,
            totalBytes: candidate.size ?? -1,
            mime: candidate.mime,
          },
          options.getSettings().duplicateGuard,
        );
        if (duplicate.blocked) throw new MediaApiError('duplicate_blocked');
        reservation = duplicate.reservation;
        operation.selection = selection;
        operation.submissionId = crypto.randomUUID();
        operation.state = 'submitting';
        await save(operation);
        await submitOperation(operation);
      } catch (error) {
        await fail(operation, error);
        if (['failed', 'ready'].includes(operation.state))
          options.duplicateGuard.release(reservation);
      }
    });
  }

  async function cancelOperation(operation: MediaOperation) {
    await checkConnection(operation, true);
    const result = await client.cancelMediaProbe(operation.request.id);
    if (result.id !== operation.request.id) throw new MediaApiError('invalid_response');
    if (result.state === 'submitted' && result.submissionId !== operation.submissionId)
      throw new MediaApiError('conflict');
    operation.state = result.state;
    operation.error = undefined;
    if (result.state === 'submitted') operation.gid = result.gid;
    await save(operation);
  }

  function cancel(tabId: number, candidateId: string) {
    return exclusive(candidateId, async () => {
      const { operation } = await load(tabId, candidateId);
      if (!operation || ['submitted', 'cancelled'].includes(operation.state)) return;
      try {
        await checkConnection(operation, true);
        operation.state = 'cancelling';
        await save(operation);
        await cancelOperation(operation);
      } catch (error) {
        await fail(operation, error);
      }
    });
  }
  function downloadFile(tabId: number, candidateId: string) {
    return exclusive(candidateId, async () => {
      const { candidate } = await load(tabId, candidateId);
      if (
        !['file', 'fragment', 'subtitle', 'image', 'json'].includes(candidate.kind) ||
        candidate.method !== 'GET'
      )
        throw new MediaApiError('unsupported_source');
      if (!(await options.sendFile(candidate))) throw new MediaApiError('operation_failed');
      await catalog.run((state) => {
        const current = state.candidates.find((item) => item.id === candidateId);
        if (current) current.sentToDesktop = true;
      }, true);
    });
  }
  return { probe, poll, submit, cancel, downloadFile };
}
