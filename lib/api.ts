/**
 * HTTP client for the Rayburst desktop app's embedded REST API
 * (Axum server at `127.0.0.1:{port}`), plus the extension's single error
 * taxonomy and desktop compatibility checks.
 *
 * Endpoints: GET /ping (no auth), GET /stat, POST /add, GET /tasks,
 * POST /tasks/{gid}/pause|resume, POST /pause-all, POST /resume-all and the
 * media API (Bearer auth when a secret is configured).
 *
 * Older desktops speak an earlier download protocol; `./legacy` adapts them.
 */
import ky, {
  HTTPError,
  NetworkError,
  TimeoutError,
  type KyInstance,
  type Options as KyOptions,
} from 'ky';
import { z } from '@/lib/validation';
import { browser } from 'wxt/browser';
import type { ConnectionConfig, DesktopIdentity, DesktopProduct, DesktopProtocol } from './schema';
import {
  AddDownloadResponseSchema,
  type AddDownloadRequest,
  type AddDownloadResponse,
} from './download/contracts';
import {
  MEDIA_API_PATH,
  MediaCapabilitiesSchema,
  MediaProbeRequestSchema,
  MediaProbeSchema,
  MediaSubmitRequestSchema,
  MediaSubmitResponseSchema,
  MediaCancelResponseSchema,
  MediaErrorResponseSchema,
  type MediaProbeRequest,
  type MediaSubmitRequest,
} from './media/contracts';
import { isMotrixNext, legacyAddRequest, legacyAddResponse } from './legacy';

z.config({ jitless: true });

// ─── Timing ─────────────────────────────────────────────

/** Short timeout for local reachability checks. */
export const API_CONNECTIVITY_TIMEOUT_MS = 500;
/** Timeout for API requests that perform real work. */
export const API_REQUEST_TIMEOUT_MS = 5000;
/**
 * `/add` answers once the engine verified the download (at most ~25 s) or the
 * user confirmed it in the desktop dialog (at most 120 s).
 */
export const API_HANDOFF_TIMEOUT_MS = 150_000;
/** Retry attempts for failed API calls. */
const API_MAX_RETRIES = 1;

// ─── Errors ─────────────────────────────────────────────

/** API communication error. Subclasses classify the failure mode. */
class ApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiUnreachableError extends ApiError {
  constructor(cause?: unknown) {
    super('Cannot connect to Rayburst API', cause);
    this.name = 'ApiUnreachableError';
  }
}

export class ApiAuthError extends ApiError {
  constructor(cause?: unknown) {
    super('HTTP 401 Unauthorized: API secret is incorrect', cause);
    this.name = 'ApiAuthError';
  }
}

export class ApiCompatibilityError extends ApiError {
  constructor(
    public readonly version: string | null = null,
    cause?: unknown,
  ) {
    super('Install the latest Rayburst to connect', cause);
    this.name = 'ApiCompatibilityError';
  }
}

export class ApiTimeoutError extends ApiError {
  constructor(timeoutMs: number) {
    super(`API call timed out after ${timeoutMs}ms`);
    this.name = 'ApiTimeoutError';
  }
}

export class ApiEngineError extends ApiError {
  constructor(public readonly code: 'engine_starting' | 'engine_unavailable') {
    super(
      code === 'engine_starting' ? 'Rayburst engine is starting' : 'Rayburst engine is unavailable',
    );
    this.name = code === 'engine_starting' ? 'ApiEngineStartingError' : 'ApiEngineUnavailableError';
  }
}

export class MediaApiError extends ApiError {
  constructor(public readonly code: string) {
    super('Media request failed');
    this.name = 'MediaApiError';
  }
}

// ─── Response Schemas ───────────────────────────────────
// Validate the fields consumed by the extension at the HTTP boundary.

const DiscoveryResponseSchema = z.object({
  product: z.string().optional(),
  status: z.literal('ok'),
  version: z.string().min(1),
});

const DownloadCapabilitiesSchema = z.object({
  product: z.literal('rayburst'),
  protocolVersion: z.union([z.literal(2), z.literal(3)]),
});

const StatResponseSchema = z.object({
  downloadSpeed: z.string(),
  uploadSpeed: z.string(),
  numActive: z.string(),
  numWaiting: z.string(),
  numStopped: z.string(),
  numStoppedTotal: z.string(),
});

const ActionResponseSchema = z.object({ status: z.string(), error: z.string().optional() });

