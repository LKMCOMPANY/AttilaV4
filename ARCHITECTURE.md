# ATTILA V4 — Architecture technique

> Documentation de référence pour le développement. Mise à jour le 15 avril 2026.

---

## Vue d'ensemble

Attila V4 automatise des comptes sur les réseaux sociaux (X, TikTok, Instagram) via des téléphones Android virtuels hébergés sur des Magic Boxes VMOS. Des opérateurs distants gèrent les avatars, lancent des campagnes et contrôlent les devices via une webapp.

### Principe architectural

```
CLOUD (Render + Supabase)              BOXES (on-premise, inchangées)
────────────────────────               ──────────────────────────────
Dashboard admin + client               cloudflared (tunnel)
Worker automator (IA + jobs)           magicbox-proxy (routing)
Base de données multi-tenant           cbs_go API VMOS (devices)
Auth / RBAC                            Gateway (sync + exec local)
```

---

## Les 4 composants

```
┌──────────────────────────────────────────────────────┐
│                      RENDER                           │
│                                                       │
│   Web Service           Background Worker             │
│   (Next.js)             (Node.js)                     │
│                                                       │
│   Dashboard admin       Automator                     │
│   Dashboard client      Écoute GORGONE                │
│   Auth / RBAC           Filtre / IA / rédige          │
│                         Planifie les jobs             │
│                                                       │
│              Supabase (DB + Auth + Realtime)           │
│                                                       │
└──────────────────────┬────────────────────────────────┘
                       │
              Supabase Realtime
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
      BOX 1         BOX 2         BOX N
     gateway        gateway       gateway
     proxy          proxy         proxy
     tunnel         tunnel        tunnel
     devices        devices       devices
         ▲             ▲             ▲
         │   Cloudflare Tunnels      │
         │   (streaming direct)      │
         └─────────┬─────────────────┘
              NAVIGATEUR
              OPÉRATEUR
```

### Composant 1 — Render Web Service (Next.js)

Dashboard multi-tenant, gestion, monitoring. Pas de WebSocket serveur, pas de custom server. Next.js App Router standard.

### Composant 2 — Render Background Worker (Node.js)

Reçoit les alertes GORGONE, filtre, appelle l'IA pour décider/rédiger, planifie les jobs dans Supabase. Ne touche jamais un device directement.

### Composant 3 — Supabase

Base de données PostgreSQL + Auth + Realtime + Row Level Security. Sert de file de messages entre le worker et les gateways via Realtime subscriptions.

### Composant 4 — Gateway (sur chaque box)

Process Node.js léger (~500 lignes), service séparé à côté du proxy (ne touche pas au streaming) :
- Synchronise l'état des devices vers Supabase (les devices apparaissent dans le dashboard)
- Consomme les jobs d'automation via Supabase Realtime et les exécute localement via ADB
- Reporte la santé de la box (heartbeat toutes les 30s)

Le streaming reste géré par `cloudflared → magicbox-proxy`, inchangé.

---

## Produit — Structure fonctionnelle

### Admin Dashboard (équipe Attila)

```
Admin Dashboard
├── Comptes clients
│   ├── Liste des comptes
│   ├── Créer un compte
│   ├── Gérer les users par compte
│   └── Impersonation → accéder au dashboard client
│
├── Boxes
│   ├── Liste de toutes les boxes (sync automatique via gateway)
│   └── Attribuer une box à 1 ou plusieurs comptes clients
│
├── Devices
│   ├── Liste de tous les devices (sync automatique via gateway)
│   └── Attribuer un device à un compte client
│
├── Avatars (vue globale)
│
└── Users (admins + clients, rôles)
```

Les boxes et devices sont créés manuellement (via terminal, Cursor, scripts). L'app ne fait que les voir (via la sync gateway) et les attribuer aux clients.

### Dashboard Client (clients ou admin en impersonation)

```
Dashboard Client
├── Avatar Manager
│   ├── Voir mes devices attribués
│   ├── Streaming live → contrôle tactile du device
│   ├── Créer un avatar (identité, personnalité, style)
│   ├── Créer des comptes réseaux sociaux sur le device
│   └── Lier avatar ↔ device ↔ comptes
│
└── Avatar Automator
    ├── Créer une campagne (Twitter / TikTok)
    ├── Sélectionner les avatars
    ├── Configurer les règles de publication
    ├── Lancer / pauser / arrêter
    └── Suivre les résultats en temps réel
```

### Rôles

| Rôle | Périmètre |
|------|-----------|
| `admin` | Tout. Crée les comptes clients, gère les boxes/devices, impersonne les clients. |
| `client_admin` | Son compte uniquement. Gère ses avatars, campagnes, users du compte. |
| `client_user` | Son compte uniquement. Utilise le streaming, crée des avatars, lance des campagnes. |

---

## Infrastructure Magic Box

### Specs matérielles (Box-1)

| Élément | Valeur |
|---------|--------|
| CPU | Rockchip RK3588S (aarch64, 8 coeurs) |
| RAM | 32 GB |
| OS | Debian 11 (Bullseye) — ARM64 |
| Node.js | v20.20.1 |
| Disque | 26 GB total |
| Containers | 31 (capacité testée) |

### Services sur chaque box

| Service | Port | Rôle | Statut |
|---------|------|------|--------|
| `cbs_go` (VMOS natif) | 18182 (IP LAN) | API REST — gestion des containers Android | Existant |
| `magicbox-proxy` | 8080 (127.0.0.1) | Reverse proxy — route HTTP + WebSocket | Existant |
| `cloudflared` | — | Tunnel Cloudflare (QUIC sortant) | Existant |
| `site-gateway` | — | Sync Supabase + exécution automations | **A créer** |

### Architecture réseau sur la box

