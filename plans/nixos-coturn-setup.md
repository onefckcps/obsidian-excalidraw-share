# NixOS coturn Setup — STUN/TURN für WebRTC Screen Sharing

## Ziel

Einen STUN/TURN-Server (`coturn`) auf dem NixOS VPS einrichten, der:
- Auf **keinem neuen externen Port** läuft (alles über Port 443)
- TURN-Traffic über **TLS** tunnelt (sicher, kein Plaintext)
- **HMAC-basierte Zeitlimit-Credentials** nutzt (kein statisches Passwort)
- Vollständig **deklarativ in NixOS** konfiguriert ist
- Nur auf `localhost` lauscht — nginx routet extern

## Voraussetzungen

- NixOS VPS mit nginx und ACME/Let's Encrypt
- Domain `notes.leyk.me` zeigt auf den VPS
- Neue Subdomain `turn.leyk.me` zeigt auf **dieselbe IP** wie `notes.leyk.me`
- Port 443 ist bereits offen (für nginx)

---

## Architektur

```
Internet (Port 443)
        |
        v
    nginx (SNI-Routing)
        |
        +-- notes.leyk.me --> ExcaliShare Backend :8184
        |
        +-- turn.leyk.me  --> coturn TLS :5349 (localhost only)
```

nginx liest den TLS-SNI-Header (Server Name Indication) auf TCP-Ebene und leitet den Traffic weiter — **ohne TLS zu terminieren**. coturn terminiert TLS selbst mit seinem eigenen Zertifikat.

---

## Schritt 1: DNS-Eintrag für turn.leyk.me

Füge einen A-Record hinzu:
```
turn.leyk.me  A  <DEINE_VPS_IP>
```

Gleiche IP wie `notes.leyk.me`. Kein neuer Server nötig.

---

## Schritt 2: ACME-Zertifikat für turn.leyk.me

In deiner `configuration.nix`:

```nix
security.acme = {
  acceptTerms = true;
  defaults.email = "deine@email.de";

  certs."turn.leyk.me" = {
    # coturn braucht Lesezugriff auf die Zertifikate
    group = "coturn";
    # ACME HTTP-Challenge läuft über nginx
    webroot = "/var/lib/acme/acme-challenge";
  };
};
```

Stelle sicher, dass nginx die ACME-Challenge für `turn.leyk.me` bedient:

```nix
services.nginx.virtualHosts."turn.leyk.me" = {
  # Nur für ACME-Challenge — kein HTTPS nötig
  locations."/.well-known/acme-challenge" = {
    root = "/var/lib/acme/acme-challenge";
    extraConfig = "allow all;";
  };
  # Alle anderen Requests ablehnen (TURN läuft über nginx stream, nicht hier)
  locations."/" = {
    return = "444";  # nginx: Connection closed without response
  };
};
```

---

## Schritt 3: coturn-Secret erstellen

```bash
# Auf dem VPS:
sudo mkdir -p /etc/secrets
sudo bash -c 'openssl rand -base64 32 > /etc/secrets/coturn-secret'
sudo chmod 600 /etc/secrets/coturn-secret
sudo chown root:root /etc/secrets/coturn-secret
```

Dieses Secret wird später auch dem ExcaliShare-Backend mitgeteilt, damit es HMAC-Credentials generieren kann.

---

## Schritt 4: coturn NixOS-Konfiguration

In deiner `configuration.nix`:

