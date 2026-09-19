# Robustes Collab-Join & Offline-Handling (Plugin + Frontend)

## Ziel

Auto-Join und Offline-Verhalten der Live-Collab vollständig neu durchdenken und robust machen. Kein silent fail mehr, kein Datenverlust bei Offline-Phasen, vorhersehbares Verhalten in allen Edge-Cases.

**Scope:** `obsidian-plugin/` + `frontend/`. **Backend bleibt unverändert** (keine neuen Endpoints, kein Protokoll-Bruch).

## Getroffene Entscheidungen (vom User bestätigt)

1. **Offline weiterzeichnen + Konflikt-Dialog beim Reconnect** (Plugin): Dialog mit 3 Optionen — „Zusammenführen" / „Server-Stand übernehmen" / „Lokale Änderungen hochladen".
2. **Einseitige Änderungen = automatisch**: Nur lokal geändert → automatisch hochladen. Nur Server geändert → automatisch übernehmen. Dialog NUR wenn beide Seiten geändert haben.
3. **Auto-Join bleibt**, aber als State-Machine mit Retry-Backoff, sichtbarem Status und manuellem Fallback-Button.
4. **Auto-Switch bei Datei-Wechsel**: Session A verlassen, zu Datei B joinen (persistent Sessions bleiben serverseitig aktiv — Verlassen ist billig).
5. **Frontend: Auto-Merge ohne Dialog** (höchste Element-Version gewinnt). Gäste sollen nicht über den Server-Stand entscheiden können. Konflikt-Dialog ist Admin-only (Plugin).

## Ist-Probleme (aus Code-Analyse, verifiziert)

| # | Problem | Ort |
|---|---------|-----|
| P1 | `autoJoinPersistentCollab` catch ist **silent** — Netzwerkfehler → kein Retry, kein Status. User sieht nie, dass Join fehlschlug. | `main.ts:2950` |
| P2 | **Snapshot überschreibt lokale Szene komplett** (`api.updateScene({elements: msg.elements})` ohne Merge). Bei Reconnect nach Offline-Phase gehen lokale Änderungen verloren. | `collabManager.ts:578-604` |
| P3 | `bufferedUpdates`-Auto-Flush beim Reconnect raced gegen Server-Snapshot: Flush geht raus, Snapshot (ohne die Änderungen) überschreibt sofort danach. | `collabClient.ts:142-149` |
| P4 | Kein Retry wenn Excalidraw-API beim Join noch nicht ready (`getExcalidrawAPI()` → null → `return` ohne Feedback). Typisch bei Obsidian-Start. | `main.ts:2239-2242` |
| P5 | Nur 1 Session gleichzeitig: Datei A joined → Tab-Wechsel zu Datei B → `autoJoinPersistentCollab` return early (`isJoined`), B joined nie. | `main.ts:2896` |
| P6 | Health-Check fix 60s, kein Backoff, keine `online`/`offline`-Events. Nach Sleep/Wake oder WLAN-Wechsel bis zu 60s blind. | `main.ts:807-846` |
| P7 | Passwort-geschützte persistent Session + fehlender/ungültiger API-Key → WS close → silent fail. Kein Passwort-Dialog. | `autoJoinPersistentCollab` übergibt `password=null` |
| P8 | Datei-Close beendet Session nicht sauber; cached API zeigt auf tote View. | kein leaf-close-cleanup für Collab |
| P9 | Zwei Geräte (LiveSync-Vault) joinen beide als identischer „Host"-Name — Cursors/Teilnehmer nicht unterscheidbar. | `collabDisplayName` default 'Host' |
| P10 | Frontend: gleiche Snapshot-Replace-Problematik wie P2/P3 (Auto-Flush + Snapshot-Race). | `useCollab.ts` / frontend `collabClient.ts` |
| P11 | `syncPersistentCollabOnOpen` macht HTTP-Element-Sync (1s Delay, merge) UND WS-Join liefert Snapshot — doppelter Sync-Pfad, redundant. | `main.ts:2813-2887` |

## Design

### A. Connection State Machine (Plugin, zentral)

Neue zentrale Koordination in `main.ts` (oder eigene Datei `connectionCoordinator.ts`), die ALLE Join/Leave/Retry-Pfade bündelt. Ersetzt die verstreuten Trigger + `_joiningCollabInProgress`.

**States:**
```
idle            — kein Join gewünscht/aktiv (nicht-persistent Datei, Setting aus)
waiting_server  — Server/Netz nicht erreichbar, Backoff-Retry läuft
joining         — HTTP status/activate + WS connect in progress
connected       — WS offen, Snapshot empfangen
reconnecting    — WS verloren, Client-Retry läuft (persistent: unbegrenzt)
conflict_pending— Reconnect-Snapshot empfangen, beidseitiger Konflikt, Dialog wartet/queued
failed          — nicht-persistent Session: Reconnects erschöpft / Session weg
```

