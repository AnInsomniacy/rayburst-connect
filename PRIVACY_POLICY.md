# Privacy Policy — Rayburst Connect

**Last updated:** September 17, 2026

## Overview

Rayburst Connect ("the Extension") is a browser extension that intercepts browser downloads and redirects them to the [Rayburst](https://github.com/AnInsomniacy/rayburst) desktop application for accelerated downloading via aria2.

This privacy policy explains what data the Extension accesses, how it is used, and how it is protected.

## Data Collection

**The Extension does not collect, store, transmit, or share any personal data with the developer or any third party.**

The Extension operates entirely on your local machine. Task handoff and capture storage use the locally running Rayburst desktop application. User-requested previews also connect directly to the selected media source.

## Data Access

### Page Media Discovery

When media discovery is enabled, the Extension observes HTTP(S) request/response
metadata and public media elements/resource timing in browser frames. It stores
media candidate URLs, page titles, frame identity, MIME types, file-size hints and
filtered request context in browser session memory. This supports the local Media
list and user-requested desktop format inspection. Explicit deep-search modes inspect bounded response bodies and page decoding/key APIs.
Buffer and recording modes capture browser media after activation. Playlists, candidate
keys and recorded bytes are sent to the local desktop, not a developer service.

Discovery can be disabled independently, globally or by page host. Records expire
after 30 minutes without observation and are bounded by count and memory limits.
Browser restart or extension reload clears them. Settings backups exclude this data.
The popup receives metadata and operation status, not credential header values.

Cookie and request-header forwarding controls also apply to media inspection. When
exposed by the browser, Authorization and site-specific end-to-end headers may be
sent to the local desktop for the selected media. Observed media contexts
are separated by origin and document. Media submission uses observed outgoing
headers; it does not synthesize cookies from a different cookie store. The desktop uses source
credentials only for their intended resource origins when fetching the user's media.

Native Messaging remains activation-only. Missing media integration is reported;
the Extension does not silently save a manifest as a finished video.

The Extension accesses the following data solely to perform its core functionality:

### Download Metadata

When a browser download is initiated and intercepted by the Extension, it reads:

- **Download URL** — to forward to the local Rayburst HTTP API
- **Filename** — to pass to Rayburst when the browser provides a reliable name
- **HTTP Referer** — to include with the task submission when available

This data is sent only to the Rayburst HTTP API running on `127.0.0.1` (localhost) — **never to any external server**.

### Request Context

When request header forwarding is enabled, the Extension reads a limited allowlist of request
headers for intercepted downloads, such as User-Agent, Accept, language, client hints, fetch
metadata, DNT, and Origin. This helps the local Rayburst desktop application reproduce
browser-authenticated downloads more accurately.

The Extension does not forward Host, Connection, Content-Length, Transfer-Encoding, Range,
Proxy headers, conditional request headers, or Cookie through request header forwarding. Cookies
are handled separately as described below. Request header forwarding can be disabled in Settings.

Request context is sent only to the local Rayburst HTTP API running on `127.0.0.1`
(localhost) — **never to any external server**.

### Cookies

Cookie forwarding is enabled by default and uses the required cookie and site permissions declared by the Extension:

- The Extension reads cookies for the download URL's domain
- These cookies are forwarded to the local Rayburst HTTP API
- This enables authenticated downloads (e.g., from file hosting services that require login)
- **Cookies are never sent to any external server** — only to the locally running Rayburst instance
- Cookies are never sent to the activation-only Native Messaging host

The user can disable cookie forwarding in Settings at any time.

### Local Storage

The Extension stores the following user-configured preferences in `chrome.storage.local`:

- Extension API connection settings (port number, secret token)
- Download behavior preferences (enabled/disabled, auto-launch, cookie forwarding, download bar visibility)
- Site rules (per-domain interception settings)
- Appearance settings (theme, color scheme, language)
- Diagnostic event log (a local ring buffer of recent extension events for troubleshooting)

This data never leaves your browser and is not accessible to any external service.
User-initiated settings backups are downloaded locally as JSON and include the API secret so the
backup is complete. The Extension never uploads backup files.

## Network Communication

Task handoff, control and capture storage use the following local addresses:

- `http://127.0.0.1:{port}` — Rayburst HTTP API
- `http://localhost:{port}` — Rayburst HTTP API (alternative)

Where `{port}` is the user-configured API port (default: 29110).

Previews request the selected source and its manifests/segments directly. There are no analytics, remote processing services or telemetry endpoints.

## Permissions Explained

| Permission                                 | Why It's Needed                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `downloads`                                | Intercept, cancel, and erase browser downloads that are delegated to Rayburst       |
| `storage`                                  | Save user settings, site rules, and diagnostic logs locally                         |
| `contextMenus`                             | Add "Download with Rayburst" to the right-click menu                                |
| `notifications`                            | Show desktop notifications for download events                                      |
| `webRequest`                               | Read filtered request headers and filename response headers for delegated downloads |
| `webNavigation`                            | Associate media with its source frame and invalidate stale navigation data          |
| `alarms`                                   | Expire bounded media session data after worker suspension                           |
| `cookies`                                  | Forward cookies to local Rayburst for authenticated downloads                       |
| `nativeMessaging`                          | Activate the installed Rayburst desktop application                                 |
| `downloads.ui` _(optional)_                | Hide the browser download bar after interception                                    |
| `http://127.0.0.1/*`, `http://localhost/*` | Communicate with the local Rayburst HTTP API                                        |
| `https://*/*`, `http://*/*`                | Read cookies and request/response metadata for delegated downloads                  |

Page capture uses `scripting`; the resource workspace uses `tabs` and Chromium
`sidePanel` (Firefox uses its native sidebar). Mobile User-Agent rules use
`declarativeNetRequest`. Firefox deep search also uses `webRequestFilterResponse`.
Rayburst removes unclaimed capture files after 24 hours and protects pending task inputs.

## Third-Party Services

Bundled playback libraries request the media source selected by the user. There are no analytics, remote download processors, advertising or tracking mechanisms.

## Data Retention

- **Pending download requests** and their original connection are held in `browser.storage.session` until a matching receipt arrives or the browser session ends. Desktop confirmations can remain in its local database until submitted or cancelled.
- **User settings** remain in local storage until the user clears them or uninstalls the Extension
- **Diagnostic logs** use a configurable event limit (100 by default, up to 500). Logged URLs exclude credentials, query parameters, and fragments. The oldest event is overwritten when the configured limit is reached.

## Children's Privacy

The Extension does not knowingly collect any information from children under the age of 13.

## Changes to This Policy

If this privacy policy is updated, the changes will be reflected in this document with an updated "Last updated" date. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Open Source

The Extension is open source under the MIT License. The complete source code is available for inspection at:

https://github.com/AnInsomniacy/rayburst-connect

## Contact

For privacy-related questions or concerns, please open an issue on the GitHub repository:

https://github.com/AnInsomniacy/rayburst-connect/issues