```
Internet (opérateurs)
    │
    ▼
cloudflared (tunnel QUIC sortant)
    │
    ▼
magicbox-proxy (:8080)              ← NE CHANGE PAS
    ├── /stream/{id}/video → WS scrcpy (port dynamique)
    ├── /stream/{id}/touch → WS scrcpy (port dynamique)
    ├── /* → API cbs_go (:18182)
    └── /healthz → statut proxy

site-gateway (service séparé)       ← NOUVEAU, indépendant
    │
    ├──→ Supabase Realtime (sync devices, reçoit jobs, heartbeat)
    │
    └──→ http://127.0.0.1:8080/* (appelle le proxy en local
         pour exécuter les automations ADB)
```

Le gateway est un service **à côté** du proxy, pas devant. Il ne touche pas
au streaming ni au routing. Si le gateway plante, le streaming et l'API
continuent de fonctionner normalement.

### Tunnel Cloudflare

| Élément | Valeur |
|---------|--------|
| Hostname | `box-1.attila.army` |
| Domaine | `attila.army` |
| Protocole | QUIC (connexion sortante, aucun port entrant) |
| Auth | Un seul service token wildcard `*.attila.army` pour toutes les boxes |
| Convention | `box-{n}.attila.army` |

Un seul CF-Access Application couvre `*.attila.army`. Un seul service token
donne accès à toutes les boxes. Les boxes sont déjà protégées par le tunnel
(connexion sortante, aucun port ouvert).

### Ports dynamiques par container

| Usage | Port interne | Port hôte (ex) |
|-------|-------------|-----------------|
| Vidéo (WebSocket scrcpy) | 9999 | 25002 |
| Contrôle tactile (WebSocket scrcpy) | 9997 | 29002 |
| Audio (TCP brut) | 9998 | 27002 |
| ADB | 5555 | 31002 |

Les ports hôte sont résolvables via `GET /container_api/v1/list_names`.

---

## API VMOS — Référence testée

Toutes les réponses ci-dessous ont été obtenues en live via le tunnel Cloudflare le 13/04/2026.

### Latence mesurée

| Mesure | Valeur |
|--------|--------|
| RTT moyen (healthz, 10 appels) | **137ms** |
| Connexion TCP | 22ms |
| Handshake TLS | 62ms |
| Appel API typique | 200-500ms |
| Séquence 6 étapes (automation complète) | **2.1s** |
| Streaming WebSocket estimé | **~180ms** (RTT + frame 30fps) |

### Container API — `/container_api/v1/`

#### `GET /list_names`

Liste tous les containers avec leurs ports dynamiques.

```json
{
  "code": 200,
  "data": {
    "host_ip": "192.168.1.27",
    "list": [
      {
        "adb": 31021,
        "db_id": "EDGE3BD3397RQJPC",
        "name": "EDGE3BD3397RQJPC",
        "state": "running",
        "tcp_audio_port": 27021,
        "tcp_control_port": 29021,
        "tcp_port": 25021,
        "user_name": "FR8"
      }
    ]
  },
  "msg": "success"
}
```

Résultat testé : **31 containers** (4 running, 27 stopped).

#### `GET /get_android_detail/{db_id}`

Détails hardware/software d'un container.

```json
{
  "code": 200,
  "data": {
    "adb_port": 31021,
    "aosp_version": "13",
    "cpuset": "1-7",
    "dns": "8.8.8.8",
    "dpi": "480",
    "fps": "30",
    "height": "2340",
    "id": "e58988822df0...",
    "image": "vcloud_android13_edge_20260307170335:latest",
    "ip": "172.17.0.2",
    "mac": "02:42:ac:11:00:02",
    "memory": 4096,
    "name": "EDGE3BD3397RQJPC",
    "network": "bridge",
    "short_id": "e58988822df0",
    "status": "running",
    "user_name": "EDGE3BD3397RQJPC",
    "width": "1080"
  },
  "msg": "success"
}
```

Sur un device stopped : `code: 201`, `status: "exited"`, `msg: "container not running"`.

#### `GET /rom_status/{db_id}`

```json
{ "code": 200, "data": { "db_id": "EDGE3BD3397RQJPC" }, "msg": "ROM已就绪" }
```

`msg` contient du chinois = "ROM ready".

#### `GET /screenshots/{db_id}`

- Running : HTTP 200, `image/jpg`, ~330-500 KB, ~270ms
- Stopped : HTTP 200, 135 bytes, JSON erreur (`code: 5`)

#### `GET /clone_status`

```json
{ "code": -1, "data": null, "msg": "No cloning tasks" }
```

#### `GET /sync_status`

```json
{ "code": 200, "data": {}, "msg": "同步成功" }
```

#### Autres endpoints Container API (documentés, non testés en écriture)

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/create` | POST | Créer un container |
| `/run` | POST | Démarrer un container |
| `/stop` | POST | Arrêter un container |
| `/delete` | POST | Supprimer un container |
| `/clone` | POST | Cloner un container |
| `/reboot` | POST | Redémarrer un container |
| `/rename/{db_id}/{new_name}` | POST | Renommer |
| `/set_ip` | POST | Configurer l'IP |
| `/adb_start/{db_id}` | POST | Démarrer ADB |
| `/replace_devinfo` | POST | Fingerprinting (remplacer infos device) |
| `/update_user_prop` | POST | Mettre à jour les propriétés |
| `/reset` | POST | Reset un container |
| `/gms_start` | POST | Activer Google Play Services |
| `/gms_stop` | POST | Désactiver Google Play Services |
| `/refreshScreenService` | POST | Rafraîchir le service écran |
| `/update_stopped_image` | POST | Mettre à jour image arrêté |
| `/upgrade_image` | POST | Upgrader l'image |
| `/update_cert` | POST | Mettre à jour le certificat |

### Android API — `/android_api/v1/`

#### `POST /shell/{db_id}`

Exécute n'importe quelle commande shell Android.

```json
// Requête
{ "id": "EDGE3BD3397RQJPC", "cmd": "echo hello" }

