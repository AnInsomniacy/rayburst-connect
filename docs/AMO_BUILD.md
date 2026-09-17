# Firefox review build

This source archive corresponds to the submitted Rayburst Connect package. The extension is written in TypeScript and Vue and bundled with WXT/Vite. Playback libraries are installed from the lockfile and bundled locally; the extension does not download executable code at runtime.

## Reproduce the package

Use Node.js 24.16.0 and pnpm 10.34.1. In the root of this archive, run:

```sh
corepack enable
corepack prepare pnpm@10.34.1 --activate
pnpm install --frozen-lockfile
pnpm zip:firefox
```

The output is `.output/rayburst-connect-2.0.1-firefox-mv3.zip`. Its manifest is at `.output/firefox-mv3/manifest.json`. The source version is recorded in `package.json`. The package uses Manifest V3 and requires Firefox 140 or later on desktop.

## Review the main features

Install Rayburst 4.0.0-beta.2 or later on the same Windows, macOS or Linux computer:
https://github.com/AnInsomniacy/rayburst/releases

Open Rayburst and obtain its Extension API port and secret from its settings. Enter these in Rayburst Connect's Connection settings and use Test Connection. The default port is 29110. This is the desktop Extension API, not the aria2 RPC service. No account or subscription is required.

Download a public test file or use Download with Rayburst from a link's context menu. Open Sniffer while playing a public, non-DRM media source to inspect resources. Capture tools are opt-in. Browser display-capture prompts and codec restrictions still apply.

The extension sends selected source URLs, request context and media to the local desktop app. Firefox's native data consent declares browsing activity, website content and authentication information. Cookie/header forwarding can be disabled. The activation-only Native Messaging host cannot receive URLs, cookies or media. See `PRIVACY_POLICY.md` and `docs/store/permissions.md` for the complete data handling explanation.
