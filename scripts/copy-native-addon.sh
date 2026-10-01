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
if [[ "$extension" == so ]]; then
  for tool in patchelf readelf; do
    if ! command -v "$tool" >/dev/null; then
      echo "missing Linux addon tool: $tool; enter nix shell .#native-tools from the termless root" >&2
      exit 1
    fi
  done
  # Finalize the distributed bytes before the receipt writer hashes them.
  patchelf --remove-rpath "$2"
  dynamic_tags="$(readelf --dynamic "$2")"
  if [[ "$dynamic_tags" == *"(RPATH)"* || "$dynamic_tags" == *"(RUNPATH)"* ]]; then
    echo "native addon retains library search paths after normalization: $2" >&2
    exit 1
  fi
fi
bun "$(dirname "$0")/write-native-build-receipt.ts" "$PWD" "$2"
