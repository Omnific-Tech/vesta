#!/bin/zsh
# Run the actual native update before injecting a transaction-visible error.
if [[ "$1" == plugin && "$2" == update && "$VESTA_FIXTURE_FAULT" == *rollback* ]]; then
  "$VESTA_FIXTURE_NATIVE_CLAUDE" "$@" || exit $?
  if [[ "$VESTA_FIXTURE_FAULT" == rollback-failure-reported || ! -e "$VESTA_FIXTURE_FAULT_MARKER" ]]; then
    print -r -- fault > "$VESTA_FIXTURE_FAULT_MARKER"
    print -r -- 'Controlled error after actual native plugin update' >&2
    exit 91
  fi
  exit 0
fi
exec "$VESTA_FIXTURE_NATIVE_CLAUDE" "$@"
