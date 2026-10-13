#!/bin/zsh
# Controlled GitHub transport only; candidate bytes are real compiled Vesta.
if [[ "$1" == auth ]]; then
  [[ "$VESTA_FIXTURE_FAULT" == missing-auth ]] && exit 1
  exit 0
fi
if [[ "$1" == api && "$2" == */releases/latest ]]; then
  [[ "$VESTA_FIXTURE_FAULT" == api-error ]] && exit 1
  exec /bin/cat "$VESTA_FIXTURE_RELEASE"
fi
if [[ "$1" == release && "$2" == download ]]; then
  shift 2
  destination=''
  while (( $# )); do
    if [[ "$1" == --dir ]]; then destination="$2"; shift 2; else shift; fi
  done
  [[ -n "$destination" ]] || exit 2
  exec /bin/cp "$VESTA_FIXTURE_BINARY" "$destination/vesta-darwin-arm64"
fi
print -r -- 'Unexpected controlled gh invocation' >&2
exit 2