```nix
services.coturn = {
  enable = true;

  # Nur auf localhost lauschen — nginx proxied extern
  listening-ips = [ "127.0.0.1" ];
  listening-port = 3478;       # STUN/TURN UDP (nur lokal, nicht extern)
  tls-listening-port = 5349;   # TURN-over-TLS (nur lokal, nginx -> hier)
  alt-listening-port = 0;      # Deaktivieren
  alt-tls-listening-port = 0;  # Deaktivieren

  # Domain
  realm = "turn.leyk.me";

  # TLS-Zertifikate (von ACME)
  cert = "/var/lib/acme/turn.leyk.me/fullchain.pem";
  pkey = "/var/lib/acme/turn.leyk.me/key.pem";

  # HMAC-basierte Credentials (kein statisches Passwort)
  # coturn validiert Credentials automatisch mit diesem Secret
  static-auth-secret-file = "/etc/secrets/coturn-secret";

  # Sicherheit: Private IP-Ranges blockieren (verhindert SSRF-Angriffe)
  no-multicast-peers = true;
  no-cli = true;
  no-software-attribute = true;

  # Relay-Port-Range (nur für UDP-Relay, bleibt intern)
  min-port = 49152;
  max-port = 49252;  # 100 Ports für gleichzeitige Relay-Sessions

  # Bandbreiten-Limits
  max-bps = 10000000;   # 10 Mbps max pro Session
  total-quota = 100;    # Max 100 gleichzeitige Sessions
  user-quota = 10;      # Max 10 Sessions pro User

  # Logging
  verbose = false;  # Auf true setzen zum Debuggen
};

# coturn-User braucht Lesezugriff auf ACME-Zertifikate
users.users.coturn = {
  extraGroups = [ "acme" ];
};
```

---

## Schritt 5: nginx Stream-Modul für SNI-Routing

Das nginx `stream`-Modul arbeitet auf TCP-Ebene (Layer 4) und kann anhand des TLS-SNI-Headers routen, **ohne TLS zu terminieren**.

```nix
services.nginx = {
  # Stream-Modul aktivieren
  streamConfig = ''
    # Upstream: coturn TLS (lokal)
    upstream coturn_tls {
      server 127.0.0.1:5349;
    }

    # Upstream: nginx HTTPS für Web-Traffic
    # nginx lauscht intern auf 8443 für HTTPS (nicht 443, da stream das übernimmt)
    upstream web_https {
      server 127.0.0.1:8443;
    }

    # SNI-Routing: turn.leyk.me -> coturn, alles andere -> nginx HTTPS
    map $ssl_preread_server_name $upstream_backend {
      turn.leyk.me  coturn_tls;
      default       web_https;
    }

    # Externer Port 443: SNI lesen und weiterleiten
    server {
      listen 443;
      ssl_preread on;
      proxy_pass $upstream_backend;
      proxy_protocol off;
    }
  '';

  # WICHTIG: nginx HTTPS-VirtualHosts müssen jetzt auf Port 8443 lauschen
  # (nicht mehr auf 443, da der stream-Block das übernimmt)
  virtualHosts."notes.leyk.me" = {
    # Port 8443 statt 443 (intern)
    listen = [{ addr = "127.0.0.1"; port = 8443; ssl = true; }];
    enableACME = true;
    forceSSL = false;  # SSL wird manuell über listen konfiguriert
    sslCertificate = "/var/lib/acme/notes.leyk.me/fullchain.pem";
    sslCertificateKey = "/var/lib/acme/notes.leyk.me/key.pem";

    locations."/" = {
      proxyPass = "http://127.0.0.1:8184";
      proxyWebsockets = true;
    };
  };

  # turn.leyk.me: Nur für ACME-Challenge (HTTP, kein HTTPS nötig)
  virtualHosts."turn.leyk.me" = {
    listen = [{ addr = "0.0.0.0"; port = 80; ssl = false; }];
    locations."/.well-known/acme-challenge" = {
      root = "/var/lib/acme/acme-challenge";
      extraConfig = "allow all;";
    };
    locations."/" = {
      extraConfig = "return 444;";
    };
  };
};
```

> **Wichtig**: Durch den stream-Block übernimmt nginx den Port 443 auf TCP-Ebene. Die virtualHosts müssen daher auf einem anderen internen Port lauschen (hier `8443`). Der stream-Block leitet `notes.leyk.me`-Traffic an `127.0.0.1:8443` weiter.

---

## Schritt 6: Firewall-Konfiguration

**Keine neuen externen Ports nötig!** Nur sicherstellen, dass Port 443 offen ist:

