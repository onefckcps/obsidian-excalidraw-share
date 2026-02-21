# Excalidraw Share - NixOS Module (Production Ready)
#
# Deklaratives Deployment für NixOS mit VPN-Zugriffskontrolle.
#
# Usage:
#   imports = [ /path/to/nixos/module.nix ];
#
#   services.excalidraw-share = {
#     enable = true;
#     domain = "notes.leyk.me";
#     apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
#   };
#
# Dependencies:
#   - Das Modul erwartet das Paket aus default.nix (wird automatisch gebaut)
#   - Frontend wird automatisch als Teil des Pakets gebaut
#
# VPN Only Access:
#   Das Modul unterstützt VPN-Zugriffskontrolle über die 'vpnAccess' Option.
#   Du kannst auch deine bestehende 'vpnOnly' Variable nutzen (s.u.).
#
# Example mit deiner bestehenden VPN-Konfiguration:
#
#   services.excalidraw-share = {
#     enable = true;
#     domain = "notes.leyk.me";
#     apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
#     vpnAccess = "vpnOnly";  # Oder "vpnAndSelf" für deinen VPN+Self Modus
#   };
#

{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.excalidraw-share;

  # Hilfsfunktion für VPN-Zugriff (aus deiner configuration.nix)
  vpnOnly = ''
    allow 100.64.0.0/10;
    allow 127.0.0.1;
    allow ::1;
    deny all;
  '';

  vpnAndSelf = ''
    allow 100.64.0.0/10;
    allow 127.0.0.1;
    allow ::1;
    allow 172.17.0.0/16;
    deny all;
  '';

  # ACME Ausnahme für Let's Encrypt
  acmeLocation = {
    extraConfig = ''
      allow all;
    '';
  };
in
{
  options.services.excalidraw-share = {
    enable = lib.mkEnableOption ''
      Excalidraw Share - Self-hosted Excalidraw drawing sharing server

      Ermöglicht das Teilen von Excalidraw-Zeichnungen aus Obsidian.
      Der Server wird nur lokal gebunden (127.0.0.1) und sollte über Nginx
      mit VPN-Zugriffskontrolle exponiert werden.
    '';

    package = lib.mkOption {
      type = lib.types.package;
      default = (pkgs.callPackage ./default.nix { }).overrideAttrs (old: {
        # Frontend bauen als Teil des Rust-Pakets
        buildPhase = old.buildPhase + ''
          echo "Building frontend..."
          cd $src/../frontend
          npm install
          npm run build
          mkdir -p $out/frontend
          cp -r dist/* $out/frontend/
        '';
      });
      description = "Das excalidraw-share Paket (inkl. Frontend).";
    };

    domain = lib.mkOption {
      type = lib.types.str;
      example = "notes.leyk.me";
      description = "Öffentliche Domain für den Excalidraw Share Server.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/excalidraw-share";
      description = "Verzeichnis für gespeicherte Zeichnungen.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3030;
      description = "Port für den Backend-Server (nur localhost).";
    };

    maxUploadMb = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 50;
      description = "Maximale Upload-Größe in Megabyte.";
    };

    apiKeyFile = lib.mkOption {
      type = lib.types.path;
      description = "Pfad zur Datei mit dem API-Key.";
    };

    # VPN Access Control
    vpnAccess = lib.mkOption {
      type = lib.types.enum [
        "vpnOnly"
        "vpnAndSelf"
        "public"
      ];
      default = "vpnOnly";
      description = ''
        Zugriffskontrolle:
        - vpnOnly: Nur VPN-Clients (100.64.0.0/10) und localhost
        - vpnAndSelf: Wie vpnOnly + explizite externe IPs (z.B. Home)
        - public: Jeder darf zugreifen (nicht empfohlen!)
      '';
    };

    # Optional: Extra nginx config für mehr Kontrolle
    nginxExtraConfig = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Zusätzliche Nginx-Config für die location.";
    };
  };

  config = lib.mkIf cfg.enable {
    # -------------------------------------------------------------------------
    # 1. User und Verzeichnisse erstellen
    # -------------------------------------------------------------------------
    users.users.excalidraw-share = {
      isSystemUser = true;
      group = "excalidraw-share";
      description = "Excalidraw Share Service User";
    };

    users.groups.excalidraw-share = { };

    systemd.tmpfiles.rules = [
      "d ${cfg.dataDir} 0755 excalidraw-share excalidraw-share - -"
      "d ${cfg.dataDir}/drawings 0755 excalidraw-share excalidraw-share - -"
    ];

    # -------------------------------------------------------------------------
    # 2. Systemd Service
    # -------------------------------------------------------------------------
    systemd.services.excalidraw-share = {
      description = "Excalidraw Share Server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      requires = [ "network.target" ];

      serviceConfig = {
        Type = "simple";
        User = "excalidraw-share";
        Group = "excalidraw-share";
        Restart = "on-failure";
        RestartSec = "10s";

        # Runtime Verzeichnis
        RuntimeDirectory = "excalidraw-share";
        RuntimeDirectoryMode = "0755";

        # Umgebungsvariablen
        Environment = [
          "LISTEN_ADDR=127.0.0.1:${toString cfg.port}"
          "DATA_DIR=${cfg.dataDir}/drawings"
          "BASE_URL=https://${cfg.domain}"
          "MAX_UPLOAD_MB=${toString cfg.maxUploadMb}"
          "FRONTEND_DIR=${cfg.package}/frontend"
        ];

        # API Key aus Datei laden
        EnvironmentFile = cfg.apiKeyFile;

        # Sicherheit
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];

        # Executable
        ExecStart = "${cfg.package}/bin/excalidraw-share";

        # Fehlerbehandlung
        StartLimitBurst = 5;
        StartLimitIntervalSec = 60;
      };
    };

    # -------------------------------------------------------------------------
    # 3. Nginx Reverse Proxy mit VPN-Zugriffskontrolle
    # -------------------------------------------------------------------------
    services.nginx = {
      enable = true;
      recommendedProxySettings = true;

      virtualHosts.${cfg.domain} = {
        enableACME = true;
        forceSSL = true;

        # ACME Challenge erlauben (für Let's Encrypt)
        locations."/.well-known/acme-challenge" = acmeLocation;

        # Haupt-Proxy
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString cfg.port}";
          proxyWebsockets = true;

          extraConfig = ''
            ${
              if cfg.vpnAccess == "public" then
                ''
                  # Public access - kein VPN-Schutz
                ''
              else if cfg.vpnAccess == "vpnAndSelf" then
                vpnAndSelf
              else
                vpnOnly
            }

            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;

            ${cfg.nginxExtraConfig}
          '';
        };
      };
    };

    # -------------------------------------------------------------------------
    # 4. Firewall - ACME Ports müssen offen sein
    # -------------------------------------------------------------------------
    networking.firewall.allowedTCPPorts = [
      80 # ACME HTTP
      443 # HTTPS
    ];

    # Hinweis: Port ${cfg.port} muss NICHT in der Firewall offen sein,
    # da der Server nur auf 127.0.0.1 lauscht!
  };
}