**Transitions (Auszug):**
- `idle → joining`: persistent Datei geöffnet/aktiv + Server erreichbar
- `joining → waiting_server`: HTTP/WS-Fehler (Netz) → Backoff-Retry (5s → 15s → 60s → cap 5min)
- `joining → idle`: Drawing nicht (mehr) persistent / 404 / User verlässt Datei
- `connected → reconnecting`: WS close (bestehendes Client-Verhalten)
- `reconnecting → connected`: WS open → Snapshot → Divergenz-Check (siehe C)
- `reconnecting → conflict_pending`: Snapshot zeigt beidseitige Änderungen
- `conflict_pending → connected`: User hat im Dialog entschieden
- `connected → joining` (anderer drawing): Auto-Switch bei Tab-Wechsel A→B
- beliebig → `waiting_server`: Health-Check sagt offline

**Sichtbarkeit:** Statusbar + Toolbar-Popover zeigen State an (`⏳ Verbinde…`, `🔴 Live (n)`, `🟡 Reconnecting x/∞`, `📴 Offline – warte auf Server`, `⚠️ Sync-Konflikt`). Manueller „Jetzt verbinden"-Button in `waiting_server`/`failed` (reset Backoff, sofortiger Versuch).

### B. Auto-Join-Trigger-Konsolidierung (Plugin)

Alle bisherigen Trigger rufen EINE Methode `ensureCollabJoined(file, drawingId)` auf:
- Datei-Öffnen / Tab-Wechsel (`reconcileServerState`-Pfad)
- `onServerReachabilityChanged(true)`
- `enablePersistentCollab` (explizit)
- `onReconnectFailed` (persistent re-activate)
- `backgroundReconcile` (60s) — nur als Fallback-Netz, State-Machine ist primär

`ensureCollabJoined`:
1. Guards: Setting `collabJoinFromObsidian`, Datei persistent, nicht schon joined **auf diese drawingId**, State nicht `joining`.
2. Excalidraw-API-Readiness-Check mit Backoff-Retry (500ms → 1s → 2s → 4s, max ~10 Versuche), statt silent return (fixt P4).
3. HTTP `/api/collab/status` → ggf. `/api/persistent-collab/activate` → `joinCollabFromObsidian`.
4. Fehlerklassifikation: Netzwerkfehler → `waiting_server` + Backoff. HTTP 404 → reconcile-Logik (frontmatter cleanup, existiert). Password required/invalid → Passwort-Dialog (fixt P7): `promptPassword` zeigen, ein Retry mit Passwort; Passwort nur in-memory für die Session, nie persistieren.

### C. Offline-Phase & Reconnect-Konfliktauflösung (Plugin)

**Während Disconnect:**
- `collabManager` setzt `localDirtySinceDisconnect = true` bei jedem lokalen onChange während `!isConnected`.
- `collabClient` **flusht bufferedUpdates NICHT mehr automatisch** beim Reconnect (entfernen, fixt P3). Buffer wird bei Reconnect verworfen, Delta-Tracking resettet (existiert via `resetDeltaTracking` im onopen).
- Statusbar zeigt Offline-Zustand; Zeichnen bleibt uneingeschränkt möglich.

**Bei Reconnect (Snapshot empfangen):**
- Initialer Join (`!hasJoinedOnce`): Snapshot **ersetzt** lokalen Stand wie bisher (kein Dirty möglich vor erstem Join).
- Reconnect (`hasJoinedOnce`): Divergenz-Check VOR dem Anwenden:
  - `serverChanged`: Snapshot enthält Elemente mit `version > lastKnownVersions.get(id)`, oder Elemente die in `lastKnownVersions` unbekannt sind (von anderen Teilnehmern), oder bei persistent: `persistent_collab_version` höher als letzter bekannter Stand.
  - `localChanged`: `localDirtySinceDisconnect`.
- Matrix:
  | serverChanged | localChanged | Aktion |
  |---|---|---|
  | nein | nein | Snapshot still anwenden (nur appState/Collaborators), keine Notice |
  | ja | nein | Snapshot anwenden (ersetzen), Notice „Änderungen vom Server übernommen" |
  | nein | ja | **Lokalen Stand hochladen** (full `scene_update` mit `getSceneElementsIncludingDeleted()`), Notice „Lokale Änderungen hochgeladen" |
  | ja | ja | State → `conflict_pending`, **Konflikt-Dialog** |