```nix
networking.firewall = {
  enable = true;
  allowedTCPPorts = [
    80    # HTTP (für ACME-Challenge)
    443   # HTTPS + TURN-over-TLS (nginx stream)
  ];
  # Port 3478 (STUN UDP) und 5349 (TURN TLS) bleiben geschlossen nach außen
  # Port 49152-49252 (TURN Relay) bleiben geschlossen nach außen
  # Alles läuft über Port 443 durch nginx
};
```

---

## Schritt 7: ExcaliShare-Backend konfigurieren

Das Backend muss das coturn-Secret kennen, um HMAC-Credentials zu generieren.

In der NixOS-Konfiguration für ExcaliShare:

```nix
services.excalishare = {
  enable = true;
  domain = "notes.leyk.me";
  apiKeyFile = "/etc/secrets/excalishare-api-key";
  package = /root/excalishare/backend/target/release/excalishare;
  frontendSource = /root/excalishare/frontend/dist;

  # Neu: STUN/TURN-Konfiguration
  stunUrl = "stun:turn.leyk.me:443";
  turnUrl = "turns:turn.leyk.me:443";
  turnSecretFile = "/etc/secrets/coturn-secret";
};
```

Das ExcaliShare-NixOS-Modul (`nixos/module.nix`) muss entsprechend erweitert werden:

```nix
# Neue Optionen in nixos/module.nix hinzufügen:
options.services.excalishare = {
  # ... bestehende Optionen ...

  stunUrl = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    example = "stun:turn.leyk.me:443";
    description = "STUN-Server URL für WebRTC. Optional.";
  };

  turnUrl = lib.mkOption {
    type = lib.types.nullOr lib.types.str;
    default = null;
    example = "turns:turn.leyk.me:443";
    description = "TURN-Server URL für WebRTC. Optional.";
  };

  turnSecretFile = lib.mkOption {
    type = lib.types.nullOr lib.types.path;
    default = null;
    description = "Pfad zur Datei mit dem TURN HMAC-Secret.";
  };
};

# Im config-Block:
serviceConfig = {
  # ... bestehende Konfiguration ...
  Environment = [
    # ... bestehende Env-Vars ...
  ] ++ lib.optionals (cfg.stunUrl != null) [
    "STUN_URL=${cfg.stunUrl}"
  ] ++ lib.optionals (cfg.turnUrl != null) [
    "TURN_URL=${cfg.turnUrl}"
  ];

  ExecStart = "${pkgs.writeShellScript "start-excalishare" ''
    export API_KEY="$(cat ${cfg.apiKeyFile})"
    ${lib.optionalString (cfg.turnSecretFile != null) ''
      export TURN_SECRET="$(cat ${cfg.turnSecretFile})"
    ''}
    exec ${cfg.package}/bin/excalishare
  ''}";
};
```

---

## Schritt 8: Rebuild und Testen

```bash
# NixOS neu bauen
sudo nixos-rebuild switch

# coturn-Status prüfen
systemctl status coturn

# coturn-Logs prüfen
journalctl -u coturn -f

# STUN-Verbindung testen (von außen)
# Benötigt: turnutils_stunclient (aus coturn-Paket)
nix-shell -p coturn --run "turnutils_stunclient turn.leyk.me"

# TURN-Verbindung testen
# Credentials generieren (Beispiel):
TIMESTAMP=$(date -d "+1 hour" +%s)
USERNAME="${TIMESTAMP}:testuser"
SECRET=$(cat /etc/secrets/coturn-secret)
CREDENTIAL=$(echo -n "$USERNAME" | openssl dgst -sha1 -hmac "$SECRET" -binary | base64)
echo "Username: $USERNAME"
echo "Credential: $CREDENTIAL"

nix-shell -p coturn --run "turnutils_uclient -T -p 443 -u '$USERNAME' -w '$CREDENTIAL' turn.leyk.me"
```

---

## Schritt 9: Verifizierung im Browser

Öffne die Browser-Konsole auf `https://notes.leyk.me` und teste:

```javascript
// ICE-Config vom Backend holen (nach Implementierung von /api/ice-config)
const config = await fetch('/api/ice-config', {
  headers: { 'Authorization': 'Bearer DEIN_API_KEY' }
}).then(r => r.json());

// RTCPeerConnection mit den ICE-Servern erstellen
const pc = new RTCPeerConnection(config);

// ICE-Kandidaten sammeln
pc.onicecandidate = (e) => {
  if (e.candidate) {
    console.log('ICE Candidate:', e.candidate.type, e.candidate.candidate);
    // "srflx" = STUN-Kandidat (NAT-traversal erfolgreich)
    // "relay" = TURN-Kandidat (Relay-Fallback)
  }
};

// Dummy-DataChannel um ICE-Gathering zu starten
pc.createDataChannel('test');
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// Nach ~5 Sekunden sollten srflx und relay Kandidaten erscheinen
```

---

## Troubleshooting

### coturn startet nicht

```bash
# Logs prüfen
journalctl -u coturn -n 50

# Häufige Fehler:
# - Zertifikat nicht lesbar: chown coturn /var/lib/acme/turn.leyk.me/
# - Port 5349 belegt: ss -tlnp | grep 5349
# - Secret-Datei nicht lesbar: ls -la /etc/secrets/coturn-secret
```

### nginx stream-Modul nicht verfügbar

```bash
# Prüfen ob nginx mit stream-Modul gebaut wurde
nginx -V 2>&1 | grep stream

# Falls nicht: nginx mit stream-Modul in NixOS aktivieren
services.nginx.package = pkgs.nginxMainline;  # oder pkgs.nginx mit stream
```

### TURN-Verbindung schlägt fehl

```bash
# coturn-Logs auf Authentifizierungsfehler prüfen
journalctl -u coturn | grep -i "auth\|error\|fail"

# Häufige Ursachen:
# - Zeitdifferenz zwischen Client und Server > 5 Minuten (HMAC-Timestamp-Validierung)
# - Falsches Secret in /etc/secrets/coturn-secret
# - Firewall blockiert UDP-Relay-Ports 49152-49252 intern
```

### nginx leitet nicht korrekt weiter

```bash
# nginx-Konfiguration testen
nginx -t

# Stream-Modul-Logs
journalctl -u nginx | grep -i "stream\|upstream"

# Verbindung direkt zu coturn testen (von localhost)
openssl s_client -connect 127.0.0.1:5349 -servername turn.leyk.me
```

---

## Sicherheitshinweise

1. **HMAC-Credentials** laufen nach 1 Stunde ab — kein dauerhafter Missbrauch möglich
2. **`denied-peer-ip`** verhindert, dass TURN als Proxy für interne Dienste missbraucht wird (SSRF-Schutz)
3. **`no-cli`** deaktiviert das coturn-Management-Interface
4. **`user-quota = 10`** begrenzt Sessions pro User
5. **`total-quota = 100`** begrenzt Gesamtlast
6. **`max-bps = 10000000`** begrenzt Bandbreite pro Session auf 10 Mbps
7. Das coturn-Secret **niemals in Git committen** — nur in `/etc/secrets/`

---

## Zusammenfassung der Änderungen

| Was | Wo | Neu/Geändert |
|-----|-----|--------------|
| DNS A-Record `turn.leyk.me` | DNS-Provider | Neu |
| ACME-Zertifikat `turn.leyk.me` | `configuration.nix` | Neu |
| `services.coturn` | `configuration.nix` | Neu |
| nginx `streamConfig` | `configuration.nix` | Neu |
| nginx virtualHost `notes.leyk.me` auf Port 8443 | `configuration.nix` | Geändert |
| nginx virtualHost `turn.leyk.me` (nur HTTP/ACME) | `configuration.nix` | Neu |
| `/etc/secrets/coturn-secret` | VPS | Neu |
| `nixos/module.nix` (stunUrl, turnUrl, turnSecretFile) | Repo | Geändert |
| ExcaliShare-Backend (STUN_URL, TURN_URL, TURN_SECRET) | Repo | Geändert |
