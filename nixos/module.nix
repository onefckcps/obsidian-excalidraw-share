# Excalidraw Share - NixOS Module (Service Only)
#
# Deklaratives Deployment für NixOS - nur Service, kein Nginx!
#
# Usage:
#   imports = [ /path/to/nixos/module.nix ];
#
#   services.excalidraw-share = {
#     enable = true;
#     domain = "notes.leyk.me";
#     apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
#     package = /path/to/obsidian-excalidraw-share/backend/target/release/excalidraw-share;
#     frontendSource = /path/to/obsidian-excalidraw-share/frontend/dist;
#   };
#
# WICHTIG: Die nginx Configuration muss MANUELL in deiner configuration.nix
# hinzugefügt werden (siehe unten).
#

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.excalidraw-share;
in
{
  options.services.excalidraw-share = {
    enable = lib.mkEnableOption ''
      Excalidraw Share - Self-hosted Excalidraw drawing sharing server
    '';

    package = lib.mkOption {
      type = lib.types.path;
      example = "/root/obsidian-excalidraw-share/backend/target/release/excalidraw-share";
      description = "Pfad zum gebauten excalidraw-share Binary.";
    };

    domain = lib.mkOption {
      type = lib.types.str;
      example = "notes.leyk.me";
      description = "Öffentliche Domain.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/excalidraw-share";
      description = "Verzeichnis für Daten und Frontend.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8184;
      description = "Port für Backend.";
    };

    maxUploadMb = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 50;
      description = "Max Upload Größe in MB.";
    };

    apiKeyFile = lib.mkOption {
      type = lib.types.path;
      description = "Pfad zur API-Key Datei.";
    };

    frontendSource = lib.mkOption {
      type = lib.types.path;
      description = "Pfad zum gebauten Frontend (frontend/dist).";
    };
  };

  config = lib.mkIf cfg.enable {
    # -------------------------------------------------------------------------
    # 1. User und Verzeichnisse
    # -------------------------------------------------------------------------
    users.users.excalidraw-share = {
      isSystemUser = true;
      group = "excalidraw-share";
      description = "Excalidraw Share Service User";
    };

    users.groups.excalidraw-share = { };

    # -------------------------------------------------------------------------
    # 2. Verzeichnisse und Frontend
    # -------------------------------------------------------------------------
    systemd.tmpfiles.rules = [
      "d ${cfg.dataDir} 0755 excalidraw-share excalidraw-share - -"
      "d ${cfg.dataDir}/drawings 0755 excalidraw-share excalidraw-share - -"
    ];

    # -------------------------------------------------------------------------
    # 3. Frontend kopieren (einmalig bei Aktivierung)
    # -------------------------------------------------------------------------
    systemd.services.excalidraw-share-setup = {
      description = "Excalidraw Share - Setup (copy frontend)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "root";
      };
      script = ''
        ${lib.optionalString (cfg.frontendSource != null) ''
          if [ -d "${cfg.frontendSource}" ]; then
            rm -rf ${cfg.dataDir}/frontend
            cp -r ${cfg.frontendSource} ${cfg.dataDir}/frontend
            chown -R excalidraw-share:excalidraw-share ${cfg.dataDir}/frontend
          fi
        ''}
      '';
    };

    # -------------------------------------------------------------------------
    # 4. Systemd Service
    # -------------------------------------------------------------------------
    systemd.services.excalidraw-share = {
      description = "Excalidraw Share Server";
      wantedBy = [ "multi-user.target" ];
      after = [
        "network.target"
        "excalidraw-share-setup.service"
      ];
      requires = [ "excalidraw-share-setup.service" ];

      serviceConfig = {
        Type = "simple";
        User = "excalidraw-share";
        Group = "excalidraw-share";
        Restart = "on-failure";
        RestartSec = "10s";

        RuntimeDirectory = "excalidraw-share";
        RuntimeDirectoryMode = "0755";

        Environment = [
          "LISTEN_ADDR=127.0.0.1:${toString cfg.port}"
          "DATA_DIR=${cfg.dataDir}/drawings"
          "BASE_URL=https://${cfg.domain}"
          "MAX_UPLOAD_MB=${toString cfg.maxUploadMb}"
          "FRONTEND_DIR=${cfg.dataDir}/frontend"
          "API_KEY=${lib.readFile cfg.apiKeyFile}"
        ];

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];

        ExecStart = "${cfg.package}";

        StartLimitBurst = 5;
        StartLimitIntervalSec = 60;
      };
    };
  };
}
