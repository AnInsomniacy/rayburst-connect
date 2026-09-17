# Page media discovery

Rayburst Connect discovers browser media. Rayburst owns task handoff and capture
storage. Aria2 Next inspects, downloads, decrypts and remuxes the result.

## User flow

Play media and open the **Media** tab, native browser sidebar or full-page workspace.
Browse the current tab or all tabs, filter by type/name/URL, and sort by time, name
or size. TS and standalone subtitle capture are off by default; M4S capture remains on. Type filters are available for captured resources. Select resources for batch download,
URL copy, track combination or ordered fragment concatenation.

Each row offers copy, inspection, inline preview and download. HLS/DASH inspection opens native track selection. Quick download uses the native defaults for finite sources without track choices; multiple choices and live sources require confirmation. Choose video, audio, subtitles,
container and a finite time range or live recording limit. Confirmation starts the
same GID without another desktop selection dialog. Ordinary files use the existing
download API. Concatenation expects compatible transport fragments in playback
order, including initialization data, rather than independent complete movie files.

The interface uses the existing 27 locales, semantic theme colors, Naive UI controls
and Vue/CSS transitions, including reduced-motion support. The previous persistent
floating download button and page iframe were removed. Recording controls appear
in the page only after a capture mode is enabled.

## Capture modes

| Mode               | Browser work                                             | Native result                                       |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| Network discovery  | Request metadata, DOM and resource timing                | Direct resources or HLS/DASH inspection             |
| Deep search        | Opt-in Fetch/XHR, JSON, text/base64 and key observations | Playlists and candidate AES keys                    |
| Buffer capture     | Copy successful SourceBuffer appends                     | One composition from a single MediaSource and frame |
| Playback recording | Native MediaRecorder                                     | A recorded composition                              |
| Screen recording   | Native display picker and MediaRecorder                  | A recorded composition                              |
| WebRTC capture     | Tracks from one newly created RTCPeerConnection          | Recorded tracks with relative start offsets         |

Reload before playback for hooks that must attach before a player is created.
Firefox additionally uses native response filtering in deep/buffer modes, forwarding
original bytes unchanged while inspecting bounded copies. Opaque workers and private
execution contexts may remain inaccessible.

Import accepts a URL, title, inline HLS/DASH, manifest file, ordered fragment URLs,
16-byte key file, or hex/base64 AES key and IV. Captured keys can be tried explicitly.
OpenSSL performs AES-128-CBC decryption and FFmpeg validates candidate outputs.
Live manifests refresh from their original HTTP URL after the captured snapshot.

Buffer capture needs initialization data. A frame or codec change cannot silently
append incompatible bytes. Navigation seals received data as a separate candidate;
closing the tab discards an unfinished capture. Browser recording depends on the
codecs exposed by MediaRecorder and the selected container.

## Tools and behavior

Native media-element controls provide seeking, volume, speed, loop, mute,
Picture-in-Picture, fullscreen and screenshots. Browser gesture and permission
requirements still apply.

The **Media** section in extension settings owns capture policy. Extension and MIME
tables support enable/disable switches, resource classification, native numeric
size comparisons and inclusive ranges. Unknown lengths remain eligible. An explicit
disabled extension wins over MIME fallback. Ordered regular expressions can capture,
ignore or extract a URL group; the first matching rule overrides type policy.
Absolute signed URLs remain unchanged. Rule editors validate before saving.

Global discovery and site scopes are independent of ordinary download interception.
Site lists support hostname or URL patterns and an allow-list mode. Existing always-skip
rules still apply. Network, DOM and deep-search observations use the same policy.
Filtering a TS or subtitle row does not suppress its document-scoped request context
or prevent the engine from downloading it through a playlist.

Settings changes save through the existing browser storage APIs. Native Web Locks
serialize settings updates across extension contexts. Resetting media defaults leaves
the desktop connection and other settings intact. Settings backups use schema 4;
older backups and the removed media rule structure have no compatibility adapter.
Rules are edited in settings, not inside the popup. New sources append in discovery
order by default, without moving when another request observes the same resource.

Preserve-on-navigation and per-tab automatic download are optional. Always-on deep search is an explicit, disabled-by-default setting; reload pages after changing it. Buffer, screen, playback and WebRTC capture remain explicit per-tab operations. The per-tab automatic
queue does not submit live recordings or individual transport fragments. Mobile
User-Agent uses native declarative session rules and reloads the tab; it changes
request headers, not the rendering engine.

Preview uses native playback where possible, Shaka Player for HLS/DASH and
mpegts.js for FLV/TS. These bundled playback libraries request the selected source
directly. Sites requiring captured headers may refuse preview while native download
still works. QR codes and clipboard actions share the original URL, including any
private query parameters.

## State and request context

The background is the single writer of browser session state. Candidates retain
native tab, frame, document and exact URL identity. Network metadata survives
simultaneous DOM/script observations. Limits are 1,000 candidates per tab, 2,048
total and 6 MiB of metadata. Inactive sources expire after 30 minutes; at most eight
inspections are active. Browser restart or extension reload clears this state.
Settings backups exclude captured source data.

Headers remain scoped to the observed origin and document. Disguised playlists
recover only an exact recent request context. Website cookie/header forwarding
preferences apply before submission. Capture authentication belongs to the local
API and is independent of website forwarding preferences. The popup receives
metadata, not request headers or stored probe bodies.

Capture bytes go to authenticated desktop storage in 256 KiB blocks. Chunk IDs and
offsets make retries idempotent, including partially written files. The bounded page
queue stops capture on overflow instead of dropping bytes. Sealed files are immutable.
Rayburst removes unclaimed captures after 24 hours and protects pending task inputs.

Inspection and submission have separate UUIDs. Lost replies retain those identities
for reconciliation. Closing the popup does not cancel native tasks. Connection or
privacy changes invalidate affected pending requests. See [Media API v2](MEDIA_API.md).

## Scope and validation

DRM, unavailable site keys, subtitle translation, transcoding, remote processing
and external downloader integrations are excluded. Finite HLS/DASH ranges follow
native segment boundaries, not individual frames. WebVTT export requires a compatible
subtitle codec. Hooks cannot recover data created before installation.

Run the repository's type, lint, locale, format, contract and module tests. Settings tests cover native concurrent writes and media-only reset; discovery tests cover filtered-segment credentials and shared type policy. Tests cover
event correlation, credentials, capture replays, stale documents, selection and
handoff. The maintainer performs real browser/desktop E2E with independently built
applications. Static checks do not establish playback or download success.

The capability reference is [Cat Catch](https://github.com/xifangczy/cat-catch),
adapted to Rayburst's architecture. This implementation uses browser APIs and the
engine's GPAC, libcurl, OpenSSL and FFmpeg libraries; it does not bundle Cat Catch's
extension or utilities.
