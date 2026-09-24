# AGENTS.md — Rayburst Connect

> This file provides context and instructions for AI coding agents.
> For human contributors, see [README.md](README.md) and [CONTRIBUTING.md](docs/CONTRIBUTING.md).

> [!IMPORTANT]
> **All changes must meet industrial-grade quality.** Keep the codebase lean: plain functions over classes, one source of truth for every fact, strict TypeScript (no `any`, justify every `as` cast), and verification proportional to the changed behavior.

---

## A. Project Architecture

| Layer               | Stack                                          |
| ------------------- | ---------------------------------------------- |
| **Framework**       | WXT 0.20 (Manifest V3) + Vue 3 Composition API |
| **UI**              | Naive UI + plain CSS custom properties         |
| **Validation**      | Zod 4 (`lib/schema.ts` is the SSOT)            |
| **Testing**         | Vitest + WXT `fakeBrowser` polyfill            |
| **Build**           | Vite (via WXT) → `.output/chromium-mv3/`       |
| **Package Manager** | pnpm 10                                        |

### Key File Paths

```
entrypoints/
├── background.ts                # Service worker — orchestrator wiring, listeners, storage sync
├── content.ts                   # Content script — magnet/ed2k/thunder link interception
├── popup/App.vue                # Browser action popup — status, speed, dashboard
└── options/App.vue              # Full-page settings — one staged-snapshot state model

lib/
├── schema.ts                    # Zod schemas — single source of persisted types + defaults
├── storage.ts                   # Schema-validated load/save over browser.storage.local
├── api.ts                       # DesktopApiClient (ky) + error taxonomy + checkConnection
├── desktop.ts                   # Native Messaging activation + API readiness
├── browser.ts                   # Permissions, context menu, notifications, webRequest types
├── backup.ts                    # Settings backup export/import
├── diagnostics.ts               # Sanitized, serialized diagnostic journal
├── file-extensions.ts           # File extension normalization/matching
└── download/
    ├── contracts.ts             # Consumer validation for ordinary desktop handoff
    ├── pending.ts               # Native session storage for unresolved request IDs
    ├── orchestrator.ts          # Interception flows: automatic, Firefox response, explicit
    ├── chromium-takeover.ts     # Synchronous Chromium cancellation handoff
    ├── filter.ts                # Filter pipeline (pure function stages)
    ├── request-context.ts       # Captured request headers (TTL store)
    ├── duplicate-guard.ts       # Duplicate download reservation window
    ├── firefox-response.ts      # Firefox attachment response parsing
    └── url.ts                   # URL/filename extraction (incl. presigned CD params)

shared/
├── theme.ts                     # Entire theme system: schemes, M3 CSS vars, bootstrap, useAppTheme()
├── i18n/
│   ├── engine.ts                # I18nEngine (worker) + createI18n/useI18n (Vue)
│   ├── locales.ts               # Shared locale registry
│   ├── dictionaries.ts          # Translation data via virtual:locales
│   └── locales-plugin.ts        # Vite plugin aggregating public/_locales/ at build time
├── json.ts                      # jsonClone / deepEqual for JSON-safe data
├── use-polling.ts               # Visibility-aware polling with backoff
├── manifest.ts                  # Manifest builder (per-browser permissions)
└── components/                  # BrandLogo, CollapsePanel

__tests__/                       # Behavior-level unit + integration tests
public/_locales/                 # Chrome i18n bundles (27 languages, SSOT)
```

### A′. Download Filter Pipeline

`lib/download/filter.ts` evaluates candidates through ordered pure-function stages; the
first non-null verdict wins, default is intercept:

enabled → self-trigger → interception-scope → scheme → site-rule → mime-type →
file-extension-rule → minimum-file-size

### A″. Persistence Model

- Persisted settings live ONLY in `lib/schema.ts`. Types are `z.infer`, defaults come from
  `Schema.parse({})` — never hand-write a default twice.
- Every parse helper accepts `unknown` and never throws; corrupt fields collapse to
  defaults, invalid array entries are dropped.