**Wichtig — gelöschte Elemente:** Upload MUSS `getSceneElementsIncludingDeleted()` verwenden (Löschungen sind `isDeleted:true` + Version-Bump; Backend-Merge per id+version behandelt sie korrekt). Ohne IncludingDeleted würden Offline-Löschungen verloren gehen.

**Konflikt-Dialog (Obsidian Modal):**
- Titel: „Sync-Konflikt nach Verbindungsabbruch"
- Info: Anzahl lokal geänderter vs. Server-geänderter Elemente
- Optionen:
  1. **Zusammenführen** (default/empfohlen): Element-Merge lokal∩snapshot (höchste Version pro Element gewinnt, inkl. `isDeleted`), Ergebnis lokal anwenden + als full `scene_update` hochladen.
  2. **Server-Stand übernehmen**: Snapshot ersetzt lokalen Stand. Lokale Offline-Änderungen verworfen (Warnhinweis im Dialog).
  3. **Lokale Änderungen hochladen**: Lokaler Stand ersetzt Server (full scene_update inkl. deleted). Server-Änderungen verworfen (Warnhinweis).
- Wenn User gerade zeichnet (`isUserDrawing()`): Dialog queuen, erst nach Stroke-Ende zeigen (bestehende defer-Mechanik wiederverwenden). Bis dahin Snapshot zurückhalten, State `conflict_pending` sichtbar in Statusbar.
- Kein Auto-Timeout des Dialogs. Solange Dialog offen: eingehende `scene_update`s weiter queuen (bestehende pendingRemoteUpdates-Mechanik).

### D. Session-Lifecycle & Auto-Switch (Plugin)

- **Tab-Wechsel A→B (B persistent):** Session A verlassen (`collabManager.destroy()` + `cleanupCollabState`), dann `ensureCollabJoined(B)`. (Fixt P5.)
- **Tab-Wechsel A→B (B NICHT persistent):** Session A bleibt aktiv (Hintergrund-Sync läuft weiter; persistent Session ist server-side truth).
- **Datei-Close (Leaf detach der collab-Datei):** Session sauber verlassen + cleanup. (Fixt P8.) Prüfen: `onLayoutChange`/leaf-detach Erkennung für die spezifische Datei.
- **LiveSync-Suspend** (`suspendLiveSyncDuringCollab`) bleibt unverändert; beim Auto-Switch: suspend bleibt durchgehend aktiv (kein resume/suspend-Flattern zwischen leave/join — kurzes Zeitfenster abfedern, z.B. resume erst wenn 5s kein neuer Join).

### E. Health-Check & Netzwerk-Erkennung (Plugin)

- **`online`/`offline` Events** (`window.addEventListener('online'/'offline')` — funktioniert in Electron + Mobile WebView):
  - `offline` → sofort Status `📴 Offline`, Health-Check-Timer pausieren, WS-Reconnect-Timer pausieren (kein sinnloses Hammern).
  - `online` → sofort `checkServerHealth()` + `ensureCollabJoined` für aktive Datei, WS `manualReconnect()`.
- **Backoff wenn down:** 60s → 2min → 5min (cap). Bei `up`: zurück auf 60s.
- **Fehlerklassifikation:** `requestUrl` throw (DNS/TCP/Timeout) = „Netz offline"; HTTP ≥500 = „Server down"; beides getrennt in Statusbar anzeigen (gleiche Klasse `waiting_server`, nur Text anders).
- Health-Check initial nach Plugin-Start bleibt (2s), zusätzlich sofortiger Check beim ersten Öffnen einer persistent Datei.

### F. Multi-Gerät (Plugin)

- Beim ersten Start einmalig eine kurze Device-ID generieren (4 Zeichen, in `data.json` via `saveData`), Display-Name = `${collabDisplayName} · ${deviceId}`. Macht zwei Obsidian-Instanzen im gleichen Vault unterscheidbar (Cursor, Teilnehmerliste). Kein neues Setting nötig.
- Hinweis im Plan, KEIN Ziel: perfektes Multi-Host-Verhalten (zwei Hosts editieren gleichzeitig dieselbe Datei bleibt riskant — Version-Merge fängt es weitgehend ab).

### G. Frontend: Auto-Merge bei Reconnect

- `useCollab.ts`:
  - `localDirtyRef` setzen wenn `sendSceneUpdate`/`sendFilesUpdate` während disconnected aufgerufen wird.
  - Snapshot-Handler: bei initialem Join → replace wie bisher. Bei Reconnect → **Element-Merge** statt replace (höchste Version pro Element, `isDeleted` berücksichtigen), danach appState/collaborators/files anwenden (bestehender `withRemoteGuard` bleibt).
  - Wenn `localDirtyRef`: nach Merge einmalig vollen Stand als `scene_update` senden (Delta-Tracking wurde bei Reconnect resettet), dann `localDirtyRef = false`.