// Réponse
{
  "code": 200,
  "data": {
    "cmd": "echo hello",
    "db_id": "EDGE3BD3397RQJPC",
    "host_ip": "192.168.1.27",
    "message": "hello"
  },
  "msg": "success"
}
```

Commandes testées et fonctionnelles :
- `input tap 540 1200` — tap tactile (~418ms)
- `input text hello` — saisie de texte (~327ms)
- `dumpsys window | grep mCurrentFocus` — app au premier plan
- `dumpsys power | grep mWakefulness` — état de l'écran (Awake/Asleep)
- `dumpsys battery | grep level` — niveau de batterie
- `getprop ro.product.model` — modèle (Samsung SM-S9010)
- `getprop ro.product.brand` — marque (samsung)
- `df -h /data` — espace disque
- `pm list packages -3` — apps tierces installées

Sur un device stopped : `code: 201`, message chinois = "instance not running".

#### `GET /proxy_get/{db_id}`

```json
{
  "code": 200,
  "data": {
    "proxy_config": {
      "enabled": true,
      "proxyType": "socks5",
      "ip": "disp.oxylabs.io",
      "port": 8002,
      "account": "user-Attila_TlnrC",
      "password": "MAVpF0DOOwIQ_KiA",
      "dnsServers": ["8.8.8.8", "8.8.4.4"]
    },
    "user_name": "FR8"
  }
}
```

#### `POST /proxy_set/{db_id}`

Champs requis : `proxyType`, `proxyName`, `ip`, `port`, `account`, `password`.

#### `GET /get_timezone_locale/{db_id}`

```json
{
  "code": 200,
  "data": {
    "country": "FR",
    "locale": "fr-FR",
    "timezone": "Europe/Paris",
    "user_name": "FR8"
  }
}
```

#### `GET /ip_geo/{db_id}`

```json
{
  "code": 200,
  "data": {
    "city": "Falkenstein",
    "country": "Germany",
    "ip": "disp.oxylabs.io",
    "lat": 50.4777,
    "lon": 12.3649,
    "source": "ip-api.com"
  }
}
```

#### `GET /app_get/{db_id}`

```json
{ "code": 200, "data": { "app": [], "db_id": "EDGE3BD3397RQJPC" } }
```

Note : retourne un tableau vide même si des apps sont visibles. Utiliser `pm list packages -3` via shell comme alternative fiable.

#### Autres endpoints Android API

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/app_start` | POST | Lancer une app |
| `/app_stop` | POST | Fermer une app |
| `/stop_front_app/{db_id}` | POST | Fermer l'app au premier plan |
| `/install_apk_from_url_batch` | POST | Installer des APK depuis URLs |
| `/upload_file_android_batch` | POST | Uploader des fichiers |
| `/export_phone_apk` | POST | Exporter un APK |
| `/root_app` | POST | Rooter une app |
| `/gps_inject/{db_id}` | POST | Injecter GPS |
| `/proxy_stop/{db_id}` | POST | Arrêter le proxy |
| `/country_set/{db_id}` | POST | Changer le pays |
| `/language_set/{db_id}` | POST | Changer la langue |
| `/timezone_set/{db_id}` | POST | Changer le timezone |
| `/video_inject/{db_id}` | POST | Injecter un flux vidéo |

### Device Bridge — `localhost:18185` (dans chaque container)

Accessible via `POST /android_api/v1/shell/{db_id}` avec `cmd: "curl -s http://localhost:18185/api/{endpoint}"`.

#### Endpoints testés et fonctionnels

| Endpoint | Méthode | Réponse |
|----------|---------|---------|
| `google/reset_gaid` | GET | `code: 200`, retourne le GAID actuel |
| `battery/get` | GET | `code: 200`, level, status, health, voltage, temperature |
| `contact/list` | GET | `code: 200`, liste des contacts (7 contacts sur device testé) |
| `sensor/list` | GET | `code: 200`, liste des capteurs (accelerometer, magnetometer, etc.) |

#### Endpoints d'écriture (documentés via contracts, non testés en écriture)

| Endpoint | Méthode | Usage |
|----------|---------|-------|
| `google/reset_gaid` | POST | Reset le Google Advertising ID |
| `system/update_settings` | POST | Timezone, language, region |
| `location/set_data` | POST | GPS (lat, lon, altitude, accuracy) |
| `media/mute` | POST | Muter le son |
| `sensor/set_data` | POST | Configurer les capteurs |
| `battery/set` | POST | Simuler un niveau de batterie |
| `contact/add_list` | POST | Ajouter des contacts |
| `sms/add_list` | POST | Ajouter des SMS |
| `calllog/add_list` | POST | Ajouter des appels |
| `permission/set` | POST | Accorder des permissions à une app |
| `power/set_screen` | POST | Allumer/éteindre l'écran |

---

## Streaming — Protocole scrcpy VMOS

Le streaming vidéo utilise des WebSockets avec un protocole binaire spécifique (différent du scrcpy standard).

### Connexion

```
Navigateur → wss://box-N.attila.army/stream/{db_id}/video  (flux H.264)
Navigateur → wss://box-N.attila.army/stream/{db_id}/touch  (contrôle tactile)
Navigateur → wss://box-N.attila.army/stream/{db_id}/audio  (flux Opus via TCP→WS bridge)
```

Le `magicbox-proxy` sur la box résout les ports dynamiques via `list_names` et proxy les WebSockets.
Pour l'audio, le proxy bridge le TCP brut du port audio en WebSocket (`audio-bridge.js`).

### Frame 0 — Méta (130 bytes)

```
device_name  (64 bytes, UTF-8, null-padded)
codec        (4 bytes, "h264")
width        (4 bytes, big-endian uint32, ex: 1080)
height       (4 bytes, big-endian uint32, ex: 2336)
frame_header (12 bytes: flags + padding + PTS)
SPS NAL      (variable, start code 00 00 00 01, NAL type 7)
PPS NAL      (variable, start code 00 00 00 01, NAL type 8)
```