- Unresolved download requests use native session storage and strict consumer contracts;
  never repair a malformed request into a new download. See [DOWNLOADS.md](docs/DOWNLOADS.md).
- `lib/storage.ts` validates on read AND write (writes are re-parsed, which also strips
  Vue reactivity proxies).

### Adding a New Storage Field

1. Add the field (with `.catch(default)`) to the schema in `lib/schema.ts` — done: type + default exist.
2. Wire it into the UI and/or background logic.
3. Add i18n keys to all 27 locales (see Section D).
4. Extend `__tests__/unit/storage-schema.test.ts`.

---

## B. Version Management

**`package.json` is the single source of truth.** WXT reads `version` from here for the manifest.

Always bump via the script — never edit the version manually:

```bash
./scripts/bump-version.sh 1.0.6
```

---

## D. i18n / Locale Operations

### Rules

1. **NEVER edit locale files manually one by one.** Use a temporary batch helper outside the repository when changing many files.
2. **Always update all 27 locales** when adding or modifying keys. Partial updates are not accepted.
3. English (`en`) is the reference locale — validate this first.
4. Run `pnpm lint:i18n` after every change to verify consistency across all 27 locales.

Only reusable project scripts belong in `scripts/`. One-off helpers, generated caches,
scratch files, and temporary automation outputs must stay outside the repository in the
platform's standard temporary directory.

### Adding a New Language

1. Create `public/_locales/{code}/messages.json` (copy `en` as template and translate).
2. Add one entry to `SUPPORTED_LOCALES` in `shared/i18n/locales.ts`.
3. Run `pnpm lint:i18n` to verify registration, message structure, placeholders, and key parity.

The dictionary data itself is aggregated automatically by the `virtual:locales` plugin —
no imports, aliases, or module declarations to touch.

### Chrome i18n Format

```json
{
  "key_name": {
    "message": "Your text with $PLACEHOLDER$ support",
    "description": "Context for translators",
    "placeholders": {
      "PLACEHOLDER": { "content": "$1", "example": "127.0.0.1" }
    }
  }
}
```

---

## E. Release Process

### Trigger

The release workflow (`.github/workflows/release.yml`) is triggered by `on: release: types: [published]` or manual `workflow_dispatch`.

### Dual-Track Release Model

| Track          | Version Example | Git Tag         | GitHub Release | Store Publishing           |
| -------------- | --------------- | --------------- | -------------- | -------------------------- |
| **Beta**       | `1.0.8-beta.1`  | `v1.0.8-beta.1` | Prerelease ✅  | None (local sideload only) |
| **Production** | `1.0.8`         | `v1.0.8`        | Full release   | Separate manual workflow   |

GitHub Releases produce downloadable artifacts. Store publishing is a separate manual
workflow that accepts production releases only. Creating a Release never submits to stores.

### How to Publish a Beta (Testing)

```bash
./scripts/bump-version.sh 1.0.8-beta.1
./scripts/release.sh
```

On GitHub: create a Release, select the tag, **check "Set as a pre-release"**.
CI builds zip artifacts and attaches them to the Release. No store submission.
Download the zip and sideload via `chrome://extensions` for local testing.

### How to Publish a Production Release

All code changes must be finalized before starting. Execute in strict order:

1. **Bump the version:**

   ```bash
   ./scripts/bump-version.sh 1.0.8
   ```

   **Do not modify code after this step.** This updates `package.json`.

2. **Release:**

   ```bash
   ./scripts/release.sh
   ```

   This formats code, runs all quality gates (compile → test → lint → i18n → format),
   commits all changes, creates an annotated tag `v{VERSION}`, and pushes to origin.

3. **Generate Release Title and Notes** following the conventions below, output in two
   separate code blocks (title + body) so the user can copy-paste into the GitHub Release page.

4. **User publishes on GitHub** — do **not** check "Set as a pre-release".
   CI automatically:
   - Builds and packages `.zip` for Chromium and Firefox once each
   - Uploads artifacts to the GitHub Release

