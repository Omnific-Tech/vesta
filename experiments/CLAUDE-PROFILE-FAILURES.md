# Claude fixture profile integrity contract

## Turn-agnostic cache clocks (contract before implementation)

- Manual compaction then an isMeta/background turn with input >100000 must
  warm after its completion-based idle interval; source `other` cannot strand
  tokens at null. Equality/below-threshold latest completions must not warm.
- Resume/reconnect/attach/detach/module reload invalidates old usage only. The
  next owned completion, including an already active non-user turn, supplies
  fresh usage without another user prompt.
- Controls/config recovery remains a consent barrier: require a fresh user
  prompt and its reply, including across reload; meta/Vesta turns cannot clear it.
- Sidechain/subagent/separate-transcript/foreign-session turns must change
  neither the owned idle timer, measurement nor budget.
- Every owned completion, including Vesta, restarts idle and replaces input
  usage (input + cache read + cache creation); busy turns block dispatch.
- Non-Vesta prompts, including meta prompts, renew the four-hour budget. Vesta
  prompts never do, including recovered/replayed committed submissions. Budget
  expiry stops warming even while keepalives continue completing.
- Preserve pending/dispatch cancellation and stale-turn guards. Extend the
  actual-register.ts host fixture with retained event/status/submission evidence.

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
- A fixture HOME different from the existing personal authentication HOME,
  configuration outside the disposable fixture root,
  a profile path outside its configuration, or a native plugin list containing
  anything except the installed `vesta@vesta-local` plugin.
- Missing raw native plugin-list evidence or fixture profile digest.

Evidence retains the complete original byte hashes and canonical structure
hashes. Plugin entry identities are hashed; no personal profile JSON, credential
values or counter values are persisted. The fixture's own profile digest and
whether it contains Vesta usage are recorded, but native usage flushing is not
an acceptance requirement. Every native response, model, threshold, source,
ownership and cleanup assertion remains required. The fixture keeps the native
default keychain namespace and personal authentication HOME while isolating
configuration, profile and plugin registry; it does not change personal login or
trust settings.

The subsequent isolated-HOME attempt failed native Claude authentication. A
metadata-only keychain record lookup (without requesting credential values)
succeeded under personal HOME and returned item-not-found under an isolated HOME.
macOS's default keychain search list depends on HOME. The installed native
resolver invokes `security` with that default search list; preserving the default
service namespace alone does not preserve access. No supported independent
keychain-search-path override was found. The corrected contract requires the
existing authentication HOME and retains every configuration-isolation and
personal-integrity assertion above. No credentials are copied or exported, and
no auth shim, symlink, login or personal-state restoration is used.