- Frontend `collabClient.ts`: bufferedUpdates-Auto-Flush entfernen (gleiche Änderung wie Plugin, P10/P3). Verwerfen beim Reconnect — der Post-Merge-Upload ersetzt ihn.
- Kein Dialog im Frontend (Entscheidung 5).

### H. Entflechtung Doppel-Sync (Plugin)

- `syncPersistentCollabOnOpen` (HTTP-Element-Sync mit 1s-Delay) bleibt NUR als Fallback für User mit `collabJoinFromObsidian=false`.
- Wenn Auto-Join aktiv: HTTP-Element-Sync überspringen — der Join-Snapshot + Konflikt-Check (C) übernimmt das. Entfernt doppelten Merge-Pfad (P11) und das 1s-Delay-Timing-Risiko.

## Edge-Cases-Matrix (alle abgedeckt)

| # | Szenario | Verhalten nach Redesign |
|---|----------|------------------------|
| E1 | Obsidian-Start, kein Internet | Health-Check fail → `waiting_server`, Backoff-Retry, Statusbar sichtbar. Bei `online`-Event sofort Join. (P1) |
| E2 | Obsidian-Start, Excalidraw-API noch nicht ready | API-Readiness-Retry (Backoff ~10x), dann Join. (P4) |
| E3 | Kurzer WLAN-Wechsel (<5s), keine Änderungen | WS reconnect, Snapshot ohne Divergenz → still, kein Dialog, keine Notice |
| E4 | Offline, nur lokal gezeichnet | Auto-Upload bei Reconnect + Notice. Löschungen via IncludingDeleted korrekt. |
| E5 | Offline, nur Server geändert (andere zeichnen) | Snapshot ersetzt lokal + Notice |
| E6 | Offline, beide geändert | Konflikt-Dialog (3 Optionen), queued falls User zeichnet |
| E7 | Server-Restart (Sessions weg) | „session not found" → persistent: re-activate (bestehend), neuer Snapshot → Divergenz-Check wie E4-E6 |
| E8 | Laptop Sleep/Wake | `online`-Event → sofortiger Health-Check + Reconnect statt bis 60s warten (E) |
| E9 | Server down bei Start, kommt später | Backoff-Health-Check → reachable → auto-join (bestehend, jetzt über State-Machine) |
| E10 | Tab-Wechsel A→B (beide persistent) | Auto-Switch: leave A, join B (D) |
| E11 | Tab-Wechsel zu nicht-persistent Datei | Session A bleibt aktiv (D) |
| E12 | Collab-Datei wird geschlossen | Session sauber verlassen (D) |
| E13 | LiveSync schreibt Datei während Collab | `suspendLiveSyncDuringCollab` + `detectExternalFileChanges` bleiben wie bisher |
| E14 | Persistent Session passwortgeschützt, API-Key fehlt/ungültig | Passwort-Dialog, 1 Retry mit Passwort (B/P7) |
| E15 | baseUrl/API-Key nicht konfiguriert | Kein Join-Versuch, Toolbar-Hinweis (existiert größtenteils) |
| E16 | Drawing auf Server gelöscht | 404 → reconcile cleart frontmatter (existiert), State → idle |
| E17 | Zwei Geräte, gleiches Vault, gleichzeitig | Unterscheidbare Namen via Device-ID-Suffix (F). Kein Ghost-Join-Loop (existierende Fixes bleiben) |
| E18 | Mobile Obsidian im Hintergrund | WS stirbt → bei Resume: `online`/Visibility-Event → Reconnect (E) |
| E19 | User zeichnet gerade als Reconnect-Snapshot ankommt | Konflikt-Dialog queued bis Stroke-Ende; scene_updates laufen in pendingRemoteUpdates (C) |
| E20 | Frontend-Gast offline, zeichnet weiter | Auto-Merge + Upload nach Reconnect, kein Dialog (G) |
| E21 | Mehrere schnelle Trigger parallel | State-Machine: `joining`-Guard ersetzt `_joiningCollabInProgress`, ein Join-Versuch zur Zeit (B) |
| E22 | Join schlägt fehl wegen voller Session (20 Teilnehmer) | Server-Error „session full" o.ä. → Notice an User, State → `failed` mit manuellem Retry (B) |

