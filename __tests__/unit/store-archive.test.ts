import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readManifestFromCrx } from '@/scripts/actions/store-status';

describe('store archive manifest', () => {
  it('reads a compressed ZIP following a CRX header and ignores other entries', () => {
    const archive = execFileSync('python3', [
      '-c',
      `
import io, zipfile
out = io.BytesIO()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('background.js', 'background content')
    z.writestr('manifest.json', '{"version":"2.0.1"}')
import sys
sys.stdout.buffer.write(b'Cr24' + (3).to_bytes(4, 'little') + (8).to_bytes(4, 'little') + b'header00' + out.getvalue())
`,
    ]);
    expect(readManifestFromCrx(archive)).toEqual({ version: '2.0.1' });
    expect(() => readManifestFromCrx(archive.subarray(0, 20))).toThrow();
  });
});
