{
  lib,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  openssl,
  zstd,
  nodejs_20,
  npm,
  ...
}:

let
  # Source aus dem gesamten Projekt
  src = lib.cleanSource ../..;
in

rustPlatform.buildRustPackage rec {
  pname = "excalidraw-share";
  version = "0.1.0";

  # Wir nehmen das gesamte Projekt, da wir später im Modul das Frontend dazubauen
  inherit src;

  # Kein Cargo.lock auf Repo-Ebene, daher deaktivieren wir diese Prüfung
  cargoLock.lockFile = null;

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    openssl
    zstd
  ];

  # Frontend Build (wird nur für das NixOS-Paket genutzt)
  # Bei manuellem Build nutzt man npm build im frontend/ Verzeichnis
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