### Frames vidéo (12 bytes header + H.264 data)

```
byte 0     : flags (bit 6 = keyframe)
bytes 1-3  : padding
bytes 4-11 : PTS (8 bytes)
data       : H.264 NAL units en AnnexB (start codes 00 00 00 01)
```

### Contrôle tactile (32 bytes par événement)

```
byte 0      : 0x02 (INJECT_TOUCH_EVENT)
byte 1      : action (0=DOWN, 1=UP, 2=MOVE)
bytes 2-9   : pointer_id (int64 BE, -1 = souris)
bytes 10-13 : x (int32 BE)
bytes 14-17 : y (int32 BE)
bytes 18-19 : video_width (uint16 BE)
bytes 20-21 : video_height (uint16 BE)
bytes 22-23 : pressure (uint16 BE, 0xFFFF=max)
bytes 24-27 : action_button (int32 BE)
bytes 28-31 : buttons (int32 BE)
```

### Décodage navigateur — Vidéo

- **WebCodecs API** (`VideoDecoder`) pour le décodage H.264 hardware
- Codec string extrait du SPS : `avc1.42c032`
- Rendu sur canvas 2D (`ctx.drawImage(videoFrame, 0, 0)`)
- 30fps (timestamps synthétiques, incréments de 33333µs)
- Requiert Chrome/Edge. Fallback screenshot pour Firefox.

### Audio streaming — Protocole et décodage

L'audio n'est **pas activé par défaut** sur les containers VMOS (le scrcpy principal
tourne avec `audio=false`). L'app démarre un processus scrcpy audio dédié à la demande.

#### Activation (server action `enableDeviceAudio`)

```
1. Vérifie si le port 9998 est déjà en écoute (netstat)
2. Si non, démarre un scrcpy audio-only :
   CLASSPATH=$([ -f /data/local/scd ] && echo /data/local/scd || echo /vendor/bin/scd)
   app_process / com.genymobile.scrcpy.Server 3.3.3
     connection_mode=tcp video=false audio=true audio_port=9998
     control=false daemon=true
3. Poll jusqu'à ce que le port 9998 soit en écoute (~2s)
```

Le classpath utilise la même logique de fallback que le script `/data/local/scd.sh`
du système VMOS : préfère `/data/local/scd`, fallback sur `/vendor/bin/scd`.

#### Protocole audio (TCP → WebSocket bridge)

Le flux audio passe par le `audio-bridge.js` du proxy (TCP brut → WebSocket).
Les chunks TCP arrivent en messages WebSocket de taille arbitraire. Le client
doit réassembler le flux avec un parser à états :

```
64 bytes   device name (UTF-8, null-padded, ex: "SM-S9010")
4 bytes    codec string ("opus")
repeated:
  12 bytes  frame header
  N bytes   frame data (Opus encoded)

Frame header :
  byte 0      flags (0x80 = config frame / OpusHead)
  bytes 1-3   padding
  bytes 4-7   PTS (uint32 BE)
  bytes 8-11  data length N (uint32 BE)
```

#### Décodage navigateur — Audio

- **WebCodecs API** (`AudioDecoder`) pour le décodage Opus hardware
- Opus stereo, 48 kHz, frames de 20ms
- Playback via `AudioContext` → `AudioBufferSourceNode` → `GainNode`
- Scheduling avec `nextPlayTime` pour un playback fluide sans gaps
- Auto-reconnexion avec backoff exponentiel (2s → 15s max)

#### Fichiers

| Fichier | Rôle |
|---------|------|
| `src/lib/streaming/audio-player.ts` | Player : stream parser + AudioDecoder + AudioContext |
| `src/hooks/use-audio-toggle.ts` | Hook partagé : enable scrcpy audio + toggle stream |
| `src/app/actions/device-control.ts` | `enableDeviceAudio()` — démarre le process sur le device |

---

## Modèle de données — Boxes et Devices

### Principe : 3 niveaux de stockage

```
STOCKÉ EN BASE           → données stables, nécessaires pour le dashboard
(créé une fois)            et l'attribution aux clients

SYNC PAR LE GATEWAY      → état temps réel, mis à jour toutes les 30s
(rafraîchi en continu)     le dashboard affiche le dernier état connu

FETCH À LA DEMANDE       → données lourdes ou détaillées
(quand l'opérateur clique)  chargées quand on ouvre le détail d'un device
```

### Table `boxes`

| Colonne | Type | Source | Sync | Description |
|---------|------|--------|------|-------------|
| `id` | uuid PK | Généré | — | Identifiant interne |
| `tunnel_hostname` | text UNIQUE | Config | — | `box-1.attila.army` |
| `lan_ip` | inet | API `list_names` → `host_ip` | Gateway 30s | `192.168.1.27` |
| `status` | text | API `healthz` | Gateway 30s | `online` / `offline` |
| `uptime_seconds` | numeric | API `healthz` → `uptime` | Gateway 30s | Uptime en secondes |
| `container_count` | int | API `healthz` → `containers` | Gateway 30s | Nombre total de containers |
| `last_heartbeat` | timestamptz | Gateway | Gateway 30s | Dernière sync réussie |
| `created_at` | timestamptz | — | — | Date d'ajout |
| `metadata` | jsonb | — | — | Données libres (CPU, RAM, disque) |

Données source (API `healthz`) :
```json
{ "status": "ok", "uptime": 1193920.07, "containers": 31 }
```

### Table `account_boxes` (N:N — box partageable entre clients)

| Colonne | Type | Description |
|---------|------|-------------|
| `account_id` | uuid FK → accounts | Compte client |
| `box_id` | uuid FK → boxes | Box attribuée |

