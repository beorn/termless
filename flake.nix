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

            # Search
            ripgrep
          ];

          shellHook = ''
            echo "termless dev shell — bun + rust + zig + emscripten"
            echo "  bun test              Run all tests"
            echo "  bun cli backends      List backends"
            echo "  bun cli doctor        Health check"
          '';
        };
      }
    );
}
