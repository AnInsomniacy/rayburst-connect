# Release configuration

`pnpm zip:all` builds local packages. It does not upload them to a browser store.

`browser-identity.json` owns the local Chromium public key and ID, the Firefox ID,
and optional store IDs. The local key stabilizes unpacked builds on Chrome and Edge;
it is not a claim that either store has assigned that ID. Private key material is
not needed for unpacked development and is not stored in this repository.

Before publishing, obtain the actual Rayburst Connect store identities. Enter them
in `stores`, update the desktop Native Messaging identity file, and rebuild both
products. Store commands refuse an unset or mismatched target before any upload.
Set `STORE_PUBLISHING_ENABLED=true` only after that setup is complete.

This source uses the new Firefox ID `rayburst-connect@aninsomniacy.dev` and the
new Chromium development key. These are intentional; store account and listing
decisions belong to the maintainer. Do not restore previous product IDs or submit
packages as part of a source-only branding change. Existing store installations
cannot update to a different extension ID.

For Chrome, use the store's package public key when the published identity is known.
For Edge, configure the product ID and public extension ID separately. For Firefox,
keep the explicit add-on ID and configure the actual AMO slug. No previous product's
store identifiers or credentials are copied automatically.

Store listing copy is in `docs/store`. Capture real Rayburst screenshots for each
store's current requirements. Source packaging and the native store APIs remain in
`scripts/actions`; no release or submission runs as part of local verification.

CI checks source code. The release workflow runs `pnpm zip:all` once and uploads
both browser packages. Store publishing downloads those packages without rebuilding
or repeating CI. Firefox receives the source archive from the same release tag.
