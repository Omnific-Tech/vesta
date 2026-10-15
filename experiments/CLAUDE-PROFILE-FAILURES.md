# Claude fixture profile integrity contract

The native production proof completed its actual Claude marker exchange but
failed the personal profile byte-hash check. Native backups exactly matched the
before and after hashes. Their redacted comparison found only `usageCount` and
`lastUsedAt` changes in two existing non-Vesta `pluginUsage` entries. Other
personal files were unchanged; the profile continued changing after fixture exit.
That failed run remains failed evidence and does not establish release proof.

Before implementing the fixture isolation and privacy-safe accounting evidence,
the executable acceptance oracle must reject:

- Missing profile evidence, or raw before/after hashes differing from the existing
  personal-file hash row.
- Any personal settings, authentication, instruction or CLI byte-hash change.
- Any change anywhere in the personal profile outside `pluginUsage`, including
  addition/removal of `pluginUsage` itself.
- Addition/removal of a plugin entry, or any changed Vesta entry.
- Any non-Vesta entry change except values of its existing `usageCount` and
  `lastUsedAt` fields. Their field presence must remain identical.
- A fixture HOME outside its disposable root, configuration outside that HOME,
  a profile path outside its configuration, or a native plugin list containing
  anything except the installed `vesta@vesta-local` plugin.
- Missing raw native plugin-list evidence or fixture profile digest.

Evidence retains the complete original byte hashes and canonical structure
hashes. Plugin entry identities are hashed; no personal profile JSON, credential
values or counter values are persisted. The fixture's own profile digest and
whether it contains Vesta usage are recorded, but native usage flushing is not
an acceptance requirement. Every native response, model, threshold, source,
ownership and cleanup assertion remains required. The fixture keeps the native
default keychain namespace while isolating HOME and configuration; it does not
change personal login or trust settings.