### Table `devices`

#### Colonnes stockées en base (stables, changent rarement)

| Colonne | Type | Source API | Description |
|---------|------|------------|-------------|
| `id` | uuid PK | Généré | Identifiant interne |
| `box_id` | uuid FK → boxes | Lien logique | Box parente |
| `account_id` | uuid FK → accounts, NULL | Admin | Compte client attribué (NULL = non attribué) |
| `db_id` | text UNIQUE | `list_names` → `db_id` | **Clé de liaison VMOS** — ex: `EDGE85P6LQWN3OHY` |
| `user_name` | text | `list_names` → `user_name` | Nom lisible — ex: `GB6` |
| `image` | text | `get_android_detail` → `image` | Image Android — ex: `vcloud_android13_edge_20260307170335:latest` |
| `aosp_version` | text | `get_android_detail` → `aosp_version` | Version Android — `13` |
| `resolution` | text | `get_android_detail` → `width`×`height` | `1080x2340` |
| `memory_mb` | int | `get_android_detail` → `memory` | `4096` |
| `dpi` | int | `get_android_detail` → `dpi` | `480` |
| `fps` | int | `get_android_detail` → `fps` | `30` |
| `model` | text | Shell `getprop ro.product.model` | `SM-S9010` (fingerprint) |
| `brand` | text | Shell `getprop ro.product.brand` | `samsung` |
| `serial` | text | Shell `getprop ro.serialno` | `R5GNTY26PYY` |
| `created_at` | timestamptz | — | Date de première apparition |

#### Colonnes synchronisées par le gateway (toutes les 30s)

| Colonne | Type | Source API | Description |
|---------|------|------------|-------------|
| `state` | text | `list_names` → `state` | `running` / `stopped` |
| `screen_state` | text | Shell `dumpsys power \| grep mWakefulness` | `Awake` / `Asleep` |
| `foreground_app` | text | Shell `dumpsys window \| grep mCurrentFocus` | Package de l'app au premier plan |
| `country` | text | `get_timezone_locale` → `country` | `GB` |
| `locale` | text | `get_timezone_locale` → `locale` | `en-GB` |
| `timezone` | text | `get_timezone_locale` → `timezone` | `Europe/London` |
| `proxy_enabled` | boolean | `proxy_get` → `proxy_config.enabled` | `true` |
| `proxy_host` | text | `proxy_get` → `proxy_config.ip` | `disp.oxylabs.io` |
| `proxy_port` | int | `proxy_get` → `proxy_config.port` | `8038` |
| `proxy_type` | text | `proxy_get` → `proxy_config.proxyType` | `socks5` |
| `battery_level` | int | Bridge `battery/get` → `data.level` | `28` |
| `docker_ip` | inet | `get_android_detail` → `ip` | `172.17.0.4` |
| `last_seen` | timestamptz | Gateway | Dernière sync réussie |

#### Données fetchées à la demande (quand l'opérateur ouvre le détail)

| Donnée | Source API | Taille/latence |
|--------|------------|----------------|
| Screenshot | `GET /screenshots/{db_id}` | 330-500 KB, ~270ms |
| Config proxy complète | `GET /proxy_get/{db_id}` | account, password, dns |
| Géolocalisation IP | `GET /ip_geo/{db_id}` | city, country, lat, lon |
| Apps installées | Shell `pm list packages -3` | Liste des packages tiers |
| Contacts | Bridge `contact/list` | Liste avec noms + numéros |
| Espace disque | Shell `df -h /data` | Usage disque |
| GAID | Bridge `google/reset_gaid` (GET) | Google Advertising ID |
| Capteurs | Bridge `sensor/list` | Liste des sensors simulés |

#### Données JAMAIS stockées (ports dynamiques)

| Donnée | Source | Pourquoi pas stocké |
|--------|--------|---------------------|
| `tcp_port` (vidéo) | `list_names` | Change à chaque start du container |
| `tcp_control_port` (touch) | `list_names` | Résolu à la volée par le proxy |
| `tcp_audio_port` (audio) | `list_names` | Résolu à la volée par le proxy |
| `adb_port` | `list_names` | Change à chaque start |

Le `magicbox-proxy` résout ces ports dynamiquement via `container-resolver.js` (cache 3s sur `list_names`).

### Le `db_id` — la clé universelle

Le `db_id` VMOS (ex: `EDGE85P6LQWN3OHY`) est l'identifiant qui relie tout :

```
Supabase (table devices)  ←── db_id ──→  API VMOS (container_api, android_api)
                          ←── db_id ──→  Streaming (wss://box/stream/{db_id}/video)
                          ←── db_id ──→  Automations (shell commands)
                          ←── db_id ──→  Device bridge (localhost:18185)
```

### Logique de sync du gateway

```
Toutes les 30 secondes :

1. GET /healthz
   → UPSERT boxes SET status, uptime, container_count, last_heartbeat

2. GET /container_api/v1/list_names
   → Pour chaque container :
     - S'il n'existe pas en base → INSERT (nouveau device détecté)
     - S'il existe → UPDATE state, last_seen

3. Pour chaque device RUNNING :
   - GET /get_android_detail/{db_id} → UPDATE docker_ip, etc.
   - GET /get_timezone_locale/{db_id} → UPDATE country, locale, timezone
   - GET /proxy_get/{db_id} → UPDATE proxy_*
   - Shell: dumpsys power → UPDATE screen_state
   - Shell: dumpsys window → UPDATE foreground_app
   - Bridge: battery/get → UPDATE battery_level

4. Pour chaque device STOPPED :
   - UPDATE state='stopped', screen_state=NULL, foreground_app=NULL
```

