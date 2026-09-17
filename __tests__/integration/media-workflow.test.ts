import { DuplicateDownloadGuard } from '@/lib/download/duplicate-guard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { ApiTimeoutError, DesktopApiClient, MediaApiError } from '@/lib/api';
import { createMediaCatalog } from '@/lib/media/catalog';
import { createMediaWorkflow } from '@/lib/media/workflow';
import { parseDownloadSettings } from '@/lib/schema';
import { mediaCandidate, mediaPresentation, mediaSelection } from '../fixtures/media';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

async function fixture() {
  const catalog = createMediaCatalog();
  const candidate = mediaCandidate();
  await catalog.observe(candidate);
  const client = new DesktopApiClient({ port: 29110, secret: 'api-secret' });
  let key = 'connection-one';
  const settings = parseDownloadSettings({ forwardCookies: false });
  vi.spyOn(client, 'mediaCapabilities').mockResolvedValue({
    product: 'rayburst',
    protocolVersion: 2,
    sourceKinds: ['hls', 'dash'],
    requestContexts: true,
  });
  const create = vi.spyOn(client, 'createMediaProbe').mockImplementation(async (request) => ({
    id: request.id,
    expiresAt: Date.now() + 300_000,
    state: 'ready',
    presentation: mediaPresentation(),
  }));
  const get = vi.spyOn(client, 'getMediaProbe').mockImplementation(async (id) => ({
    id,
    expiresAt: Date.now() + 300_000,
    state: 'ready',
    presentation: mediaPresentation(),
  }));
  const submit = vi.spyOn(client, 'submitMediaProbe').mockImplementation(async (id, request) => ({
    id,
    submissionId: request.submissionId,
    gid: 'native-gid',
  }));
  const cancel = vi
    .spyOn(client, 'cancelMediaProbe')
    .mockImplementation(async (id) => ({ id, state: 'cancelled' }));
  const args = {
    duplicateGuard: new DuplicateDownloadGuard(),
    client,
    getSettings: () => settings,
    connectionKey: async () => key,
    activate: vi.fn().mockResolvedValue(true),
    sendFile: vi.fn().mockResolvedValue(true),
    validateCandidate: vi.fn().mockResolvedValue(true),
  };
  const workflow = createMediaWorkflow({ ...args, catalog });
  return {
    catalog,
    candidate,
    client,
    create,
    get,
    submit,
    cancel,
    args,
    workflow,
    changeConnection: () => {
      key = 'connection-two';
    },
    operation: () => catalog.run((state) => state.operations[0]),
  };
}

