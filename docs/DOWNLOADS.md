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
Media page titles use the separate [media API](MEDIA_API.md).

Before posting, `lib/download/pending.ts` stores the request and original connection
in native `browser.storage.session`, keyed by request ID. Worker startup replays
unresolved requests against that connection only. This survives worker suspension;
it does not persist across browser restart, extension reload or disable. Matching
receipts clear the entry. An ambiguous mutation retains it and must not restart the
download in the browser, because the desktop may already own the task. A failed
capability/authentication check before posting can use the existing browser fallback.

Native session storage avoids another persistence layer and keeps captured browser
credentials out of disk-backed extension storage. See the browser's
[storage lifecycle](https://developer.chrome.com/docs/extensions/reference/api/storage).
The desktop persists confirmations until the user submits or cancels them, so a
worker can release its request after receiving `needs-confirmation`.

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

The `rayburst://` scheme activates the desktop only. It never creates a download or
transports cookies. Downloads use the authenticated HTTP handoff and its receipts.
