/** Export the structural wire schemas for desktop implementers and contract fixtures. */
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { format, resolveConfig } from 'prettier';
import { fileURLToPath } from 'node:url';
import {
  MEDIA_PROTOCOL_VERSION,
  MEDIA_API_PATH,
  MediaCapabilitiesSchema,
  MediaProbeRequestSchema,
  MediaProbeSchema,
  MediaSubmitRequestSchema,
  MediaSubmitResponseSchema,
  MediaCancelResponseSchema,
  MediaErrorResponseSchema,
} from '../lib/media/contracts';

const definitions = {
  capabilities: MediaCapabilitiesSchema,
  probeRequest: MediaProbeRequestSchema,
  probeResponse: MediaProbeSchema,
  submitRequest: MediaSubmitRequestSchema,
  submitResponse: MediaSubmitResponseSchema,
  cancelResponse: MediaCancelResponseSchema,
  errorResponse: MediaErrorResponseSchema,
};
const target = new URL('../docs/media-api.schema.json', import.meta.url);
const output = await format(
  JSON.stringify({
    protocolVersion: MEDIA_PROTOCOL_VERSION,
    basePath: `/${MEDIA_API_PATH}`,
    schemas: Object.fromEntries(
      Object.entries(definitions).map(([key, schema]) => [
        key,
        z.toJSONSchema(schema, { reused: 'inline' }),
      ]),
    ),
  }),
  { ...(await resolveConfig(fileURLToPath(target))), parser: 'json' },
);
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')).replace(/\r\n/g, '\n') !== output.replace(/\r\n/g, '\n'))
    throw new Error('Media schemas are stale. Run pnpm media:contract.');
} else await writeFile(target, output);
