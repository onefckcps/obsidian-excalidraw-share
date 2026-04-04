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

    apiKeyFile = lib.mkOption {
      type = lib.types.path;
      description = "Path to file containing API key (required). Use SOPS or similar secret management.";
    };

    frontendSource = lib.mkOption {
      type = lib.types.path;
      description = "Pfad zum gebauten Frontend (frontend/dist).";
    };

    stunUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "stun:turn.leyk.me:443";
      description = "STUN server URL for WebRTC ICE. Optional.";
    };

    turnUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "turns:turn.leyk.me:443";
      description = "TURN server URL for WebRTC ICE (TURN-over-TLS). Optional.";
    };

    turnSecretFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/etc/secrets/coturn-secret";
      description = "Path to file containing the TURN HMAC shared secret. Must match coturn's static-auth-secret.";
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
    # 3. Frontend kopieren (bei jeder Aktivierung)
    # -------------------------------------------------------------------------
    systemd.services.excalishare-setup = {
      description = "ExcaliShare - Setup (copy frontend)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      serviceConfig = {
        Type = "oneshot";
        # NOTE: RemainAfterExit is intentionally NOT set here.
        # With RemainAfterExit = true, systemd considers the service "active" after
        # the first run and will NOT re-run it on subsequent nixos-rebuild switch,
        # meaning frontend updates are never deployed. Without it, the service
        # re-runs on every activation, which is correct since the script is idempotent.
        User = "root";
      };
      script = ''
        ${lib.optionalString (cfg.frontendSource != null) ''
          if [ -d "${cfg.frontendSource}" ]; then
            rm -rf ${cfg.dataDir}/frontend
            cp -r "${cfg.frontendSource}" ${cfg.dataDir}/frontend
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
        ] ++ lib.optionals (cfg.stunUrl != null) [
          "STUN_URL=${cfg.stunUrl}"
        ] ++ lib.optionals (cfg.turnUrl != null) [
          "TURN_URL=${cfg.turnUrl}"
        ];

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];

        # Always load API key from file to avoid leaking it in systemd environment
        ExecStart = "${pkgs.writeShellScript "start-excalishare" ''
          export API_KEY="$(cat ${cfg.apiKeyFile})"
          ${lib.optionalString (cfg.turnSecretFile != null) ''
            export TURN_SECRET="$(cat ${cfg.turnSecretFile})"
          ''}
          exec ${cfg.package}/bin/excalishare
        ''}";

        StartLimitBurst = 5;
        StartLimitIntervalSec = 60;
      };
    };
  };
}
