{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  openssl,
  zstd,
  ...
}:

let
  # Project root is two levels up from nixos/
  projectRoot = ../..;
  src = lib.cleanSource projectRoot;
in

rustPlatform.buildRustPackage rec {
  pname = "excalidraw-share";
  version = "0.1.0";
  inherit src;

  # Explicit path to Cargo.lock
  cargoLock.lockFile = projectRoot + /backend/Cargo.lock;

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    openssl
    zstd
  ];

  meta = with lib; {
    description = "Self-hosted Excalidraw drawing sharing server";
    homepage = "https://github.com/yourusername/obsidian-excalidraw-share";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.linux;
  };
}
