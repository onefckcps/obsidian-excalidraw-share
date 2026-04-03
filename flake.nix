{
  description = "ExcaliShare - Self-hosted drawing sharing for Obsidian";

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
            pname = "excalishare";
            version = "1.0.1";
            src = ./backend;
            cargoLock.lockFile = ./backend/Cargo.lock;
          };

          frontend = pkgs.buildNpmPackage {
            pname = "excalishare-frontend";
            version = "1.0.1";
            src = ./frontend;
            npmDepsHash = "sha256-Qr9bF3EfoMXaAn55KI0hpIwhq4rVlzeoykVtTobCo6U=";
            # The Excalidraw package needs legacy-peer-deps
            npmFlags = [ "--legacy-peer-deps" ];
            installPhase = ''
              mkdir -p $out
              cp -r dist/* $out/
            '';
          };
        in
        {
          excalishare-backend = backend;
          excalishare-frontend = frontend;
          default = backend;
        };

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          cargo
          rustc
          rustfmt
          rustPackages.clippy
          rust-analyzer
          cargo-watch
          nodejs_20
          git
          inotify-tools
        ];

        shellHook = ''
          echo "ExcaliShare Development Environment"
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