5. **Publish to stores** — go to Actions → "Publish to Stores" → Run workflow.
   Enter the version number or leave as `latest` to auto-detect. The workflow:
   - Resolves the target tag and commit; runs publishing scripts from the workflow commit
   - Downloads the existing packages from that release; no rebuild or repeated quality gate
   - Submits existing packages to Chrome Web Store, Firefox AMO, and Edge Add-ons
   - Reports submission results in each store job

### Store Publishing Details

| Store            | Method                          | Secrets Required                                                   |
| ---------------- | ------------------------------- | ------------------------------------------------------------------ |
| Chrome Web Store | Chrome Web Store API v2         | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Firefox AMO      | `web-ext sign --channel listed` | `FIREFOX_API_KEY`, `FIREFOX_API_SECRET`                            |
| Edge Add-ons     | REST API v1.1                   | `EDGE_CLIENT_ID`, `EDGE_API_KEY`                                   |

Store workflows also use repository variables for non-secret identifiers and
cross-workflow status:

| Variable                           | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `CHROME_PUBLISHER_ID`              | Chrome Web Store publisher resource ID      |
| `EDGE_LAST_OPERATION_ID`           | Last Edge publish review operation ID       |
| `EDGE_LAST_OPERATION_VERSION`      | Version tied to the last Edge operation     |
| `EDGE_LAST_OPERATION_RUN_ID`       | GitHub Actions run that saved the operation |
| `EDGE_LAST_OPERATION_SUBMITTED_AT` | Timestamp when the Edge operation was saved |

`REPO_VARIABLES_TOKEN` is optional. Add it only if `GITHUB_TOKEN` cannot update
repository variables during Edge publishing. It must have repository Variables
read/write permission and no Secrets permission.

**Firefox source code:** The publish pipeline automatically packages the repository via
`git archive` and uploads it alongside the extension using `--upload-source-code`.
This satisfies AMO's source code review requirement without exposing source in the GitHub Release.

**Edge API Key rotation:** Check the expiry shown in Partner Center. When the `publish-edge`
job returns 401 or 403, verify the current API key and paired Client ID in Partner
Center and update `EDGE_API_KEY` and `EDGE_CLIENT_ID`. Browser sign-in is unrelated.

**Store conflict handling:** Known conflicts (pending review, version exists, submission
in review) exit 0 to keep CI green. The step output shows the real outcome
in each store job. Only genuine errors (auth failure, network) cause red CI.

### Recovering from a Failed Release

```bash
# 1. Fix the code, commit and push
git add -A && git commit -m "fix: resolve build issue" && git push

# 2. Delete the remote tag
git push origin --delete v1.0.6

# 3. Delete the local tag
git tag -d v1.0.6

# 4. Delete the failed Release on GitHub (Releases → click → Delete this release)
# 5. Re-run bump-version.sh with the same version to re-create the tag
./scripts/bump-version.sh 1.0.6
./scripts/release.sh
```

### Build Artifact

`pnpm zip` produces `rayburst-connect-{version}-chromium-mv3.zip` for Chromium browsers.
`pnpm zip:firefox` produces `rayburst-connect-{version}-firefox-mv3.zip` for Firefox.

### Release Notes Conventions

**Title format:** `v{VERSION} — {Short Description}`

**Body sections** (omit empty ones): `✨ New`, `🛠 Improvements`, `🐛 Bug Fixes`, `📦 Install`.
Include a one-paragraph summary and install instructions for Chromium/Firefox zips.
Patch releases: keep concise.

---

## F. CI/CD Structure

### `ci.yml` (Push to Main + Pull Requests)

One job runs type checking, behavior tests, ESLint, translation validation, media
contract consistency and formatting. Superseded CI runs are cancelled. Browser
packaging belongs to the release workflow, not every push.

### `release.yml` (Release Published + Manual Dispatch)

One job installs dependencies once and runs `pnpm zip:all`. WXT builds each browser
as part of packaging. Published releases receive both ZIPs; manual runs archive them.
Do not add a separate build before `wxt zip` or repeat the CI suite here.

### `publish.yml` (Manual Dispatch Only)

