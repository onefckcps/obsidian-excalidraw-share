# ExcaliShare - NixOS Module (Service Only)
#
# Deklaratives Deployment für NixOS - nur Service, kein Nginx!
#
# Usage:
#   imports = [ /path/to/nixos/module.nix ];
#
#   services.excalishare = {
#     enable = true;
#     domain = "notes.leyk.me";
#     apiKeyFile = "/etc/secrets/excalishare-api-key";
#     package = /path/to/excalishare/backend/target/release/excalishare;
#     frontendSource = /path/to/excalishare/frontend/dist;
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
  cfg = config.services.excalishare;
in
{
  options.services.excalishare = {
    enable = lib.mkEnableOption ''
      ExcaliShare - Self-hosted Excalidraw drawing sharing server
    '';

    package = lib.mkOption {
      type = lib.types.path;
      example = "/root/excalishare/backend/target/release/excalishare";
      description = "Pfad zum gebauten excalishare Binary.";
    };

    domain = lib.mkOption {
      type = lib.types.str;
      example = "notes.leyk.me";
      description = "Öffentliche Domain.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/excalishare";
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

    apiKey = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "API key for upload/delete operations. Use apiKeyFile for SOPS secrets.";
    };

    apiKeyFile = lib.mkOption {
      type = lib.types.path;
      default = null;
      description = "Path to file containing API key (for SOPS compatibility). Takes precedence over apiKey.";
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
    users.users.excalishare = {
      isSystemUser = true;
      group = "excalishare";
      description = "ExcaliShare Service User";
    };

    users.groups.excalishare = { };

    # -------------------------------------------------------------------------
    # 2. Verzeichnisse und Frontend
    # -------------------------------------------------------------------------
    systemd.tmpfiles.rules = [
      "d ${cfg.dataDir} 0755 excalishare excalishare - -"
      "d ${cfg.dataDir}/drawings 0755 excalishare excalishare - -"
    ];

    # -------------------------------------------------------------------------
    # 3. Frontend kopieren (einmalig bei Aktivierung)
    # -------------------------------------------------------------------------
    systemd.services.excalishare-setup = {
      description = "ExcaliShare - Setup (copy frontend)";
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
            chown -R excalishare:excalishare ${cfg.dataDir}/frontend
          fi
        ''}
      '';
    };

    # -------------------------------------------------------------------------
    # 4. Systemd Service
    # -------------------------------------------------------------------------
    systemd.services.excalishare = {
      description = "ExcaliShare Server";
      wantedBy = [ "multi-user.target" ];
      after = [
        "network.target"
        "excalishare-setup.service"
      ];
      requires = [ "excalishare-setup.service" ];

      serviceConfig = {
        Type = "simple";
        User = "excalishare";
        Group = "excalishare";
        Restart = "on-failure";
        RestartSec = "10s";

        RuntimeDirectory = "excalishare";
        RuntimeDirectoryMode = "0755";

        Environment = [
          "LISTEN_ADDR=127.0.0.1:${toString cfg.port}"
          "DATA_DIR=${cfg.dataDir}/drawings"
          "BASE_URL=https://${cfg.domain}"
          "MAX_UPLOAD_MB=${toString cfg.maxUploadMb}"
          "FRONTEND_DIR=${cfg.dataDir}/frontend"
        ]
        ++ lib.optional (cfg.apiKeyFile == null) "API_KEY=${cfg.apiKey}";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];

        ExecStart =
          if cfg.apiKeyFile != null then
            "${pkgs.writeShellScript "start-excalishare" ''
              export API_KEY="$(cat ${cfg.apiKeyFile})"
              exec ${cfg.package}/bin/excalishare
            ''}"
          else
            "${cfg.package}/bin/excalishare";

        StartLimitBurst = 5;
        StartLimitIntervalSec = 60;
      };
    };
  };
}
