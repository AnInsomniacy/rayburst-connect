/** Loopback fixture server: pages, and deterministic files with ranges and a rate limit. */
import { createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The byte at an offset of every fixture file, so any range can be produced and checked. */
const byteAt = (offset: number) => (offset * 31 + 7) & 0xff;

function bytes(begin: number, end: number): Buffer {
  const chunk = Buffer.alloc(end - begin);
  for (let index = 0; index < chunk.length; index++) chunk[index] = byteAt(begin + index);
  return chunk;
}

export function fixtureDigest(size: number): string {
  const hash = createHash('sha256');
  for (let offset = 0; offset < size; offset += 1 << 20)
    hash.update(bytes(offset, Math.min(size, offset + (1 << 20))));
  return hash.digest('hex');
}

export interface FixtureFile {
  size: number;
  type?: string;
  /** Bytes per second across every connection to the file; unlimited when absent. */
  rate?: number;
  disposition?: string;
}

/** One budget per file, so parallel ranged connections cannot multiply the rate. */
interface Pace {
  rate: number;
  next: number;
}

export interface FixtureServer {
  origin: string;
  page(path: string, html: string): string;
  file(path: string, file: FixtureFile): string;
  close(): Promise<void>;
}

async function send(response: ServerResponse, begin: number, end: number, pace?: Pace) {
  const step = pace ? Math.max(16_384, Math.floor(pace.rate / 20)) : 1 << 20;
  for (let offset = begin; offset < end && !response.destroyed; offset += step) {
    const chunk = bytes(offset, Math.min(end, offset + step));
    if (pace) {
      const at = Math.max(Date.now(), pace.next);
      pace.next = at + (chunk.length / pace.rate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, at - Date.now()));
    }
    if (!response.write(chunk)) await new Promise((resolve) => response.once('drain', resolve));
  }
  response.end();
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const pages = new Map<string, string>();
  const files = new Map<string, FixtureFile>();
  const paces = new Map<string, Pace>();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    const html = pages.get(path);
    if (html !== undefined) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    const file = files.get(path);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': file.type ?? 'application/octet-stream',
      ...(file.disposition ? { 'Content-Disposition': file.disposition } : {}),
    };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    const begin = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(file.size, Number(range[2]) + 1) : file.size;
    if (range && begin >= file.size) {
      response.writeHead(416, { 'Content-Range': `bytes */${file.size}` }).end();
      return;
    }
    response.writeHead(range ? 206 : 200, {
      ...headers,
      'Content-Length': String(end - begin),
      ...(range ? { 'Content-Range': `bytes ${begin}-${end - 1}/${file.size}` } : {}),
    });
    if (request.method === 'HEAD') response.end();
    else void send(response, begin, end, paces.get(path));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    page(path, html) {
      pages.set(path, html);
      return origin + path;
    },
    file(path, file) {
      files.set(path, file);
      if (file.rate) paces.set(path, { rate: file.rate, next: 0 });
      return origin + path;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
