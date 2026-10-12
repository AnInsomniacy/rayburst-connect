/** The running Rayburst desktop: its extension API and its engine's JSON-RPC. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const IDENTIFIER = 'dev.aninsomniacy.rayburst';

function configDirectory(): string {
  if (process.env.RAYBURST_CONFIG_DIR) return process.env.RAYBURST_CONFIG_DIR;
  if (process.platform === 'win32') return join(process.env.APPDATA ?? '', IDENTIFIER);
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', IDENTIFIER);
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), IDENTIFIER);
}

interface DesktopConfig {
  apiPort: number;
  apiSecret: string;
  rpcPort: number;
  rpcSecret: string;
}

export function desktopConfig(): DesktopConfig {
  const directory = configDirectory();
  const read = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;
  const preferences = read('config.json').preferences as Record<string, unknown>;
  const system = read('system.json');
  return {
    apiPort: Number(preferences.extensionApiPort),
    apiSecret: String(preferences.extensionApiSecret ?? ''),
    rpcPort: Number(system['rpc-listen-port']),
    rpcSecret: String(system['rpc-secret'] ?? ''),
  };
}

export interface EngineFile {
  path: string;
  length: string;
}

export interface EngineStatus {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  errorCode?: string;
  errorMessage?: string;
  files: EngineFile[];
}

/** Engine JSON-RPC with the desktop's secret. */
export async function rpc<T>(method: string, ...params: unknown[]): Promise<T> {
  const { rpcPort, rpcSecret } = desktopConfig();
  const response = await fetch(`http://127.0.0.1:${rpcPort}/jsonrpc`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [`token:${rpcSecret}`, ...params],
    }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/** Every task the engine knows, in any state. */
export async function engineTasks(): Promise<EngineStatus[]> {
  const keys = [
    'gid',
    'status',
    'totalLength',
    'completedLength',
    'errorCode',
    'errorMessage',
    'files',
  ];
  const [active, waiting, stopped] = await Promise.all([
    rpc<EngineStatus[]>('aria2.tellActive', keys),
    rpc<EngineStatus[]>('aria2.tellWaiting', 0, 1000, keys),
    rpc<EngineStatus[]>('aria2.tellStopped', 0, 1000, keys),
  ]);
  return [...active, ...waiting, ...stopped];
}

export async function desktopReachable(): Promise<boolean> {
  const { apiPort } = desktopConfig();
  try {
    return (await fetch(`http://127.0.0.1:${apiPort}/ping`)).ok;
  } catch {
    return false;
  }
}

export const fileName = (task: EngineStatus): string =>
  task.files[0]?.path.split(/[\\/]/).pop() ?? '';

interface TauriWindow {
  __TAURI_INTERNALS__: { invoke(command: string, args: Record<string, unknown>): Promise<unknown> };
}

/**
 * Delete a task the way the desktop's own delete does: engine, history and
 * file. It runs inside the app's webview, so the app must expose its debugging
 * port (`pnpm e2e:app` in the desktop repository); otherwise only the engine
 * forgets the task.
 */
export async function deleteTask(gid: string): Promise<void> {
  const port = process.env.RAYBURST_E2E_CDP_PORT ?? '9223';
  const { chromium } = await import('@playwright/test');
  const app = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  const page = app?.contexts().flatMap((context) => context.pages())[0];
  if (page) {
    await page.evaluate(
      (id) =>
        (window as unknown as TauriWindow).__TAURI_INTERNALS__.invoke('aria2_delete_task', {
          gid: id,
          deleteMode: 'permanent',
        }),
      gid,
    );
    await app?.close();
    return;
  }
  await rpc('aria2.forceRemove', gid).catch(() => undefined);
  await rpc('aria2.removeDownloadResult', gid).catch(() => undefined);
}

/** The desktop extension API, authenticated as the extension is. */
export async function api<T>(path: string): Promise<T> {
  const { apiPort, apiSecret } = desktopConfig();
  const response = await fetch(`http://127.0.0.1:${apiPort}/${path}`, {
    headers: { 'X-Rayburst-Client': 'rayburst-connect', Authorization: `Bearer ${apiSecret}` },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface Tracked {
  status: EngineStatus['status'] | 'missing';
  /** The output path, kept from when the engine still listed the task. */
  path: string;
  totalLength: string;
  errorMessage?: string;
}

/**
 * Follow a task across the engine and the desktop: finished tasks move from
 * the engine into the desktop's history, so the engine soon stops knowing them.
 */
export function track(gid: string): () => Promise<Tracked> {
  let path = '';
  let totalLength = '0';
  return async () => {
    try {
      const task = await rpc<EngineStatus>('aria2.tellStatus', gid);
      path = task.files[0]?.path || path;
      totalLength = task.totalLength;
      return { status: task.status, path, totalLength, errorMessage: task.errorMessage };
    } catch {
      const { tasks } = await api<{
        tasks: {
          gid: string;
          status: EngineStatus['status'];
          totalLength: string;
          errorMessage?: string;
        }[];
      }>('tasks');
      const task = tasks.find((item) => item.gid === gid);
      return task
        ? {
            status: task.status,
            path,
            totalLength: task.totalLength,
            errorMessage: task.errorMessage,
          }
        : { status: 'missing', path, totalLength };
    }
  };
}
