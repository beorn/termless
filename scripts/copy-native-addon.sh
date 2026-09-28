#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
  echo "usage: copy-native-addon.sh <library-base> <output.node>" >&2
  exit 2
fi

case "$(uname -s)" in
  Darwin) extension=dylib ;;
  Linux) extension=so ;;
  *) echo "unsupported native addon platform: $(uname -s)" >&2; exit 1 ;;
esac

source_file="native/target/release/$1.$extension"
if [[ ! -f "$source_file" ]]; then
  echo "missing native addon: $source_file; run build:native first" >&2
  exit 1
fi
cp "$source_file" "$2"
