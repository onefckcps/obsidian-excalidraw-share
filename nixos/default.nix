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
  src = lib.cleanSource ../..;
in

rustPlatform.buildRustPackage rec {
  pname = "excalidraw-share";
  version = "0.1.0";
  inherit src;

  cargoLock.lockFile = null;

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    openssl
    zstd
  ];

  postBuild = ''
    echo "Excalidraw Share built successfully"
  '';

  meta = with lib; {
    description = "Self-hosted Excalidraw drawing sharing server";
    homepage = "https://github.com/yourusername/obsidian-excalidraw-share";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.linux;
  };
}