### Table `content_items` (bibliothèque de contenu par avatar)

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | uuid PK | Identifiant |
| `account_id` | uuid FK → accounts | Tenant propriétaire |
| `avatar_id` | uuid FK → avatars, NULL | Avatar associé |
| `file_name` | text | Nom original du fichier |
| `file_type` | text | `video` ou `image` |
| `file_size` | bigint | Taille en bytes |
| `mime_type` | text | `video/mp4`, `image/jpeg`, etc. |
| `storage_path` | text | Chemin dans le bucket Supabase Storage `content` |
| `status` | text | `uploading` / `ready` / `pushed` / `error` |
| `pushed_to_device_id` | uuid FK → devices, NULL | Device cible du dernier push |
| `pushed_at` | timestamptz | Date du dernier push |
| `created_by` | uuid FK → auth.users | User qui a uploadé |
| `created_at` | timestamptz | Date de création |

RLS : admin voit tout, les users ne voient que le contenu de leur `account_id`.

Storage : bucket `content` (privé, 100 MB max, types autorisés : MP4, MOV, WebM, MKV, JPEG, PNG, WebP, GIF).
Organisation : `{account_id}/{timestamp}_{filename}`.

### Données métier (100% Supabase, pas d'API box)

| Table | Description |
|-------|-------------|
| `accounts` | Comptes clients (id, name) |
| `users` | Users avec rôle et account_id |
| `avatars` | Identités virtuelles (identité, personnalité, style, device attribué) |
| `avatar_accounts` | Comptes réseaux sociaux par avatar (platform, username, credentials chiffrés) |
| `armies` | Groupes d'avatars |
| `content_items` | Bibliothèque de contenu (vidéos, images) par avatar, avec push vers device |
| `campaigns` | Campagnes d'automation (rules, guidelines, capacity_params JSONB par réseau, stats) |
| `campaign_posts` | Posts sources à traiter |
| `campaign_jobs` | Jobs individuels (avatar, device, contenu, scheduled_at, status, result) |
| `audit_log` | Trace de chaque action |

---

## Routage multi-box — Comment atteindre un device

Chaque device est identifié par deux clés : la **box** (`tunnel_hostname`) et le **device** (`db_id`).

### Schéma de routage

```
En base :

  boxes
  ├── id: uuid-1,  tunnel_hostname: "box-1.attila.army"
  ├── id: uuid-2,  tunnel_hostname: "box-2.attila.army"
  └── id: uuid-3,  tunnel_hostname: "box-3.attila.army"

  devices
  ├── id: uuid-a,  box_id: uuid-1,  db_id: "EDGE85P6LQWN3OHY"  (GB6 sur box-1)
  ├── id: uuid-b,  box_id: uuid-1,  db_id: "EDGE3BD3397RQJPC"  (FR8 sur box-1)
  ├── id: uuid-c,  box_id: uuid-2,  db_id: "EDGE_XXXXXXXXX"     (US3 sur box-2)
  └── id: uuid-d,  box_id: uuid-3,  db_id: "EDGE_YYYYYYYYY"     (JP1 sur box-3)
```

### Résolution d'un device (code applicatif)

```
L'app veut agir sur le device uuid-a :

1. SELECT db_id, box_id FROM devices WHERE id = 'uuid-a'
   → db_id = "EDGE85P6LQWN3OHY", box_id = "uuid-1"

2. SELECT tunnel_hostname FROM boxes WHERE id = 'uuid-1'
   → tunnel_hostname = "box-1.attila.army"

3. Appel API :
   https://box-1.attila.army/android_api/v1/shell/EDGE85P6LQWN3OHY
```

### URLs par type d'opération

```
Soit : BOX = tunnel_hostname, DEVICE = db_id

API Container :      https://{BOX}/container_api/v1/{endpoint}/{DEVICE}
API Android :        https://{BOX}/android_api/v1/{endpoint}/{DEVICE}
Streaming vidéo :    wss://{BOX}/stream/{DEVICE}/video     (WebSocket natif)
Streaming touch :    wss://{BOX}/stream/{DEVICE}/touch     (WebSocket natif)
Streaming audio :    wss://{BOX}/stream/{DEVICE}/audio     (TCP→WS bridge, requiert scrcpy audio actif)
Upload fichier URL : POST https://{BOX}/android_api/v1/upload_file_from_url_batch
Screenshot :         https://{BOX}/container_api/v1/screenshots/{DEVICE}
Health box :         https://{BOX}/healthz
```

Toutes les requêtes nécessitent les headers CF-Access :
```
CF-Access-Client-Id: {service_token_id}
CF-Access-Client-Secret: {service_token_secret}
```

---

## Flux opérateur

### Streaming (contrôle manuel + audio)

```
1. Opérateur clique "Streamer" sur un device dans le dashboard
2. Dashboard résout : device uuid-a → db_id + box tunnel_hostname
3. Navigateur ouvre les WebSockets via le custom server (server.mjs) :
   → /ws/stream/{boxId}/{dbId}/video  (H.264)
   → /ws/stream/{boxId}/{dbId}/touch  (contrôle tactile)
4. server.mjs valide la session (cookie Supabase), résout la box,
   puis proxy vers wss://box-N.attila.army/stream/{dbId}/{type}
   avec les headers CF-Access injectés côté serveur
5. Latence : ~180ms (RTT 137ms + frame 30fps)

Audio (à la demande) :
6. Opérateur clique l'icône speaker dans la NavBar
7. enableDeviceAudio() démarre le scrcpy audio sur le device (si pas déjà actif)
8. WebSocket audio connecté : /ws/stream/{boxId}/{dbId}/audio
9. AudioPlayer parse le flux TCP/Opus → AudioDecoder → AudioContext
```

Le streaming passe par le proxy existant, protégé par CF-Access. Le gateway
n'intercepte pas le streaming.

### Upload de contenu + push vers device

