{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
      in
      {
        # Release normalization tools, selected from this repository's flake.lock.
        # nix shell .#native-tools --command bun run --cwd packages/alacritty build:native
        packages.native-tools = pkgs.symlinkJoin {
          name = "termless-native-tools";
          paths = [ pkgs.bun pkgs.cargo pkgs.rustc pkgs.stdenv.cc pkgs.git pkgs.emscripten pkgs.gnumake pkgs.perl ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.patchelf pkgs.binutils ];
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # JavaScript runtime + package manager
            bun
            nodejs_22

            # Rust toolchain (vt100-rust, alacritty, wezterm backends)
            cargo
            rustc
            rustfmt

            # Zig toolchain (ghostty-native backend via libghostty-vt)
            zig

            # C/C++ toolchain (libvterm backend via Emscripten)
            emscripten
            git

            # Build tools
            pkg-config
            gnumake
            perl

            # Search
            ripgrep
          ];

          shellHook = ''
            echo "termless dev shell — bun + rust + zig + emscripten"
            echo "  bun test              Run all tests"
            echo "  bun cli backend list  List backends"
            echo "  bun cli doctor        Health check"
          '';
        };
      }
    );
}