const DesktopTaskSchema = z.object({
  gid: z.string(),
  name: z.string(),
  status: z.string(),
  totalLength: z.string(),
  completedLength: z.string(),
  downloadSpeed: z.string(),
  errorMessage: z.string().optional(),
});

const TasksResponseSchema = z.object({
  stat: StatResponseSchema,
  tasks: z.array(DesktopTaskSchema),
});

export type { DesktopIdentity, DesktopProduct, DesktopProtocol };
export type PingResponse = Omit<DesktopIdentity, 'protocol'>;
export type StatResponse = z.output<typeof StatResponseSchema>;
export type DesktopTask = z.output<typeof DesktopTaskSchema>;
export type TasksResponse = z.output<typeof TasksResponseSchema>;
type ActionResponse = z.output<typeof ActionResponseSchema>;

// ─── Client ─────────────────────────────────────────────

export class DesktopApiClient {
  private config: ConnectionConfig;
  private http: KyInstance;

  /** `onIdentify` hears every desktop that answered a readiness check or a handoff. */
  constructor(
    config: ConnectionConfig,
    private readonly onIdentify?: (desktop: DesktopIdentity) => void,
  ) {
    this.config = { ...config };
    this.http = this.createHttpClient();
  }

  /** Update config at runtime (e.g. when the user changes the port). */
  updateConfig(config: ConnectionConfig): void {
    this.config = { ...config };
    this.http = this.createHttpClient();
  }

  private createHttpClient(): KyInstance {
    return ky.create({
      prefix: `http://127.0.0.1:${this.config.port}`,
      credentials: 'omit',
      cache: 'no-store',
      timeout: API_REQUEST_TIMEOUT_MS,
      retry: { limit: API_MAX_RETRIES, methods: ['get'] },
    });
  }

  /** Bearer auth headers; empty when no secret is configured. */
  private authHeaders(): Record<string, string> {
    return {
      'X-Rayburst-Client': 'rayburst-connect',
      ...(this.config.secret ? { Authorization: `Bearer ${this.config.secret}` } : {}),
    };
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: KyOptions,
    label: string,
  ): Promise<T> {
    try {
      const payload = await this.http(path, options).json<unknown>();
      return schema.parse(payload);
    } catch (error) {
      if (
        path === 'downloads/capabilities' &&
        (error instanceof z.ZodError ||
          (error instanceof HTTPError && [404, 405].includes(error.response.status)))
      )
        throw new ApiCompatibilityError(null, error);
      if (path.startsWith(MEDIA_API_PATH)) {
        if (error instanceof z.ZodError) throw new MediaApiError('invalid_response');
        if (error instanceof HTTPError && error.response.status !== 401) {
          const parsed = MediaErrorResponseSchema.safeParse(error.data);
          const code = parsed.success
            ? parsed.data.error
            : [404, 405].includes(error.response.status)
              ? 'integration_unavailable'
              : error.response.status === 410
                ? 'expired'
                : 'desktop_error';
          throw new MediaApiError(code);
        }
      }
      throw normalizeApiError(
        error,
        label,
        typeof options.timeout === 'number' ? options.timeout : API_REQUEST_TIMEOUT_MS,
      );
    }
  }

  /** Heartbeat check — no authentication required. */
  async ping(): Promise<PingResponse> {
    const discovery = await this.request(
      'ping',
      DiscoveryResponseSchema,
      { timeout: API_CONNECTIVITY_TIMEOUT_MS, retry: 0 },
      'Ping',
    );
    if (discovery.product === 'rayburst')
      return { product: 'rayburst', version: discovery.version };
    if (isMotrixNext(discovery)) return { product: 'motrix-next', version: discovery.version };
    throw new ApiCompatibilityError(discovery.version);
  }

  async getStat(): Promise<StatResponse> {
    return this.request(
      'stat',
      StatResponseSchema,
      { method: 'GET', headers: this.authHeaders() },
      'Get stat',
    );
  }

  /** Motrix Next predates the capabilities endpoint. */
  async downloadProtocol(product: DesktopProduct): Promise<DesktopProtocol> {
    if (product === 'motrix-next') return 1;
    const capabilities = await this.request(
      'downloads/capabilities',
      DownloadCapabilitiesSchema,
      { method: 'GET', headers: this.authHeaders(), retry: 0 },
      'Check download support',
    );
    return capabilities.protocolVersion;
  }