Store identities come only from `browser-identity.json`. The resolver selects a published
production release. Publishing tools run from the workflow commit, so fixes also apply
to existing releases. Chrome, Firefox and Edge jobs download
its existing packages and submit them through `scripts/actions`. Firefox also receives
the source archive for that exact tag. Store jobs do not rebuild or rerun source tests.
Each job reports its own result; no separate summary runner is needed.

### `store-status.yml` (Manual Dispatch Only)

`scripts/actions/store-status.ts` reports current store status. `latest` selects a
production GitHub Release; prerelease tags are rejected.

### Shared Setup

`.github/actions/setup-node-pnpm` reads `.nvmrc` and `package.json` and installs the
locked dependencies. Keep checks directly in `ci.yml`; no configurable gate wrapper.

---

## G. Code Conventions

- **Plain functions over classes.** A class is justified only by real mutable state
  (e.g. `DesktopApiClient` and the TTL stores). Never introduce a
  class + interface pair just to make something mockable — tests use `vi.spyOn`/`vi.mock`
  and WXT's `fakeBrowser`.
- **One source of truth.** Persisted types/defaults live in `lib/schema.ts` only.
  Error classification lives in `lib/api.ts` only. Theme/DOM application lives in
  `shared/theme.ts` only.
- **Strict TypeScript** — no `any`; use `unknown` + type guards or Zod parse.
- **`<script setup lang="ts">`** for all components; Naive UI via `NaiveUiResolver`.
- **CSS**: plain custom properties (M3 tokens in `globals.css`, runtime values injected by
  `shared/theme.ts`). Animations are CSS-only and respect `prefers-reduced-motion`.
- **Download ownership** — preflight failures may fall back to the browser. After an
  ambiguous POST, retain the same request ID and reconcile; never create a second
  browser download merely because its desktop receipt was lost.
- **Formatting**: Prettier with project config (`.prettierrc`).

---

## H. Verification Commands

Select checks for the changed surface; builds and ZIPs are for packaging changes:

```bash
pnpm format           # Auto-format all files
pnpm format:check     # Verify formatting (CI runs this)
pnpm compile          # TypeScript type checking
pnpm test             # Vitest unit + integration tests
pnpm lint             # ESLint
pnpm lint:i18n        # i18n key consistency across 27 locales
pnpm build            # Production build
pnpm zip              # Package for store submission
```

> **Every commit MUST pass `pnpm format:check`.** Run `pnpm format` before committing if you edit any source file.

Required CI must pass. Keep coverage optional and do not add percentage quotas. Do not repeat builds that packaging commands already perform.

---

## I. Testing Constraints

> **DO NOT use browser tools (Playwright, puppeteer, etc.) to test this extension.** Extension popup and options pages run in a restricted Chrome extension context — they cannot be accessed via `localhost` URLs. Use CLI checks (`vue-tsc`, `pnpm test`) for automated verification. For UI testing, ask the user to load the unpacked extension via `chrome://extensions` and verify manually.

> **Test behavior, not glue.** Cover filter verdicts, orchestrator flows, schema repair,
> header/filename heuristics, and real bug regressions (e.g. the stale-download state
> guard, #267). Do not write tests that merely mirror an implementation or assert that a
> one-line wrapper forwards its arguments.

## Brand and delivery

Use the supplied SVG master and purple seed `#7B3ED1`. Keep all implementation
comments and documentation in English. Product names remain untranslated. Localize
interface copy and slogans in every supported locale, preserving the approved English
and Chinese slogans. Keep the approved promotional banners in English. Review prose with Sepia.

Follow `docs/BRAND.md` and `docs/RELEASING.md`. Store identities and update signing must
be configured explicitly for Rayburst. Local verification never submits to a store,
publishes a website, changes remotes or starts release automation. Native end-to-end
acceptance belongs to the user. Work on the current branch; do not spawn agents.

## Documentation editing

Preserve the existing README and documentation structure, wording and tone. Make
minimal edits for branding, outdated behavior, commands, links and directory layouts.
Do not rewrite unaffected prose or restore acknowledgements sections.
