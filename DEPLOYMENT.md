# Excalidraw Share - Deployment Guide

## Übersicht

Dieses Projekt kann auf zwei Arten deployed werden:

1. **Deklarativ (empfohlen)** - Vollständig durch NixOS verwaltet
2. **Manuell** - Selber bauen und Service einrichten

---

## Option 1: Deklaratives NixOS Deployment (Empfohlen)

### Voraussetzungen

1. Das Projekt muss in deinem NixOS-Config-Repo sein (z.B. via Git)
2. Du brauchst eine API-Key Datei

### Schritt 1: API-Key erstellen

```bash
# Auf deinem NixOS Server:
sudo mkdir -p /etc/secrets
sudo bash -c 'openssl rand -base64 32 > /etc/secrets/excalidraw-share-api-key'
sudo chmod 600 /etc/secrets/excalidraw-share-api-key
```

### Schritt 2: Frontend bauen

Das Frontend muss zuerst gebaut werden (einmalig):

```bash
cd /root/obsidian-excalidraw-share/frontend
npm install
npm run build
```

### Schritt 3: NixOS Config anpassen

Füge dies zu deiner `configuration.nix` hinzu:

```nix
# Importiere das Modul
imports = [
  /path/to/obsidian-excalidraw-share/nixos/module.nix
];

# Konfiguriere den Service
services.excalidraw-share = {
  enable = true;
  domain = "notes.leyk.me";
  apiKeyFile = "/etc/secrets/excalidraw-share-api-key";
  
  # WICHTIG: Pfad zum gebauten Frontend
  frontendSource = /root/obsidian-excalidraw-share/frontend/dist;
  
  # Optional: VPN-Zugriffskontrolle (Standard: vpnOnly)
  # vpnAccess = "vpnOnly";    # Nur VPN-Clients
  # vpnAccess = "vpnAndSelf"; # VPN + externe IP
  # vpnAccess = "public";     # Jeder (nicht empfohlen!)
};
```

### Schritt 3: Rebuild

```bash
sudo nixos-rebuild switch
```

Das Modul übernimmt:
- User/Group Erstellung
- Datenverzeichnis
- Systemd Service
- Nginx Reverse Proxy mit VPN-Schutz
- ACME Zertifikate

---

## Option 2: Manuelles Deployment

### Voraussetzungen

```bash
# Projekt auf Server übertragen
cd /root
git clone https://github.com/YOUR_USERNAME/obsidian-excalidraw-share.git
cd obsidian-excalidraw-share
```

### Bauen

```bash
# Mit Nix
nix develop

# Frontend
cd frontend && npm install && npm run build && cd ..

# Backend
cd backend && cargo build --release && cd ..
```

### API-Key erstellen

```bash
echo "dein-sicherer-api-key" | sudo tee /etc/secrets/excalidraw-share-api-key
sudo chmod 600 /etc/secrets/excalidraw-share-api-key
```

### Service einrichten

```bash
# Service-Datei anpassen (Pfade!) und kopieren
cp excalidraw-share.service /etc/systemd/system/

# Oder manuell:
sudo useradd -r -s /bin/false -d /var/empty excalidraw-share
sudo mkdir -p /var/lib/excalidraw-share/drawings
sudo chown -R excalidraw-share:excalidraw-share /var/lib/excalidraw-share

# Starten
sudo systemctl daemon-reload
sudo systemctl enable excalidraw-share
sudo systemctl start excalidraw-share
```

### Nginx Config (VPN Only)

In deiner `configuration.nix`, füge hinzu:

```nix
services.nginx.virtualHosts."notes.leyk.me" = {
  enableACME = true;
  forceSSL = true;
  extraConfig = vpnOnly;  # <- Nur VPN Zugriff!
  
  locations."/.well-known/acme-challenge" = {
    extraConfig = "allow all;";
  };
  
  locations."/" = {
    proxyPass = "http://127.0.0.1:3030";
    proxyWebsockets = true;
  };
};
```

---

## Obsidian Script konfigurieren

Nach dem Deployment, bearbeite `obsidian-script/Share Drawing.md`:

```javascript
const CONFIG = {
  apiUrl: "https://notes.leyk.me",
  apiKey: "dein-sicherer-api-key",  // Muss mit der Datei übereinstimmen!
};
```

---

## API Endpoints

| Methode | Endpoint | Zugriff | Beschreibung |
|---------|----------|---------|--------------|
| POST | `/api/upload` | API-Key | Zeichnung hochladen |
| GET | `/api/drawings/:id` | Public | Zeichnung abrufen |
| DELETE | `/api/drawings/:id` | API-Key | Zeichnung löschen |
| GET | `/api/drawings` | API-Key | Alle auflisten |
| GET | `/api/health` | Public | Health Check |

---

## Troubleshooting

### Service startet nicht

```bash
# Logs anzeigen
journalctl -u excalidraw-share -f

# Häufige Fehler:
# - Port bereits belegt: lsof -i :3030
# - Fehlende Rechte: chown -R excalidraw-share /var/lib/excalidraw-share
```

### Upload scheitert

```bash
# API-Key prüfen
curl -X POST https://notes.leyk.me/api/upload \
  -H "Authorization: Bearer DEIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"excalidraw","elements":[]}'
```

### Zeichnung lädt nicht

- Prüfe ob die ID existiert: `curl https://notes.leyk.me/api/drawings/DEINE_ID`
- Browser Console für JS-Fehler prüfen

---

## Sicherheitshinweise

1. **API-Key geheim halten** - Nur für Upload/Delete verwendet
2. **VPN-Zugriff** - Standardmäßig nur über VPN (100.64.0.0/10)
3. **SSL/TLS** - Immer HTTPS nutzen (ACME automatisch)
4. **User Isolation** - Service läuft als dedizierter User
