# Failures, before setup implementation

- Setup overwrites unrelated plugins, shell integrations, configuration or binaries.
- Repeated setup duplicates entries, or uninstall removes externally changed data.
- The installed Claude plugin depends on temporary launcher files or missing policy.
- Shared installed plugin files/status are overwritten by concurrent sessions.
- /clear, /resume, branch or reload permanently disables timers or retains stale
  ownership, token measurements, reservations or the user inactivity budget.
- Native flags/subcommands, argv quoting, stdin, cwd or exit status change silently.
- Command interception recurses, bypasses an existing shim or captures the wrong CLI.
- Codex warms another same-project session, or a shared-daemon subscription is
  incorrectly treated as proof of exact native TUI ownership.
- Unsupported, noninteractive, explicit-remote or embedded launches are falsely
  described as warmed, or changed rather than forwarded to native execution.
- Typing/activity is inferred from model output or terminal protocol responses.
- Owner exit leaves timers, observers or managed child processes alive.
- Setup tests mutate real personal settings/authentication or capture credentials.
- Default thresholds/budgets or explicit probe overrides change without agreement.
- Installer success is represented as native warming proof without E2E artifacts.
- Native queued-prompt removal, cache retention or net savings are falsely claimed.