**Known Limitations (unverändert, Backend nicht im Scope):**
- Server räumt Ghost-User erst bei WS-Close/TCP-Timeout auf (kein serverseitiges Heartbeat-Timeout für Teilnehmer).
- Zwei Hosts editieren gleichzeitig dieselbe Datei auf zwei Geräten: Version-Merge fängt Konflikte ab, aber kein CRDT — „höchste Version gewinnt".

## Implementierungs-Tasks (geordnet)

1. **Plugin: State-Machine + `ensureCollabJoined`** (neu, zentral) — States, Guards, Backoff-Retry, Statusbar/Toolbar-Anbindung, manueller Retry-Button. Alle alten Trigger auf `ensureCollabJoined` umleiten; `autoJoinPersistentCollab`-Direktaufrufe ersetzen.
2. **Plugin: Excalidraw-API-Readiness-Retry** im Join-Pfad.
3. **Plugin: `collabClient` — bufferedUpdates-Auto-Flush entfernen**, Verwerfen bei Reconnect (Delta-Reset existiert).
4. **Plugin: `collabManager` — Dirty-Tracking + Snapshot-Divergenz-Check + Konflikt-Auflösung** (`localDirtySinceDisconnect`, `serverChanged`-Vergleich via `lastKnownVersions`, Upload via `getSceneElementsIncludingDeleted()`, Snapshot-Apply nur nach Auflösung). Neuer `ReconnectConflictModal` (Modal mit 3 Optionen + Element-Zählern + Warnhinweisen). Dialog-Queue während `isUserDrawing()`.
5. **Plugin: Passwort-Dialog** bei Join-Fehler „password required/invalid" (Fehlerklasse aus WS-Error/HTTP-Status mappen).
6. **Plugin: Auto-Switch + Datei-Close-Lifecycle** (leave/destroy bei Wechsel zu anderer persistent Datei bzw. Datei-Close; LiveSync-Suspend über Switch hinweg halten).
7. **Plugin: Health-Check** — `online`/`offline`-Events, Backoff (60s→5min), Fehlerklassifikation Netz vs. Server.
8. **Plugin: Device-ID-Suffix** für Display-Name (einmalig generieren, `saveData`).
9. **Plugin: `syncPersistentCollabOnOpen` entflechten** — HTTP-Element-Sync nur noch wenn `collabJoinFromObsidian=false`.
10. **Frontend: `useCollab` Snapshot-Merge + Dirty-Upload** (Reconnect-Pfad), Frontend `collabClient` Auto-Flush entfernen.
11. **Statusbar-/Toolbar-Texte** finalisieren (alle States, DE/EN-konsistent zum bisherigen Stil).
12. **AGENTS.md aktualisieren** (neues Verhalten, State-Machine, geänderte Buffer-Semantik).

## Validierung (manuell, kein Test-Framework vorhanden)

Pro Edge-Case E1-E22 manuell durchspielen; Kern-Sequenzen:

1. **Silent-fail-Regression (E1/E2):** Obsidian mit deaktiviertem WLAN starten, persistent Datei öffnen → Statusbar zeigt `📴`/Retry; WLAN an → Join ohne manuellen Eingriff.
2. **Offline-Merge (E4-E6):** Server + Browser-Gast offen; Plugin-WLAN aus; lokal zeichnen (inkl. Element löschen); Gast zeichnet (nur E6); WLAN an → E4: Auto-Upload, Gast sieht Änderungen inkl. Löschung. E6: Dialog erscheint, alle 3 Optionen durchtesten.
3. **Auto-Switch (E10/E11):** Zwei persistent Dateien abwechselnd öffnen → jeweils korrekte Session, Statusbar participant count stimmt, kein Doppel-Join (Admin-Panel prüfen: 1 Teilnehmer pro Session).
4. **Sleep/Wake (E8):** Laptop 2min suspend → Resume → Reconnect < 5s.
5. **Frontend (E20):** Browser offline (DevTools) → zeichnen → online → Merge sichtbar, kein Element-Verlust auf beiden Seiten.
6. **Server-Restart (E7):** Backend neu starten während Session → Plugin re-aktiviert, keine Join/Leave-Schleife im Browser.
7. **Passwort (E14):** Persistent collab mit Passwort, Plugin ohne API-Key → Passwort-Dialog → Join klappt.

## Offene Punkte / bewusst out of scope

- Backend-Änderungen (Heartbeat, Replace-Flag für scene_update, persistente Session-Auth) — nicht nötig für dieses Design.
- CRDT/OT für echte Konflikt-freiheit — Version-Merge bleibt die Semantik.
- `Viewer.tsx`/`DrawingsBrowser.tsx` Größen-Refactoring — unverändert.
