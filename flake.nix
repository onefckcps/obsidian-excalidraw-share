{
  description = "Excalidraw Share - Self-hosted drawing sharing for Obsidian";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        # Rust toolchain
        buildInputs = with pkgs; [
          cargo
          rustc
          rustfmt
          rustPackages.clippy
          rust-analyzer

          # Node.js for frontend (includes npm)
          nodejs_20

          # Additional dev tools
          git
        ];

        # Shell hooks for convenient frontend setup
        shellHook = ''
          echo "Excalidraw Share Development Environment"
          echo "========================================"
          echo ""
          echo "Available commands:"
          echo "  cd backend  && cargo build    # Build Rust backend"
          echo "  cd frontend && npm install    # Install frontend deps"
          echo "  cd frontend && npm run build # Build frontend"
          echo ""
        '';

        # Optional: Rust source for rust-analyzer
        # RUST_SRC_PATH = "${pkgs.rust.packages.stable.rustPlatform.rustLibSrc}";
      };
    };
}
