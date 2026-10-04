# Ordinary download handoff

The desktop provides protocol 2 in `services/downloads/contracts.rs`. This
repository owns its consumer validators in `lib/download/contracts.ts`; it does
not import desktop source or run desktop fixtures. The provider's full contract
is documented in [Download ownership](https://github.com/AnInsomniacy/rayburst/blob/main/docs/DOWNLOADS.md).

Before `POST /add`, check authenticated `GET /downloads/capabilities` for
`protocolVersion: 2` and `filenameHints: true`. An old queued response is not a
receipt. Each request has an immutable UUID `id`, URL and optional browser context.
A retry reuses the exact request, including its ID. Receipts echo the ID and return
`submitted` with a GID, `needs-confirmation`, or `cancelled`.

The extension captures names from native browser events and passes decoded text.
`filenameSource: browser` identifies browser-resolved names, including Firefox's
Content-Disposition result; `suggested` identifies a weaker name hint. The engine
owns output path safety, final response headers, conflicts and recovery. Do not
perform another charset guess or percent-decoding pass over a browser filename.
Media page titles use the separate [media API](MEDIA_API.md). URL suggestions also
recognize `filename=` query parameters using native URL decoding and existing path
sanitization. The original request URL remains the task source; redirect URLs are
metadata. Native webRequest IDs preserve the original hop and its own credentials.
Ambiguous contexts are not reused across tabs or origins.

Before posting, `lib/download/pending.ts` writes a bounded journal (100 requests)
to `browser.storage.local`, keyed by the immutable request ID. It survives worker
and browser restarts. Replay uses only the original connection and payload. A matching
receipt clears captured credentials after the browser download has been cancelled;
an ambiguous mutation remains pending. Diagnostics report unresolved submissions.
Do not sync this journal or silently evict an unresolved request to make room.
Private browser downloads remain in the browser and never enter this journal.

Chromium holds filename determination until handoff settles and calls `suggest`
exactly once. Firefox holds attachment responses through its native Promise-based
blocking callback; its downloads fallback pauses and resumes the original item.
Preflight failures release the original request, never a synthetic replacement GET.
HTML/page-save and known non-GET requests stay in the browser before site rules run.
Site rules normalize pasted HTTP(S) URLs to hostnames and use the existing picomatch
matcher. Firefox defers extension exclusions until a native filename or known MIME
type is available instead of treating unknown response metadata as a final name.
Actual request cookies take precedence; fallback uses the captured cookie store and
the browser's partition key when available. Raw Content-Disposition header bytes
are decoded at that boundary only, never by re-decoding browser-supplied filenames.

The desktop persists confirmations until submission or cancellation. Dialog drafts
retain receipt IDs when URLs are edited, merged or removed. Closing the draft
cancels unresolved receipts; submitted receipts remain submitted.

Behavior tests cover browser takeover, hint preservation, capability negotiation,
receipt identity, ambiguous delivery and worker restart. Run `pnpm compile`,
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
an upgrade link. The old Motrix Next discovery response is recognized only to
explain the failure; its API is not supported. Compatibility failures stop native
activation retries and download submission before ownership transfers.

The `rayburst://` scheme activates the desktop only. It never creates a download or
transports cookies. Downloads use the authenticated HTTP handoff and its receipts.
