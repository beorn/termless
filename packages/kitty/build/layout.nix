{ pkgs }:
pkgs.stdenv.mkDerivation {
  pname = "termless-kitty-native-mode-layout";
  version = "0.49.2";
  src = pkgs.fetchzip {
    url = "https://github.com/kovidgoyal/kitty/archive/b2cb871254fbdac19a085188813c8dfb258b95cd.tar.gz";
    hash = "sha256-FstfBzwdh1z7Qy9zWDY7L7mpd5bxnypgqEzqeLe16fY=";
  };
  nativeBuildInputs = [ pkgs.python314 ];
  dontConfigure = true;
  dontFixup = true;
  buildPhase = ''
    runHook preBuild
    $CC -std=gnu11 -O2 -Ikitty $(${pkgs.python314}/bin/python3-config --includes) \
      -MMD -MF layout.d ${./layout.c} -o layout
    ./layout > measured.json
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    export KITTY_LAYOUT_OUT="$out"
    export KITTY_LAYOUT_COMPILER="$($CC --version | head -n 1)"
    ${pkgs.python314}/bin/python3 - <<'PY'
import hashlib, json, os, pathlib, sys, sysconfig
out = pathlib.Path(os.environ["KITTY_LAYOUT_OUT"])
measured = json.loads(pathlib.Path("measured.json").read_text())
expected = {"size": 3888, "reverseVideo": {"offset": 667, "width": 1, "cType": "bool"},
            "syncOutput": {"offset": 1112, "width": 8, "cType": "int64_t"}}
if measured["screen"] != expected:
    raise SystemExit("Kitty header layout disagrees with independently inspected native ELF: " + repr(measured["screen"]))
manifest = {"schemaVersion": 1, "kittyVersion": "0.49.2",
            "sourceCommit": "b2cb871254fbdac19a085188813c8dfb258b95cd",
            "nativeModuleSha256": "6f28bbff8e8276d076957a718b9c1db21d1a42a7592890fab5171ee31db99619",
            **measured}
def encoded(value):
    return (json.dumps(value, indent=2) + "\n").encode()
def sha256(data):
    return hashlib.sha256(data).hexdigest()
def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
manifest_bytes = encoded(manifest)
(out / "native-mode-layout.json").write_bytes(manifest_bytes)
source_root = pathlib.Path.cwd().resolve()
dependencies = pathlib.Path("layout.d").read_text().replace("\\\n", " ").split()[1:]
active_headers = sorted({str(pathlib.Path(p).resolve().relative_to(source_root)) for p in dependencies
                         if pathlib.Path(p).resolve().is_relative_to(source_root) and p.endswith(".h")})
# Retain the complete quoted-include closure, including the two headers
# behind inactive preprocessor branches, and identify actual C inputs.
headers = sorted(["kitty/screen.h", "kitty/vt-parser.h", "kitty/graphics.h", "kitty/monotonic.h",
                  "kitty/line-buf.h", "kitty/history.h", "kitty/data-types.h", "kitty/glfw-wrapper.h",
                  "kitty/banned.h", "kitty/line.h", "kitty/text-cache.h", "kitty/kitty-verstable.h",
                  "3rdparty/verstable.h"])
if set(active_headers) != set(headers) - {"kitty/kitty-verstable.h", "3rdparty/verstable.h"}:
    raise SystemExit("Unexpected active Kitty layout header dependencies: " + repr(active_headers))
generator = pathlib.Path("${./layout.c}").read_bytes()
receipt = {"schemaVersion": 1, "sha256": sha256(manifest_bytes),
           "sourceCommit": manifest["sourceCommit"],
           "sourceUrl": "https://github.com/kovidgoyal/kitty/archive/b2cb871254fbdac19a085188813c8dfb258b95cd.tar.gz",
           "sourceNarHash": "sha256-FstfBzwdh1z7Qy9zWDY7L7mpd5bxnypgqEzqeLe16fY=",
           "generator": {"path": "packages/kitty/build/layout.c", "gitBlob": git_blob(generator), "sha256": sha256(generator)},
           "recipeSha256": "${builtins.hashFile "sha256" ./layout.nix}",
           "flakeLockSha256": "${builtins.hashFile "sha256" ../../../flake.lock}",
           "headers": [{"path": p, "sha256": sha256(pathlib.Path(p).read_bytes())} for p in headers],
           "activeCompilerHeaders": active_headers,
           "compiler": os.environ["KITTY_LAYOUT_COMPILER"],
           "compileFlags": "-std=gnu11 -O2 -Ikitty $(python3-config --includes)",
           "python": {"version": sys.version, "configuration": {k: sysconfig.get_config_var(k) for k in
                      ["SOABI", "CONFIG_ARGS", "CC", "CFLAGS", "Py_DEBUG", "Py_TRACE_REFS", "Py_GIL_DISABLED", "SIZEOF_VOID_P", "SIZEOF_LONG", "SIZEOF_SIZE_T"]}},
           "runtimeAssumptions": {"screenTypeModule": "fast_data_types", "screenTypeName": "Screen",
                                  "screenItemSize": 0, "screenBasicSize": measured["screen"]["size"]},
           "measured": manifest}
(out / "native-mode-layout.receipt.json").write_bytes(encoded(receipt))
PY
    runHook postInstall
  '';
}