describe('media probe and selection lifecycle', () => {
  it('allows explicit file resends to reach the existing delivery guard', async () => {
    const f = await fixture();
    await f.catalog.run((state) => {
      state.candidates[0]!.kind = 'file';
      state.candidates[0]!.sentToDesktop = true;
    }, true);
    await f.workflow.downloadFile(1, f.candidate.id);
    f.args.sendFile.mockRejectedValueOnce(new MediaApiError('duplicate_blocked'));
    await expect(f.workflow.downloadFile(1, f.candidate.id)).rejects.toMatchObject({
      code: 'duplicate_blocked',
    });
    await f.workflow.downloadFile(1, f.candidate.id);
    expect(f.args.sendFile).toHaveBeenCalledTimes(3);
  });
  it('starts a new explicit media submission after completion and honors the shared duplicate window', async () => {
    const f = await fixture();
    f.args.getSettings().duplicateGuard = { enabled: true, windowSeconds: 10 };
    await f.workflow.probe(1, f.candidate.id);
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    const first = (await f.operation())!.request.id;
    await f.workflow.probe(1, f.candidate.id);
    expect((await f.operation())!.request.id).not.toBe(first);
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(await f.operation()).toMatchObject({ state: 'ready', error: 'duplicate_blocked' });
    f.args.getSettings().duplicateGuard.enabled = false;
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(await f.operation()).toMatchObject({ state: 'submitted' });
  });

  it('does not accept another submission receipt as success', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.submit.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    const operation = await f.operation();
    if (!operation) throw new Error('Missing operation');
    f.get.mockResolvedValueOnce({
      id: operation.request.id,
      expiresAt: Date.now() + 300_000,
      state: 'submitted',
      submissionId: crypto.randomUUID(),
      gid: 'unrelated-task',
    });
    await f.workflow.poll(1, f.candidate.id);
    expect(await f.operation()).toMatchObject({ state: 'submitting', error: 'conflict' });
    expect((await f.operation())?.gid).toBeUndefined();
  });
  it('inspects once for concurrent clicks, then submits only the chosen native track IDs', async () => {
    const f = await fixture();
    await Promise.all([f.workflow.probe(1, f.candidate.id), f.workflow.probe(1, f.candidate.id)]);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.operation())?.state).toBe('ready');
    await f.workflow.submit(1, f.candidate.id, {
      ...mediaSelection,
      videoId: 'video-720',
      format: 'mkv',
    });
    expect(f.submit.mock.calls[0]?.[1].selection).toMatchObject({
      videoId: 'video-720',
      format: 'mkv',
    });
    expect(await f.operation()).toMatchObject({ state: 'submitted', gid: 'native-gid' });
  });
  it('replays the same probe ID after a lost creation response and worker restart', async () => {
    const f = await fixture();
    f.create.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.probe(1, f.candidate.id);
    expect(await f.operation()).toMatchObject({ state: 'probing', error: 'timeout' });
    const restarted = createMediaWorkflow({ ...f.args, catalog: createMediaCatalog() });
    await restarted.poll(1, f.candidate.id);
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.create.mock.calls[0]?.[0].id).toBe(f.create.mock.calls[1]?.[0].id);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('reconciles a lost submission reply without creating another task', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.submit.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    const pending = await f.operation();
    expect(pending).toMatchObject({ state: 'submitting', error: 'timeout' });
    if (!pending?.submissionId) throw new Error('Missing submission identity');
    f.get.mockResolvedValueOnce({
      id: pending.request.id,
      expiresAt: Date.now() + 300_000,
      state: 'submitted',
      submissionId: pending.submissionId,
      gid: 'already-created',
    });
    const restarted = createMediaCatalog();
    await createMediaWorkflow({ ...f.args, catalog: restarted }).poll(1, f.candidate.id);
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(await restarted.run((state) => state.operations[0])).toMatchObject({
      state: 'submitted',
      gid: 'already-created',
    });
  });
  it('retries an unacknowledged selection using the same immutable submission identity', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.submit.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    await f.workflow.poll(1, f.candidate.id);
    expect(f.submit).toHaveBeenCalledTimes(2);
    expect(f.submit.mock.calls[0]).toEqual(f.submit.mock.calls[1]);
    expect((await f.operation())?.state).toBe('submitted');
  });
  it('still checks a submitted receipt after the inspection lease expires', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.submit.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    const pending = await f.operation();
    if (!pending?.submissionId || !pending.probe) throw new Error('Missing pending operation');
    await f.catalog.run((state) => {
      const operation = state.operations[0];
      if (operation?.probe) operation.probe.expiresAt = Date.now() - 1;
    }, true);
    f.get.mockResolvedValueOnce({
      id: pending.request.id,
      expiresAt: Date.now() - 1,
      state: 'submitted',
      submissionId: pending.submissionId,
      gid: 'completed-during-timeout',
    });
    await f.workflow.poll(1, f.candidate.id);
    expect(await f.operation()).toMatchObject({
      state: 'submitted',
      gid: 'completed-during-timeout',
    });
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('refuses invalid selections, stale pages, and changed desktop connections before submission', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    await expect(
      f.workflow.submit(1, f.candidate.id, { ...mediaSelection, videoId: 'unavailable' }),
    ).rejects.toMatchObject({ code: 'unsupported_selection' });
    f.args.validateCandidate.mockResolvedValueOnce(false);
    await expect(f.workflow.submit(1, f.candidate.id, mediaSelection)).rejects.toMatchObject({
      code: 'source_expired',
    });
    f.changeConnection();
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await f.operation()).toMatchObject({ state: 'failed', error: 'connection_changed' });
  });
  it('does not fall back to ordinary file submission when media integration is absent', async () => {
    const f = await fixture();
    vi.mocked(f.client.mediaCapabilities).mockRejectedValueOnce(
      new MediaApiError('integration_unavailable'),
    );
    const ordinary = vi.spyOn(f.client, 'addDownload');
    await expect(f.workflow.probe(1, f.candidate.id)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    expect(ordinary).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(await f.operation()).toBeUndefined();
  });
  it('keeps cancellation pending until acknowledged and never cancels an already submitted download', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.cancel.mockRejectedValueOnce(new ApiTimeoutError(5000));
    await f.workflow.cancel(1, f.candidate.id);
    expect(await f.operation()).toMatchObject({ state: 'cancelling', error: 'timeout' });
    await f.workflow.poll(1, f.candidate.id);
    expect((await f.operation())?.state).toBe('cancelled');
    await f.workflow.probe(1, f.candidate.id);
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    await f.workflow.cancel(1, f.candidate.id);
    expect(f.cancel).toHaveBeenCalledTimes(2);
    expect((await f.operation())?.state).toBe('submitted');
  });
  it('does not reinterpret malformed submission replies as a definitive failure', async () => {
    const f = await fixture();
    await f.workflow.probe(1, f.candidate.id);
    f.submit.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      submissionId: crypto.randomUUID(),
      gid: 'other',
    });
    await f.workflow.submit(1, f.candidate.id, mediaSelection);
    expect(await f.operation()).toMatchObject({ state: 'submitting', error: 'invalid_response' });
    await f.workflow.probe(1, f.candidate.id);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
});
