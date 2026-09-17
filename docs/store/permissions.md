# Permission Justifications

Text to enter in the Chrome Web Store Developer Dashboard when prompted to justify each permission.

---

## Required Permissions

### `webNavigation`

Used to associate discovered media with its actual tab, frame, and document; remove
stale sources after navigation; and retain correct provenance across same-document
history changes. No browsing history is exported or sent to a remote service.

### `scripting`, `tabs`, `sidePanel`

Explicit deep-search and capture modes install bounded page-world hooks with the
native scripting API. Tab/frame identity scopes captured data. The media workspace
shows the current tab or all tabs and opens in Chromium's native side panel;
Firefox uses `sidebarAction`.

### `declarativeNetRequest`

Applies an opt-in mobile User-Agent as a tab-scoped session rule. The rule is removed
when disabled or when its tab closes.

### `webRequestFilterResponse` (Firefox only)

Opt-in deep search inspects bounded response copies while forwarding the original
bytes unchanged. Observations are processed locally.

### `alarms`

Runs bounded media session cleanup after extension worker suspension. It expires
inactive local media metadata and request context. It also resumes user-requested batch and automatic media queues.

### Media discovery and session storage

The Sniffer tab displays resources discovered from response MIME types, media URLs and public media elements.
`storage.session` holds a bounded catalogue and operation receipts until expiry or
browser restart. Cookie/header controls apply to captured context; only user-selected
media inspection sends that context to the local desktop. Source credentials are not
exposed to content scripts or included in settings backups. Native Messaging remains
activation-only. See [Media](../MEDIA.md) for scope and retention.

### `downloads`

```
The 'downloads' permission is the core of this extension's functionality. On Chromium browsers, the extension cancels an eligible browser task during Chrome's filename event before native save-location handling continues. Downloads that should remain in the browser are restarted as extension-owned tasks so Chrome presents one save dialog under the user's existing preference. On Firefox, the permission restarts browser fallbacks and handles download types that do not expose an interceptable HTTP response. Without this permission, the extension cannot intercept or manage downloads.
```

### `storage`

```
Used to persist user-configured settings in chrome.storage.local, including: API connection parameters (port number, authentication token), download behavior preferences (enabled/disabled, auto-launch, cookie forwarding, download bar visibility), per-site interception rules, appearance preferences (theme, color scheme, language), and a privacy-sanitized diagnostic event log for troubleshooting. No data is ever sent to any remote server — all storage is local-only.
```

### `contextMenus`

```
Adds a single "Download with Rayburst" context menu item that appears when right-clicking on links, images, audio, and video elements. This allows users to manually send a specific resource to the Rayburst download manager without relying on automatic interception. The context menu is registered once at extension startup and its title updates to match the user's selected language.
```

### `notifications`

```
Displays a brief desktop notification when the duplicate guard skips a repeated download request. The desktop app owns normal task start, progress, completion, and error notifications.
```

### `webRequest`

```
Observes request headers for download requests. On Firefox, it also inspects response headers so attachments and binary MIME responses can be handled before the native save dialog opens. Request headers are filtered to a strict allowlist and forwarded only to the local Rayburst API so the desktop app can reproduce browser-authenticated downloads more accurately. Users can disable request header forwarding in Settings. The extension does not transmit request metadata to any external service.
```

### `webRequestBlocking` (Firefox only)

```
Firefox opens its native save dialog before the downloads API exposes a download item. This permission lets the extension synchronously cancel confirmed attachment and binary responses before native save handling begins. Desktop routing continues asynchronously. Browser-mode failures are restarted as a single Firefox-owned download that follows the user's save-location preference. Chromium browsers do not request this permission.
```

### `nativeMessaging`

```
Activates the installed Rayburst desktop application when its local HTTP API is unavailable. The extension sends one fixed {"action":"activate"} request to the allowlisted dev.aninsomniacy.rayburst.browser host. The host cannot receive download URLs, cookies, request headers, file paths, or arbitrary commands. It exits immediately after requesting desktop activation.
```

## Required Host Permissions

### `http://127.0.0.1/*` and `http://localhost/*`

```
Required to communicate with the Rayburst HTTP API running on the user's local machine inside the desktop application. Task handoff and capture uploads use this local API. User-requested previews also contact the selected media source. The extension sends requests to http://127.0.0.1:{port} (default port: 29110) to submit download tasks, check connection status, query stats, and control tasks. No developer telemetry or remote processing endpoint is contacted.
```

### `cookies`

```
Required to read cookies for the download URL's domain when cookie forwarding is enabled. Cookie forwarding is enabled by default so authenticated downloads work immediately for sites that require login, such as private file hosting services. Cookies are sent ONLY to the local Rayburst instance (127.0.0.1) and are never sent through Native Messaging. Users can disable cookie forwarding in Settings.
```

### `https://*/*` and `http://*/*`

```
Required because chrome.cookies.getAll() and webRequest need matching host permissions for the target download domain. Since delegated downloads can originate from any site, broad HTTP and HTTPS access is necessary for authenticated downloads and request context preservation. Firefox also uses this access to identify attachment and binary responses before its native save dialog opens. Cookies and filtered request metadata are sent only to the local Rayburst HTTP API.
```

## Optional Permissions

### `downloads.ui`

```
When the user enables "Hide Browser Download Bar" in Settings, this optional permission is requested and then used to call chrome.downloads.setUiOptions() to suppress the browser's native download shelf after downloads are intercepted and delegated to Rayburst. Only available on Chrome 115+; the extension gracefully degrades on browsers that do not support this API.
```

---

## Privacy Practices (Dashboard Section)

### Single Purpose Description

```
Intercept browser downloads and delegate them to the Rayburst desktop download manager for accelerated multi-threaded downloading via aria2.
```

### Permission Justification Summary

```
This extension intercepts browser downloads and sends them to a locally running download manager (Rayburst). Required permissions: 'downloads' to intercept browser downloads, 'webRequest' to observe filtered request headers, 'storage' for local settings persistence, 'contextMenus' for the right-click download option, 'notifications' for duplicate download alerts, 'cookies' for authenticated download forwarding, and 'nativeMessaging' to activate the installed Rayburst application. Firefox also uses 'webRequest' and 'webRequestBlocking' to handle attachment and binary responses before its native save dialog opens. Required host permissions include localhost for the Rayburst HTTP API plus broad HTTP/HTTPS origins so cookie forwarding and request context forwarding work for downloads from any site. The only optional permission is 'downloads.ui' for hiding the Chromium download bar. No data is collected, transmitted, or shared with any external service.
```

### Data Use Disclosures

```
- Personally identifiable information: NOT collected
- Health information: NOT collected
- Financial and payment information: NOT collected
- Authentication information: NOT collected
- Personal communications: NOT collected
- Location: NOT collected
- Web history: NOT collected
- User activity: NOT collected
- Website content: NOT collected
```