  private async identify(): Promise<DesktopIdentity> {
    const desktop = await this.ping();
    const identity = { ...desktop, protocol: await this.downloadProtocol(desktop.product) };
    this.onIdentify?.(identity);
    return identity;
  }

  /** Hands a download to the desktop; the answer decides who downloads it. */
  addDownload(request: AddDownloadRequest): Promise<AddDownloadResponse> {
    // Settings may change while the desktop is identified. Bind the handoff
    // to the connection it started on.
    return new DesktopApiClient(this.config, this.onIdentify).submitDownload(request);
  }

  private async submitDownload(request: AddDownloadRequest): Promise<AddDownloadResponse> {
    const { protocol } = await this.identify();
    // A held download keeps the worker busy without browser events.
    const awake = setInterval(() => {
      // Any extension API call resets the worker's idle timer.
      Promise.resolve()
        .then(() => browser.runtime.getPlatformInfo())
        .catch(() => undefined);
    }, 20_000);
    try {
      return await this.request(
        'add',
        protocol === 3 ? AddDownloadResponseSchema : legacyAddResponse(protocol),
        {
          method: 'POST',
          headers: this.authHeaders(),
          json: protocol === 3 ? request : legacyAddRequest(request, protocol),
          retry: 0,
          timeout: API_HANDOFF_TIMEOUT_MS,
        },
        'Add download',
      );
    } finally {
      clearInterval(awake);
    }
  }

  async getTasks(): Promise<TasksResponse> {
    return this.request(
      'tasks',
      TasksResponseSchema,
      { method: 'GET', headers: this.authHeaders() },
      'List tasks',
    );
  }

  async pauseTask(gid: string): Promise<ActionResponse> {
    return this.request(
      `tasks/${encodeURIComponent(gid)}/pause`,
      ActionResponseSchema,
      { method: 'POST', headers: this.authHeaders() },
      'Pause task',
    );
  }

  async resumeTask(gid: string): Promise<ActionResponse> {
    return this.request(
      `tasks/${encodeURIComponent(gid)}/resume`,
      ActionResponseSchema,
      { method: 'POST', headers: this.authHeaders() },
      'Resume task',
    );
  }

  async revealTask(gid: string): Promise<ActionResponse> {
    return this.request(
      `tasks/${encodeURIComponent(gid)}/reveal`,
      ActionResponseSchema,
      { method: 'POST', headers: this.authHeaders() },
      'Show task in folder',
    );
  }

