# Privacy Policy — Rayburst Connect

Last updated: September 17, 2026

Rayburst Connect is the browser companion to the Rayburst desktop download manager. It processes browser downloads and media on your device. The developer does not receive this data or operate an analytics, advertising or remote processing service.

## Data the extension handles

The extension reads download URLs, filenames, page and tab information, and selected request and response metadata to identify resources and route downloads. Sniffer keeps resource information in browser session storage. Optional deep search inspects page responses and media-related data; capture modes can record media buffers, playback, a user-selected screen or WebRTC media. These capture modes must be enabled by the user.

When cookie forwarding is enabled, the extension reads cookies for the selected download URL and passes them to the local Rayburst app. Selected request headers may also be forwarded. These features let Rayburst request resources that require authentication. You can disable cookie and request-header forwarding in settings. Cookies and request context are not sent to the developer.

## Where data goes

Download tasks, request context and captured media go to the Rayburst HTTP API on your computer, normally at `http://127.0.0.1:29110`. The port is configurable. Media operations require the local API secret. Native Messaging only asks the installed desktop app to start; it does not carry URLs, cookies or media.

User-requested previews contact the selected media source directly. Rayburst contacts the relevant source to download or inspect the requested resource and may use the forwarded authentication context for that request. Those source sites receive normal network information, such as your IP address, and have their own privacy practices.

Clipboard, QR-code and export actions share the selected content only when you request them. Source URLs may contain private access parameters; anyone receiving such a URL may be able to use it.

## Storage and retention

- Connection settings, including the local API secret, download preferences, site rules, appearance and diagnostic settings are stored in the browser's local extension storage.
- Discovered resources and request context are temporary browser session data. Inactive resource metadata expires after 30 minutes; browser restart or extension reload clears discovery state.
- Pending download requests can remain in browser session storage until the desktop acknowledges them or the session ends. Tasks and confirmations accepted by Rayburst follow the desktop app's storage policy.
- User-initiated captures are stored by Rayburst on your computer. Unclaimed captures expire after 24 hours; inputs needed by pending tasks are retained.
- Diagnostic logs are stored locally with a configurable limit. Logged URLs exclude credentials, query parameters and fragments.
- Settings backups are local JSON files and include the API secret. They exclude captured media data. The extension does not upload these files.

You can change forwarding and capture settings, clear diagnostic logs, reset preferences or uninstall the extension. Uninstalling removes its browser storage; files and tasks already saved by Rayburst remain under the desktop app's control. Manually exported backups remain wherever you saved them.

## Permissions

Download and context-menu permissions support task handoff. Site, request and cookie permissions provide resource discovery and authentication context. Navigation, tab and alarm permissions maintain resource state; scripting and response filtering support explicitly enabled capture tools. The sidebar displays the workspace, and declarative request rules support the selected mobile User-Agent mode. Native Messaging starts Rayburst. The optional Chromium download-bar permission is requested only when that feature is enabled.

## Data use

Data is used for the download, media and capture features described above. It is not sold, used for advertising, used to assess creditworthiness, or transferred to developer-operated servers. The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Contact and changes

Source code and support: https://github.com/AnInsomniacy/rayburst-connect

For privacy questions, contact qq1326555262@gmail.com. Updates to this policy are published here with a revised date.
