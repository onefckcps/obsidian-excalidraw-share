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
      packages.${system} =
        let
          backend = pkgs.rustPlatform.buildRustPackage {
            pname = "excalidraw-share";
            version = "0.1.0";
            src = self;
            cargoLock.lockFile = ./backend/Cargo.lock;
            buildPhase = ''
              cargo build --release --package excalidraw-share
            '';
            installPhase = ''
              install -Dm755 target/release/excalidraw-share $out/bin/excalidraw-share
            '';
          };

          frontend = pkgs.stdenv.mkDerivation {
            pname = "excalidraw-share-frontend";
            version = "0.1.0";
            src = self;
            nativeBuildInputs = [ pkgs.nodejs_20 ];
            buildPhase = ''
              cd frontend
              npm install --legacy-peer-deps
              npm run build
            '';
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