```
1. Opérateur ouvre l'onglet "Content" d'un avatar
2. Drag & drop ou sélection de fichiers (vidéos/images, max 100 MB)
3. Upload :
   a. POST /api/content/upload (FormData: file + accountId)
   b. Validation : session, ownership, type MIME, taille
   c. Upload vers Supabase Storage (bucket "content")
   d. Création du record content_items en base
4. Push vers device :
   a. Opérateur clique l'icône smartphone sur un fichier
   b. pushContentToDevice() :
      - Vérifie ownership du contenu ET du device (anti cross-tenant)
      - Génère un signed URL Supabase (5 min)
      - POST /android_api/v1/upload_file_from_url_batch
        { db_ids: "{db_id}", url: "{signed_url}", dest_path: "/sdcard/DCIM/Camera/" }
      - Trigger media scanner Android (am broadcast MEDIA_SCANNER_SCAN_FILE)
      - Update status = "pushed" en base
5. Le fichier apparaît dans la galerie/camera roll du device
```

### Automation (campagne de commentaires)

Le process complet se décompose en deux phases distinctes :

```
PHASE 1 — Intelligence (Worker Render)
───────────────────────────────────────

1. Client crée une campagne dans le dashboard
   → sélectionne des avatars, configure les règles
   → INSERT INTO campaigns → Supabase

2. Worker reçoit les posts collectés par GORGONE (API, plus tard)

3. Worker filtre les posts :
   → Type (post/RT), minimum followers, engagement, etc.

4. Worker appelle l'IA :
   → Filtre contextuel (guideline, pertinence)
   → Choix des avatars qui doivent répondre
   → Rédaction des réponses (style propre à chaque avatar)
   → Plusieurs tâches en parallèle

5. Pour chaque réponse validée :
   → Résout avatar → device → box (db_id + tunnel_hostname)
   → INSERT INTO campaign_jobs (
       device_db_id, box_id,
       avatar_id, campaign_id,
       content, post_url, platform,
       scheduled_at, status='ready'
     )

PHASE 2 — Exécution (Gateway sur la box)
─────────────────────────────────────────

6. Gateway reçoit la notification Supabase Realtime
   → filtre : "ce job concerne MA box ?"

7. Gateway exécute via ADB (commandes shell, comme Playwright sur mobile) :
   a. Vérifier que le device est running
   b. Wake screen
   c. Ouvrir l'app (Twitter / TikTok)
   d. Naviguer vers le post cible
   e. Taper le commentaire
   f. Poster
   g. Vérifier le résultat

8. Gateway UPDATE campaign_jobs :
   → status = 'done'   (succès)
   → status = 'failed'  (échec — compte bloqué, vérification requise, etc.)
   → error = raison de l'échec

9. Dashboard client se met à jour en temps réel via Supabase Realtime
```

Pas de retry automatique : si un job échoue (compte bloqué, vérification Twitter),
il est marqué `failed` et on passe aux suivants. La priorité est aux nouveaux posts,
pas aux anciens. Les échecs sont loggés pour analyse.

### Création device (hors app)

```
1. Opérateur technique crée le device sur la box (via terminal, Cursor, scripts)
2. Gateway sync (toutes les 30s) :
   GET /container_api/v1/list_names → détecte le nouveau db_id
   → INSERT INTO devices (box_id, db_id, user_name, state, ...)
3. Admin ouvre le dashboard → voit le nouveau device (account_id = NULL)
4. Admin clique "Attribuer" → sélectionne le compte client
   → UPDATE devices SET account_id = 'uuid-client'
5. Le client se connecte → voit le device dans son dashboard
```

---

## Sécurité

| Couche | Mécanisme |
|--------|-----------|
| Auth utilisateur | Supabase Auth (email/password ou OAuth) |
| Multi-tenant | Row Level Security — filtrage par `account_id` |
| Rôles | admin / client_admin / client_user |
| Streaming | JWT short-lived (5min), scoped device, validé par gateway |
| Tunnel | Cloudflare Tunnel QUIC (connexion sortante, aucun port ouvert) |
| Machine-to-machine | CF-Access-Client-Id + CF-Access-Client-Secret |
| Credentials avatars | Chiffrés en DB, déchiffrés par le gateway à l'exécution |
| Audit | Table `audit_log` pour chaque action |

---

## Stack technique

| Composant | Technologie | Hébergement | Coût |
|-----------|-------------|-------------|------|
| Dashboard + API | Next.js 16, App Router, Tailwind | Render Web Service | ~7$/mois |
| Automator | Node.js, Supabase client, SDK LLM | Render Background Worker | ~7$/mois |
| Base de données | PostgreSQL + Auth + Realtime | Supabase | Gratuit → 25$/mois |
| Tunnel | Cloudflare Tunnel (QUIC) | Cloudflare | Gratuit |
| Proxy box | Node.js (`http-proxy`, `ws`) | Sur la box (existant) | 0€ |
| Gateway box | Node.js (`ws`, `supabase-js`) | Sur la box (à créer) | 0€ |
| IA / LLM | OpenAI / Anthropic API | Via le worker Render | Usage |
| Data réseaux sociaux | GORGONE (app externe existante) | Séparé | Existant |

**Coût total infrastructure** : ~14-39$/mois + usage LLM

---

## Devices testés (état au 13/04/2026)

31 containers sur box-1, dont 4 running :

| user_name | db_id | state | country | proxy |
|-----------|-------|-------|---------|-------|
| FR8 | EDGE3BD3397RQJPC | running | FR | Oxylabs SOCKS5 |
| FR9 | EDGE8DK15O299ST5 | running | FR | — |
| GB5 | EDGET6EZI10SFKE8 | running | GB | — |
| GB6 | EDGE85P6LQWN3OHY | running | GB | — |

Tous les devices : Android 13, image `vcloud_android13_edge_20260307170335`, résolution 1080×2340, 4 GB RAM, fingerprint Samsung SM-S9010.

---

## Code existant (réutilisable)

### MagicBox-Tunnel (proto webapp + proxy)