  async createCapture(id: string) {
    return this.request(
      `${MEDIA_API_PATH}/assets/${id}`,
      z.object({ id: z.uuid() }),
      { method: 'POST', headers: this.authHeaders(), retry: 0 },
      'Create capture',
    );
  }
  async appendCapture(id: string, stream: number, offset: number, bytes: Uint8Array<ArrayBuffer>) {
    return this.request(
      `${MEDIA_API_PATH}/assets/${id}/${stream}`,
      z.object({ offset: z.number().int().nonnegative() }),
      {
        method: 'PUT',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/octet-stream',
          'X-Upload-Offset': String(offset),
        },
        body: bytes,
        retry: 0,
        timeout: 15000,
      },
      'Save capture',
    );
  }
  async discardCapture(id: string) {
    return this.request(
      `${MEDIA_API_PATH}/assets/${id}`,
      z.object({ id: z.uuid() }),
      { method: 'DELETE', headers: this.authHeaders(), retry: 0 },
      'Discard empty capture',
    );
  }
  async sealCapture(id: string) {
    return this.request(
      `${MEDIA_API_PATH}/assets/${id}/seal`,
      z.object({
        id: z.uuid(),
        streams: z.array(z.object({ stream: z.number(), size: z.number() })),
      }),
      { method: 'POST', headers: this.authHeaders(), retry: 0 },
      'Finish capture',
    );
  }
  captureResource(id: string, stream: number) {
    return {
      url: `http://127.0.0.1:${this.config.port}/${MEDIA_API_PATH}/assets/${id}/${stream}`,
      headers: Object.entries(this.authHeaders()).map(([name, value]) => ({
        name: name.toLowerCase(),
        value,
      })),
    };
  }

  async mediaCapabilities() {
    return this.request(
      `${MEDIA_API_PATH}/capabilities`,
      MediaCapabilitiesSchema,
      { headers: this.authHeaders(), retry: 0 },
      'Media capabilities',
    );
  }

  async createMediaProbe(request: MediaProbeRequest) {
    return this.request(
      `${MEDIA_API_PATH}/probes`,
      MediaProbeSchema,
      {
        method: 'POST',
        headers: this.authHeaders(),
        json: MediaProbeRequestSchema.parse(request),
        retry: 0,
      },
      'Probe media',
    );
  }

  async getMediaProbe(id: string) {
    return this.request(
      `${MEDIA_API_PATH}/probes/${encodeURIComponent(id)}`,
      MediaProbeSchema,
      { headers: this.authHeaders(), retry: 0 },
      'Read media probe',
    );
  }

  async submitMediaProbe(id: string, request: MediaSubmitRequest) {
    return this.request(
      `${MEDIA_API_PATH}/probes/${encodeURIComponent(id)}/submit`,
      MediaSubmitResponseSchema,
      {
        method: 'POST',
        headers: this.authHeaders(),
        json: MediaSubmitRequestSchema.parse(request),
        retry: 0,
      },
      'Submit media',
    );
  }

  async cancelMediaProbe(id: string) {
    return this.request(
      `${MEDIA_API_PATH}/probes/${encodeURIComponent(id)}/cancel`,
      MediaCancelResponseSchema,
      { method: 'POST', headers: this.authHeaders(), json: {}, retry: 0 },
      'Cancel media probe',
    );
  }

  async pauseAll(): Promise<ActionResponse> {
    return this.request(
      'pause-all',
      ActionResponseSchema,
      { method: 'POST', headers: this.authHeaders() },
      'Pause all',
    );
  }

  async resumeAll(): Promise<ActionResponse> {
    return this.request(
      'resume-all',
      ActionResponseSchema,
      { method: 'POST', headers: this.authHeaders() },
      'Resume all',
    );
  }

  /** Throws permanent failures so activation never retries an incompatible desktop. */
  async checkReady(): Promise<boolean> {
    const desktop = await this.ping();
    await this.request(
      'stat',
      StatResponseSchema,
      {
        method: 'GET',
        headers: this.authHeaders(),
        timeout: API_CONNECTIVITY_TIMEOUT_MS,
        retry: 0,
      },
      'Check readiness',
    );
    this.onIdentify?.({ ...desktop, protocol: await this.downloadProtocol(desktop.product) });
    return true;
  }

  async isReady(): Promise<boolean> {
    try {
      return await this.checkReady();
    } catch {
      return false;
    }
  }
}

/**
 * Classify a transport-level failure into the extension's error taxonomy.
 * This is the ONLY place errors are classified — downstream code uses
 * `instanceof` exclusively.
 */
function normalizeApiError(error: unknown, label: string, timeoutMs: number): unknown {
  if (error instanceof HTTPError) {
    if (error.response.status === 401) return new ApiAuthError(error);
    const engine = z
      .object({ error: z.enum(['engine_starting', 'engine_unavailable']) })
      .safeParse(error.data);
    if (error.response.status === 503 && engine.success)
      return new ApiEngineError(engine.data.error);
    const detail =
      typeof error.data === 'string' && error.data ? ` — ${error.data.slice(0, 200)}` : '';
    return new ApiError(`${label} failed: HTTP ${error.response.status}${detail}`, error);
  }
  if (error instanceof TimeoutError) return new ApiTimeoutError(timeoutMs);
  if (error instanceof NetworkError) return new ApiUnreachableError(error);
  return error;
}

// ─── Connection Check ───────────────────────────────────

export type ConnectionStatus = 'connected' | 'disconnected';

type ConnectionResult =
  | ({ status: 'connected'; stat: StatResponse } & DesktopIdentity)
  | { status: 'disconnected'; version: string | null; error: string };

/**
 * Verify product identity, authentication and the supported download contract.
 */
export async function checkConnection(
  client: Pick<DesktopApiClient, 'ping' | 'getStat' | 'downloadProtocol'>,
): Promise<ConnectionResult> {
  let version: string | null = null;
  try {
    const desktop = await client.ping();
    version = desktop.version;
    const stat = await client.getStat();
    const protocol = await client.downloadProtocol(desktop.product);
    return { status: 'connected', ...desktop, protocol, stat };
  } catch (error) {
    return {
      status: 'disconnected',
      version: error instanceof ApiCompatibilityError ? (error.version ?? version) : version,
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}
