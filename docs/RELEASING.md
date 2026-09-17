# Release configuration

`pnpm zip:all` builds local packages. It does not upload them to a browser store.

`browser-identity.json` owns the local Chromium public key and ID, the Firefox ID,
and optional store IDs. The local key stabilizes unpacked builds on Chrome and Edge;
it is not a claim that either store has assigned that ID. Private key material is
not needed for unpacked development and is not stored in this repository.

Chrome and Edge retain their existing store entries and public extension IDs.
The Chromium public key matches the Chrome store identity. Firefox uses a new
Rayburst Connect listing with `rayburst-connect@aninsomniacy.dev`; it does not
update the previous product's Firefox installations.

The desktop Native Messaging identity file must match these browser identities.
Rebuild and distribute the desktop launcher before publishing an extension that
requires a changed allowlist. Set `STORE_PUBLISHING_ENABLED=true` after the store
configuration is complete. Edge's product ID and public extension ID are distinct.
The Firefox slug must be confirmed against the new listing before automation runs.

Store listing copy is in `docs/store`. Capture real Rayburst screenshots for each
store's current requirements. Source packaging and the native store APIs remain in
`scripts/actions`; no release or submission runs as part of local verification.

CI checks source code. The release workflow runs `pnpm zip:all` once and uploads
both browser packages. Store publishing downloads those packages without rebuilding
or repeating CI. Firefox receives the source archive from the same release tag.
