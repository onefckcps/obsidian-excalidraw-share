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
      lib = nixpkgs.lib;
    in
    {
      packages.${system} =
        let
          backend = pkgs.rustPlatform.buildRustPackage {
            pname = "excalidraw-share";
            version = "0.1.0";
            src = ./backend;
            cargoLock.lockFile = ./backend/Cargo.lock;
          };

          frontend = pkgs.buildNpmPackage {
            pname = "excalidraw-share-frontend";
            version = "0.1.0";
            src = ./frontend;
            npmDepsHash = "sha256-RQghcJOxBMNghNpdjsU5EPB4FS/rkVy5spCgT4AfXAQ=";
            # The Excalidraw package needs legacy-peer-deps
            npmFlags = [ "--legacy-peer-deps" ];
            installPhase = ''
              mkdir -p $out
              cp -r dist/* $out/
            '';
          };
        in
        {
          excalidraw-share-backend = backend;
          excalidraw-share-frontend = frontend;
          default = backend;
        };

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          cargo
          rustc
          rustfmt
          rustPackages.clippy
          rust-analyzer
          nodejs_20
          git
        ];

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
      };

      nixosModules.default = import ./nixos/module.nix;
    };
}
