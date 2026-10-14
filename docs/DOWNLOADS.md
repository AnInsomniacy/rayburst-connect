# Ordinary download handoff

The desktop provides protocol 3 in `services/downloads/contracts.rs`. This
repository owns its consumer validators in `lib/download/contracts.ts`; it does
not import desktop source or run desktop fixtures. The provider's full contract
is documented in [Download ownership](https://github.com/AnInsomniacy/rayburst/blob/main/docs/DOWNLOADS.md).

Before `POST /add`, check authenticated `GET /downloads/capabilities` for
`protocolVersion: 3`. The browser keeps holding its download until `/add` answers:
`added` (with a GID) and `cancelled` release it; `fallback` (with a reason), an
error, a timeout or a lost answer let the browser continue. A held download sends
`verify: true` with the MIME type and size the browser received, so the desktop
can check with the engine that it would receive the same file. The request may
stay open up to 150 s while the user confirms in the desktop; the worker keeps
itself alive meanwhile. Nothing is journaled and nothing is replayed.

The extension captures names from native browser events and passes decoded text.
`filenameSource: browser` identifies browser-resolved names, including Firefox's
Content-Disposition result; `suggested` identifies a weaker name hint. The engine
owns output path safety, final response headers, conflicts and recovery. Do not
perform another charset guess or percent-decoding pass over a browser filename.
Media page titles use the separate [media API](MEDIA_API.md). URL suggestions also
recognize `filename=` query parameters using native URL decoding and existing path
sanitization. The original request URL remains the task source; redirect URLs are
metadata. Native webRequest IDs preserve the original hop and its own credentials.
Chromium names the page itself as the download URL when the page leaves with
`location.replace()`; when the final request was never redirected, it is the
source. Ambiguous contexts are not reused across tabs or origins.

An Alt-click on a link (or anywhere, for script-started downloads) leaves the
download that begins within five seconds to the browser. The content script reports
the click on mouse-down so the worker knows before the browser creates the item;
browser download items carry no tab, so the clicked URL is the match.

Private browser downloads remain in the browser. Version 2 kept a handoff journal
under `pending-download:` keys; the background removes those entries at startup.

Chromium holds filename determination until the desktop answers, but keeps
receiving data meanwhile, so the extension also pauses the item. Only a download
the browser continues is resumed and given its filename through `suggest`; a
released one is cancelled. Firefox holds attachment responses through its native
Promise-based blocking callback; its downloads fallback pauses and resumes the
original item the same way.
Preflight failures release the original request, never a synthetic replacement GET.
HTML/page-save and known non-GET requests stay in the browser before site rules run.
Site rules normalize pasted HTTP(S) URLs to hostnames and use the existing picomatch
matcher. Firefox defers extension exclusions until a native filename or known MIME
type is available instead of treating unknown response metadata as a final name.
Actual request cookies take precedence; fallback uses the captured cookie store and
the browser's partition key when available. Raw Content-Disposition header bytes
are decoded at that boundary only, never by re-decoding browser-supplied filenames.

The desktop dialog answers a held download when the user adds or removes it;
closing the dialog answers `cancelled`. An unanswered request falls back after
120 s and is withdrawn from the dialog.

Behavior tests cover browser takeover, hint preservation, capability negotiation,
verification fields, every answer and a lost answer. Run `pnpm compile`,
`pnpm test --maxWorkers=4`, lint, i18n, format checks and Chromium/Firefox builds.
Manual acceptance uses separately built extension, desktop and engine applications;
there is no parent workspace package or cross-repository test runner.

## Product identity

The desktop advertises `product: "rayburst"` in `/ping`, download capabilities and
media capabilities. Rayburst Connect validates that field and sends
`X-Rayburst-Client: rayburst-connect` on authenticated requests. Browser-origin
requests without that header are rejected. Native clients without an Origin header
continue to authenticate with the Extension API secret.

Connection checks validate the product, credentials and download capabilities.
An unsupported desktop is shown in both the popup and connection settings with
an upgrade link. Compatibility failures stop native activation retries and
download submission before ownership transfers.

## Older desktops

`lib/legacy.ts` keeps two older desktops working; deleting it and its references
drops them:

| Desktop          | Recognized by                          | Download protocol                                                     |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Motrix Next 3.8+ | `/ping` without `product`              | 1: `/add` without request ID; any answer means it queued the link     |
| Rayburst 4.0     | capabilities with `protocolVersion: 2` | 2: `/add` with a request ID; submitted, cancelled, needs-confirmation |

The adapter strips the fields they never read (`verify`, `mime`, `size`, and
`filenameSource` for Motrix Next) and reads their answers as `added` or
`cancelled`. Neither desktop verifies the file, so it never answers `fallback`,
and a download the user then declines in its dialog is lost, as with the
extensions written for them. Their popup shows counts without the task list;
Motrix Next has no media API, so only direct media files reach it. Motrix Next
before 3.8 has no HTTP API and is not supported.

An older desktop gets an update notice with a download link: in the popup it
can be closed and stays closed for that desktop and version; at the top of the
connection settings it stays.

Every context records the desktop that answered last (storage key `desktop`,
not a setting). The settings read it for their notice without a connection
test, and the worker tries that desktop's native host first: Rayburst's
`dev.aninsomniacy.rayburst.browser` or Motrix Next's `com.motrix.next.browser`,
which admits the Chromium store IDs only. A missing host moves on to the other,
so an upgrade still starts. With no answer yet Rayburst comes first.

## Starting through a link

The `rayburst://` scheme activates the desktop only. It never creates a download or
transports cookies. Downloads use the authenticated HTTP handoff and its receipts.

Native Messaging starts the desktop by default. With "Start Rayburst Through a
Browser Link (Legacy)" on, the worker skips Native Messaging and opens `rayburst://`
(`motrixnext://` for Motrix Next) in a focused tab so the browser can ask to
open the desktop, then closes the tab once the wait for readiness ends, as
desktops before Native Messaging were started. When Native Messaging fails, the
popup offers to turn the setting on and retry; the first unattended failure
shows one notification whose click turns it on.
