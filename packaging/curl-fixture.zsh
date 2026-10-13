#!/bin/zsh
# Only public HTTP transport is controlled; asset bytes are compiled Vesta.
[[ "$1" == --disable ]] || { print -r -- 'Public transport must disable personal curl configuration first' >&2; exit 94; }
destination=''
url=''
while (( $# )); do
  case "$1" in
    --output|-o) destination="$2"; shift 2 ;;
    --header|-H) [[ "$2" == *Authorization* ]] && exit 92; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == https://api.github.com/repos/Omnific-Tech/vesta/releases/latest ]]; then
  [[ "$VESTA_FIXTURE_FAULT" == api-error ]] && exit 22
  exec /bin/cat "$VESTA_FIXTURE_RELEASE"
fi
if [[ "$url" == https://github.com/Omnific-Tech/vesta/releases/download/v*/vesta-darwin-arm64 && -n "$destination" ]]; then
  exec /bin/cp "$VESTA_FIXTURE_BINARY" "$destination"
fi
print -r -- 'Unexpected controlled curl invocation' >&2
exit 2