| Fichier | Réutilisable ? | Notes |
|---------|---------------|-------|
| `proxy/src/*` | **Oui, tel quel** | Reste sur chaque box, ne change pas |
| `webapp/src/lib/scrcpy-codec.ts` | **Oui** | Parseur protocole scrcpy VMOS |
| `webapp/src/lib/scrcpy-stream.ts` | **Oui** | WebCodecs + canvas |
| `webapp/src/components/scrcpy-player.tsx` | **Oui** | Player H.264 + contrôle tactile |
| `webapp/src/lib/api.ts` | **À adapter** | Client API typé, bonne base |
| `webapp/src/lib/types.ts` | **À adapter** | Types des réponses API |
| `webapp/server.mjs` | **À supprimer** | Remplacé par le gateway |
| `config/config.yml` | **Référence** | Template tunnel Cloudflare |
| `scripts/provision-box.sh` | **Oui** | Provisioning d'une nouvelle box |

### MagicBox-Industrial (provisioning)

| Module | Réutilisable ? | Notes |
|--------|---------------|-------|
| `src/infrastructure/magicbox/magicbox-client.ts` | **Oui** | Client HTTP avec retries + circuit breaker |
| `src/infrastructure/magicbox/device-bridge.ts` | **Oui** | Bridge shell → curl localhost:18185 |
| `src/infrastructure/http/http-client.ts` | **Oui** | Client HTTP résilient |
| `src/application/provisioning/*` | **Oui** | Orchestrateur de provisioning complet |
| `src/domain/*` | **Oui** | Services métier (fingerprint, proxy, locale, apps) |
| `contracts/*.json` | **Oui** | Contrats API versionnés |
| `src/core/validation/*` | **Oui** | Validators Zod |

---

## Structure du monorepo cible

```
attila/
├── apps/
│   ├── web/                    → Render Web Service
│   │   ├── src/app/
│   │   │   ├── (auth)/         # Login, register
│   │   │   ├── (admin)/        # Dashboard admin
│   │   │   │   ├── accounts/   # Comptes clients
│   │   │   │   ├── boxes/      # Gestion boxes
│   │   │   │   ├── devices/    # Gestion devices
│   │   │   │   └── users/      # Gestion users
│   │   │   ├── (client)/       # Dashboard client
│   │   │   │   ├── avatars/    # Avatar manager
│   │   │   │   ├── campaigns/  # Avatar automator
│   │   │   │   └── devices/    # Mes devices + streaming
│   │   │   └── api/            # API routes
│   │   ├── supabase/migrations/
│   │   └── package.json
│   │
│   ├── worker/                 → Render Background Worker
│   │   ├── src/
│   │   │   ├── gorgone-listener.ts
│   │   │   ├── campaign-pipeline.ts
│   │   │   ├── ai-writer.ts
│   │   │   └── scheduler.ts
│   │   └── package.json
│   │
│   └── gateway/                → Déployé sur chaque box
│       ├── src/
│       │   ├── ws-relay.ts
│       │   ├── automation-executor.ts
│       │   ├── device-sync.ts
│       │   ├── health-reporter.ts
│       │   ├── auth.ts
│       │   └── index.ts
│       ├── gateway.service     # systemd unit
│       └── package.json
│
├── packages/
│   ├── shared-types/           # Types partagés
│   ├── contracts/              # Contrats API VMOS
│   └── magicbox-client/        # Client HTTP résilient (extrait de Industrial)
│
├── infra/
│   ├── box-proxy/              # magicbox-proxy existant (inchangé)
│   └── scripts/                # provision-box.sh, deploy
│
└── package.json                # npm workspaces
```

---

## Décisions d'architecture

| Décision | Justification |
|----------|---------------|
| Render pour le cloud (pas Vercel) | Web + Worker dans un seul compte. Pas de timeout. Pas besoin de Qstash. |
| Gateway **à côté** du proxy (pas devant) | Ne touche pas au streaming ni au routing existant. Si le gateway plante, le streaming continue. Le proxy VMOS reste inchangé. |
| Gateway sur la box | Exécution locale des automations ADB (fiabilité + performance). Sync des devices vers Supabase. Justifié par le volume d'automations et le multi-client. |
| Un seul token CF-Access wildcard | `*.attila.army` — un token pour toutes les boxes. Simple. Les boxes sont déjà protégées par le tunnel (connexion sortante). |
| Supabase comme colle | DB + Auth + Realtime = un seul service. Realtime remplace un broker de messages. RLS pour le multi-tenant. |
| Streaming direct navigateur → box | Via `cloudflared → magicbox-proxy → scrcpy`. Pas de hop cloud. Le gateway n'est pas dans ce chemin. Latence minimale (~180ms). |
| Boxes inchangées | `cloudflared` + `magicbox-proxy` + `cbs_go` restent tels quels. Seul ajout : le gateway (service indépendant). |
| Devices/boxes créés hors app | Opérations complexes (images, fingerprint, tunnel) mieux gérées en terminal. L'app fait la gestion et l'attribution. |
| Multi-tenant par `account_id` | RLS Supabase. Chaque client ne voit que ses données. Admin voit tout. |
| Worker = intelligence, Gateway = exécution | Le worker filtre, appelle l'IA, rédige, planifie. Le gateway exécute bêtement via ADB. Séparation claire des responsabilités. |
| Pas de retry automatique | Un job échoué est marqué `failed` et loggé. La priorité est aux nouveaux posts, pas aux anciens. Évite les embouteillages sur des comptes bloqués. |
| Pas de stockage de screenshots | Les automations logguent `done`/`failed`. Pas besoin de preuve visuelle pour le moment. |
| GORGONE : API plus tard | L'intégration GORGONE → Worker sera une API. Pas le sujet du développement initial. |
| App Mac/iOS : plus tard | Le dashboard web couvre tous les besoins pour le lancement. |
