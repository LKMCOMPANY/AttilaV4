# ADB & Automation Reference — Attila V4

> Dictionnaire complet des commandes ADB et APIs d'automatisation pour les devices VMOS Magic Box.
> Toutes les commandes ont été testées en live via le tunnel Cloudflare le 13/04/2026.

---

## Comment exécuter des commandes

### Méthode principale : Shell API

Toutes les commandes ADB passent par l'endpoint shell de l'API VMOS :

```
POST /android_api/v1/shell/{db_id}
Body: { "id": "{db_id}", "cmd": "{commande}" }

Requête :
  curl -X POST -H "Content-Type: application/json" \
    -d '{"id":"EDGE85P6LQWN3OHY","cmd":"input tap 540 1200"}' \
    https://box-1.attila.army/android_api/v1/shell/EDGE85P6LQWN3OHY

Réponse :
  {
    "code": 200,
    "data": {
      "cmd": "input tap 540 1200",
      "db_id": "EDGE85P6LQWN3OHY",
      "host_ip": "192.168.1.27",
      "message": ""
    },
    "msg": "success"
  }
```

**Règle critique** : une seule commande par appel. Ne PAS chaîner avec `&&`.
Les commandes chaînées provoquent des timeouts.

### Méthode secondaire : Device Bridge

Pour les APIs internes au container (localhost:18185), on passe aussi par le shell :

```
POST /android_api/v1/shell/{db_id}
Body: { "id": "{db_id}", "cmd": "curl -s http://localhost:18185/api/{endpoint}" }
```

Voir la section "Device Bridge" plus bas.

---

## Résolution d'un device

```
1. Récupérer le device en base → db_id + box_id
2. Récupérer la box en base → tunnel_hostname
3. Appeler : https://{tunnel_hostname}/android_api/v1/shell/{db_id}

Headers obligatoires :
  CF-Access-Client-Id: {token_id}
  CF-Access-Client-Secret: {token_secret}
```

---

## 1. Contrôle tactile

### Tap

```
input tap {x} {y}
```

| Paramètre | Type | Description |
|-----------|------|-------------|
| `x` | int | Position horizontale (0 = gauche, 1080 = droite) |
| `y` | int | Position verticale (0 = haut, 2340 = bas) |

Résolution des devices : **1080 × 2340** (tous les devices actuels).

Testé : `input tap 540 1200` → code 200, ~418ms via tunnel.

### Swipe

```
input swipe {x1} {y1} {x2} {y2} {duration_ms}
```

| Action | Commande | Description |
|--------|----------|-------------|
| Scroll down (voir plus de contenu) | `input swipe 540 1500 540 700 500` | Swipe vers le haut |
| Scroll up | `input swipe 540 700 540 1500 500` | Swipe vers le bas |
| Swipe droite | `input swipe 200 1000 800 1000 200` | |
| Swipe gauche | `input swipe 800 1000 200 1000 200` | |

Testé : tous OK, code 200.

### Long press

```
input swipe {x} {y} {x} {y} {duration_ms}
```

Un swipe sur le même point = un long press. `duration_ms` = durée du press.

Exemple : `input swipe 540 1200 540 1200 1000` (1 seconde).

Testé : code 200.

### Double tap

Deux taps séparés. **Ne PAS chaîner avec `&&`** — envoyer deux appels API distincts.

---

## 2. Saisie de texte

### Taper du texte

```
input text '{texte}'
```

| Cas | Commande | Note |
|-----|----------|------|
| Mot simple | `input text 'hello'` | |
| Plusieurs mots | `input text 'hello%sworld'` | `%s` = espace |
| Phrase | `input text 'Bonjour%sle%smonde'` | |

Testé : tous OK.

**Limitations** :
- Pas de caractères spéciaux (émojis, accents complexes)
- Pour les accents simples, tester au cas par cas
- `%s` remplace les espaces (le shell Android ne gère pas les espaces dans `input text`)

### Effacer du texte

```
input keyevent KEYCODE_DEL
```

Supprime un caractère (backspace). Répéter N fois pour supprimer N caractères.

### Effacer tout un champ

Sélectionner tout puis supprimer (3 appels séparés) :

```
1. input keyevent 122          (KEYCODE_MOVE_HOME — curseur au début)
2. input keyevent 28 123       (SHIFT + MOVE_END — sélectionner tout)
3. input keyevent 67           (KEYCODE_DEL — supprimer la sélection)
```

---

## 3. Touches système

| Commande | Description | Testé |
|----------|-------------|-------|
| `input keyevent KEYCODE_HOME` | Bouton Home | ✅ |
| `input keyevent KEYCODE_BACK` | Bouton Back | ✅ |
| `input keyevent KEYCODE_ENTER` | Valider / Entrée | ✅ |
| `input keyevent KEYCODE_DEL` | Backspace (supprimer) | ✅ |
| `input keyevent KEYCODE_TAB` | Tab (champ suivant) | ✅ |
| `input keyevent KEYCODE_ESCAPE` | Escape | ✅ |
| `input keyevent KEYCODE_WAKEUP` | Allumer l'écran | ✅ |
| `input keyevent KEYCODE_SLEEP` | Éteindre l'écran | ✅ |
| `input keyevent KEYCODE_APP_SWITCH` | Apps récentes | ✅ |
| `input keyevent KEYCODE_DPAD_UP` | Navigation haut | ✅ |
| `input keyevent KEYCODE_DPAD_DOWN` | Navigation bas | ✅ |
| `input keyevent KEYCODE_VOLUME_DOWN` | Volume - | ✅ |
| `input keyevent 224` | Wake (keyevent numérique) | ✅ (utilisé dans apps-service.ts) |

### Codes keyevent utiles (numériques)

| Code | Nom | Usage |
|------|-----|-------|
| 3 | HOME | |
| 4 | BACK | |
| 24 | VOLUME_UP | |
| 25 | VOLUME_DOWN | |
| 26 | POWER | |
| 66 | ENTER | |
| 67 | DEL (backspace) | |
| 82 | MENU | |
| 122 | MOVE_HOME | Curseur au début |
| 123 | MOVE_END | Curseur à la fin |
| 187 | APP_SWITCH | |
| 224 | WAKEUP | |

---

## 4. Gestion des applications

### Méthode recommandée : Shell ADB

Les APIs VMOS `app_start`/`app_stop` ont des formats incohérents et des comportements imprévisibles.
**Privilégier les commandes shell** :

#### Ouvrir une app

```
am start -n {package}/{activity}
```

Exemple Chrome :
```
am start -n com.android.chrome/com.google.android.apps.chrome.Main
```

Réponse : `Starting: Intent { cmp=com.android.chrome/... }`

#### Ouvrir une URL

```
am start -a android.intent.action.VIEW -d {url}
```

Exemples :
```
am start -a android.intent.action.VIEW -d https://x.com
am start -a android.intent.action.VIEW -d https://x.com/elonmusk/status/123456
am start -a android.intent.action.VIEW -d https://tiktok.com
```

Testé : ouvre Chrome avec l'URL, code 200.

#### Fermer une app

```
am force-stop {package}
```

Exemple : `am force-stop com.android.chrome`

Testé : code 200.

#### Lister les apps installées

```
pm list packages          # Toutes (109 packages typiquement)
pm list packages -3       # Apps tierces uniquement
pm list packages | grep twitter   # Chercher une app spécifique
```

Testé : code 200. Retourne la liste ligne par ligne `package:{nom}`.

#### Vérifier l'app au premier plan

```
dumpsys window | grep mCurrentFocus
```

Réponse : `mCurrentFocus=Window{... com.android.chrome/com.google.android.apps.chrome.Main}`

#### Ouvrir les Settings Android

```
am start -a android.settings.SETTINGS
```

### API VMOS (alternative, moins fiable)

| Endpoint | Body | Note |
|----------|------|------|
| `POST /android_api/v1/app_start` | `{"db_ids":["ID"],"app":"package"}` | Champ `app` (pas `package_name`). Retourne souvent "app non trouvée" même si installée. |
| `POST /android_api/v1/app_stop` | `{"db_ids":["ID"],"app":"package"}` | Champ `app` + `db_ids` requis. |
| `POST /android_api/v1/stop_front_app/{db_id}` | `{}` | Ferme l'app au premier plan. Format de réponse instable. |
| `POST /android_api/v1/install_apk_from_url_batch` | `{"db_ids":"ID","url":"https://..."}` | `db_ids` est un **string** (pas un array). `url` (pas `apk_url`). |

**Recommandation** : utiliser `am start`/`am force-stop` via shell pour la fiabilité.

---

## 5. Packages des apps sociales

| App | Package | Activity principale |
|-----|---------|---------------------|
| Twitter/X | `com.twitter.android` | `com.twitter.android.StartActivity` |
| Twitter Lite | `com.twitter.android.lite` | — |
| TikTok | `com.zhiliaoapp.musically` | — |
| Instagram | `com.instagram.android` | — |
| Facebook | `com.facebook.katana` | — |
| WhatsApp | `com.whatsapp` | — |
| YouTube | `com.google.android.youtube` | — |
| Chrome | `com.android.chrome` | `com.google.android.apps.chrome.Main` |

Pour vérifier si une app est installée :
```
pm list packages | grep twitter
```

Pour trouver l'activity principale d'une app installée :
```
dumpsys package {package} | grep -A1 "android.intent.action.MAIN"
```

---

## 6. Informations device

### État de l'écran

```
dumpsys power | grep mWakefulness
```

Réponses : `mWakefulness=Awake` ou `mWakefulness=Asleep`

### Résolution et densité

```
wm size         → "Physical size: 1080x2340"
wm density      → "Physical density: 480"
```

### Propriétés device (fingerprint)

```
getprop ro.product.model          → "SM-S9010"
getprop ro.product.brand          → "samsung"
getprop ro.product.manufacturer   → "samsung"
getprop ro.serialno               → "R5GNTY26PYY"
getprop ro.build.version.release  → "13"
getprop ro.build.version.sdk      → "33"
```

### Batterie

```
dumpsys battery | grep level      → "level: 45"
```

### Stockage

```
df -h /data | tail -1
```

### Mode avion

```
settings get global airplane_mode_on    → "0" (désactivé)
```

### Notifications

```
dumpsys notification | grep 'NotificationRecord' | wc -l
```

---

## 7. Device Bridge — APIs internes (localhost:18185)

Ces endpoints sont accessibles uniquement depuis l'intérieur du container.
On les appelle via le shell en faisant un `curl` interne.

### Format d'appel

```
# GET
cmd: "curl -s http://localhost:18185/api/{endpoint}"

# POST
cmd: "curl -s -X POST http://localhost:18185/api/{endpoint} -H 'Content-Type:application/json' --data-raw '{json}'"
```

Le code de MagicBox-Industrial (`device-bridge.ts`) construit ces commandes
de manière sécurisée avec shell quoting.

### Endpoints de lecture (GET)

| Endpoint | Réponse | Testé |
|----------|---------|-------|
| `google/reset_gaid` | GAID actuel (ex: `3b98a41a-abd4-4ea7-...`) | ✅ |
| `battery/get` | `{ level, status, health, voltage, temperature, plugged }` | ✅ |
| `contact/list` | `{ count, list: [{ display_name, phones }] }` | ✅ |
| `sensor/list` | Liste des capteurs (accelerometer, magnetometer, etc.) | ✅ |
| `power/status` | `{ is_screen_on, is_locked }` | Documenté (apps-service.ts) |
| `package/list` | Liste des packages | Documenté |

### Endpoints d'écriture (POST)

| Endpoint | Body | Usage |
|----------|------|-------|
| `google/reset_gaid` | `{}` | Reset le Google Advertising ID |
| `system/update_settings` | `{ timezone, language, region }` | Changer locale |
| `location/set_data` | `{ enabled, persist, latitude, longitude, altitude, accuracy }` | Injecter GPS |
| `media/mute` | `{ mute: true }` | Muter le son |
| `sensor/set_data` | `{ sensors: [{ type, x, y, z }] }` | Configurer capteurs |
| `battery/set` | `{ level, status, health, plugged }` | Simuler batterie |
| `contact/add_list` | `{ contact_list: [{ name, phone }] }` | Ajouter contacts |
| `sms/add_list` | `{ sms_list: [{ address, body, type }] }` | Ajouter SMS |
| `calllog/add_list` | `{ calllog_list: [{ number, type, duration }] }` | Ajouter appels |
| `permission/set` | `{ package_name, grant: true, grant_all: true }` | Permissions |
| `power/set_screen` | `{ on: true/false }` | Allumer/éteindre écran |
| `power/locked` | `{ locked: true/false }` | Verrouiller/déverrouiller |

---

## 8. API VMOS — Container management

### Gestion du cycle de vie

| Endpoint | Méthode | Body | Usage |
|----------|---------|------|-------|
| `/container_api/v1/list_names` | GET | — | Liste tous les containers + ports |
| `/container_api/v1/get_android_detail/{db_id}` | GET | — | Détails hardware |
| `/container_api/v1/screenshots/{db_id}` | GET | — | Screenshot JPEG |
| `/container_api/v1/rom_status/{db_id}` | GET | — | ROM ready ? |
| `/container_api/v1/create` | POST | Voir ci-dessous | Créer un container |
| `/container_api/v1/run` | POST | `{ db_ids: ["ID"] }` | Démarrer |
| `/container_api/v1/stop` | POST | `{ db_ids: ["ID"] }` | Arrêter |
| `/container_api/v1/delete` | POST | `{ db_ids: ["ID"] }` | Supprimer |
| `/container_api/v1/reboot` | POST | `{ db_ids: ["ID"] }` | Redémarrer |
| `/container_api/v1/clone` | POST | — | Cloner |
| `/container_api/v1/rename/{db_id}/{new_name}` | GET | — | Renommer |
| `/container_api/v1/replace_devinfo` | POST | Voir contracts | Fingerprinting |
| `/container_api/v1/gms_start` | GET | — | Activer Google Play |
| `/container_api/v1/gms_stop` | GET | — | Désactiver Google Play |

### Body de create

```json
{
  "user_name": "FR8",
  "adiID": 42,
  "country": "FR",
  "locale": "fr-FR",
  "timezone": "Europe/Paris",
  "lat": 48.8566,
  "lon": 2.3522,
  "dns": "8.8.8.8",
  "bool_start": true,
  "image_repository": "vcloud_android13_edge_20260307170335"
}
```

### Proxy

| Endpoint | Méthode | Body |
|----------|---------|------|
| `/android_api/v1/proxy_set/{db_id}` | POST | `{ proxyType, proxyName, ip, port, account, password }` |
| `/android_api/v1/proxy_get/{db_id}` | GET | — |
| `/android_api/v1/proxy_stop/{db_id}` | POST | — |

### Locale / Géo

| Endpoint | Méthode | Body |
|----------|---------|------|
| `/android_api/v1/get_timezone_locale/{db_id}` | GET | — |
| `/android_api/v1/ip_geo/{db_id}` | GET | — |
| `/android_api/v1/gps_inject/{db_id}` | POST | `{ lat, lng }` |
| `/android_api/v1/country_set/{db_id}` | POST | `{ country }` |
| `/android_api/v1/language_set/{db_id}` | POST | `{ language }` |
| `/android_api/v1/timezone_set/{db_id}` | POST | `{ timezone }` |

---

## 9. Provisioning — Séquence complète

Le provisioning d'un device suit 19 étapes dans un ordre précis
(défini dans `contracts/provisioning-sequence.v1.json`) :

```
1.  create_instance       → POST /container_api/v1/create
2.  start_instance        → POST /container_api/v1/run
3.  wait_ready_initial    → GET /container_api/v1/rom_status/{db_id} (poll)
4.  probe_geo             → shell: curl via proxy vers ip-api.com (optionnel)
5.  apply_fingerprint     → POST /container_api/v1/replace_devinfo
6.  patch_device_props    → SSH: stop → patch adb_debug.prop → start (optionnel)
7.  wait_ready_post_fp    → GET /container_api/v1/rom_status/{db_id} (poll)
8.  validate_fingerprint  → shell: getprop ro.product.model etc. (optionnel)
9.  enable_gms            → GET /container_api/v1/gms_start
10. reset_gaid            → bridge: POST google/reset_gaid (optionnel)
11. apply_locale          → bridge: POST system/update_settings + location/set_data
12. mute_device           → bridge: POST media/mute
13. set_sensors           → bridge: POST sensor/set_data
14. set_battery           → bridge: POST battery/set
15. inject_humanisation   → bridge: POST contact/add_list + sms/add_list + calllog/add_list
16. grant_permissions     → bridge: POST permission/set (Chrome)
17. screen_off            → bridge: POST power/set_screen { on: false }
18. set_proxy             → POST /android_api/v1/proxy_set/{db_id}
19. verify_proxy          → GET /android_api/v1/proxy_get/{db_id}
```

Le proxy est toujours configuré en dernier car `replace_devinfo` peut reset la config proxy.

---

## 10. Humanisation — Données injectées

Le service d'humanisation (`humanisation-service.ts`) injecte des données réalistes
pour que le device ressemble à un vrai téléphone utilisé.

### Contacts (7 par défaut)

Générés par pays avec noms et préfixes téléphoniques locaux :

| Pays | Noms | Préfixe |
|------|------|---------|
| FR | Marie, Pierre, Sophie, Jean, Camille, Maman, Papa | +33 |
| GB | Oliver, Emma, Harry, Charlotte, George, Mum, Dad | +44 |
| US | James, Emily, Michael, Sarah, David, Mom, Dad | +1 |
| DE | Anna, Lukas, Lena, Felix, Marie, Mama, Papa | +49 |
| ES | Maria, Carlos, Ana, Pablo, Laura, Mama, Papa | +34 |
| IT | Marco, Giulia, Luca, Francesca, Alessandro, Mamma, Papa | +39 |

### SMS (4 par défaut)

Messages réalistes avec dates espacées :
```
"ok a demain", "tu viens ce soir ?", "oui j arrive", "merci !"
```

### Journal d'appels (5 par défaut)

Mix d'appels entrants (type 1), sortants (type 2), manqués (type 3),
avec des durées réalistes (30s à 10min).

### Capteurs

Valeurs réalistes pour un téléphone posé sur une table :
- Accéléromètre : ~9.81 m/s² sur Y (gravité)
- Gyroscope : ~0 (immobile)
- Luminosité : 150-350 lux
- Pression : 5.0 hPa

### Batterie

Niveau par défaut : 72% (configurable), status 3 (not charging), health 2 (good).

---

## 11. Séquences d'automation — Poster un commentaire

Les coordonnées x/y ci-dessous sont indicatives (résolution 1080×2340).
Elles **doivent être calibrées** une fois les apps installées car elles varient
selon la version de l'app, la langue, et la présence de barres de notification.

Deux approches possibles :
- **Via l'app native** (Twitter/TikTok) : plus stable, moins de popups
- **Via Chrome** (web mobile) : pas besoin d'installer l'app, mais plus de friction (cookies, redirections)

### Séquence Twitter/X — Commentaire via l'app native

```
Prérequis : com.twitter.android installé, compte connecté, device running

1. WAKE DEVICE
   → input keyevent KEYCODE_WAKEUP
   → vérifier: dumpsys power | grep mWakefulness → "Awake"

2. OUVRIR LE POST CIBLE
   → am start -a android.intent.action.VIEW -d https://x.com/user/status/123456
   → attendre: 3-5 secondes
   → vérifier: dumpsys window | grep mCurrentFocus → com.twitter.android

3. TAPER SUR LE CHAMP "REPLY"
   → input tap {x_reply} {y_reply}
   → attendre: 1-2 secondes (le clavier apparaît)

4. TAPER LE COMMENTAIRE
   → input text '{commentaire}'
   → note: espaces = %s

5. POSTER
   → input tap {x_post_button} {y_post_button}
   → attendre: 2-3 secondes

6. VÉRIFIER
   → dumpsys window | grep mCurrentFocus
   → si toujours sur Twitter → succès probable
   → si dialog/popup → erreur (compte bloqué, vérification)

7. RETOUR HOME
   → input keyevent KEYCODE_HOME

8. REPORTER
   → UPDATE campaign_jobs SET status = 'done' ou 'failed'
```

### Séquence Twitter/X — Commentaire via Chrome (web)

```
Prérequis : Chrome installé, compte X connecté dans Chrome, device running

1. WAKE DEVICE
   → input keyevent KEYCODE_WAKEUP

2. OUVRIR LE POST DANS CHROME
   → am start -a android.intent.action.VIEW -d https://x.com/user/status/123456
   → attendre: 4-6 secondes (Chrome charge la page)
   → vérifier: dumpsys window | grep mCurrentFocus → com.android.chrome

3. SCROLLER VERS LA ZONE DE RÉPONSE (si nécessaire)
   → input swipe 540 1500 540 800 500
   → attendre: 1 seconde

4. TAPER SUR LE CHAMP "Post your reply"
   → input tap {x_reply_field} {y_reply_field}
   → attendre: 1-2 secondes (clavier)

5. TAPER LE COMMENTAIRE
   → input text '{commentaire}'

6. TAPER "Reply"
   → input tap {x_reply_button} {y_reply_button}
   → attendre: 2-3 secondes

7. VÉRIFIER + HOME + REPORTER
   → même flow que ci-dessus
```

### Séquence TikTok — Commentaire via l'app native

```
Prérequis : com.zhiliaoapp.musically installé, compte connecté, device running

1. WAKE DEVICE
   → input keyevent KEYCODE_WAKEUP

2. OUVRIR LA VIDÉO CIBLE
   Option A — URL directe :
   → am start -a android.intent.action.VIEW -d https://www.tiktok.com/@user/video/123456
   → attendre: 4-6 secondes (TikTok charge la vidéo)
   
   Option B — Deep link TikTok :
   → am start -a android.intent.action.VIEW -d tiktok://video/123456
   → attendre: 3-5 secondes

   → vérifier: dumpsys window | grep mCurrentFocus → com.zhiliaoapp.musically

3. OUVRIR LES COMMENTAIRES
   → input tap {x_comment_icon} {y_comment_icon}
   → le panneau de commentaires glisse depuis le bas
   → attendre: 1-2 secondes

4. TAPER SUR LE CHAMP DE COMMENTAIRE
   → input tap {x_comment_field} {y_comment_field}
   → le clavier apparaît
   → attendre: 1 seconde

5. TAPER LE COMMENTAIRE
   → input text '{commentaire}'

6. POSTER
   → input tap {x_send_button} {y_send_button}
   → attendre: 2-3 secondes

7. FERMER LE PANNEAU
   → input keyevent KEYCODE_BACK
   → attendre: 1 seconde

8. RETOUR HOME + REPORTER
   → input keyevent KEYCODE_HOME
   → UPDATE campaign_jobs SET status = 'done' ou 'failed'
```

### Séquence TikTok — Commentaire via Chrome (web)

```
Prérequis : Chrome installé, compte TikTok connecté dans Chrome, device running

1. WAKE + OUVRIR L'URL
   → input keyevent KEYCODE_WAKEUP
   → am start -a android.intent.action.VIEW -d https://www.tiktok.com/@user/video/123456
   → attendre: 5-8 secondes (TikTok web est plus lent)

2. GÉRER LA POPUP "Open in app" (si présente)
   → TikTok web redirige souvent vers l'app store
   → Si popup : input keyevent KEYCODE_BACK ou input tap sur "Continue browsing"
   → attendre: 2 secondes

3. SCROLLER VERS LES COMMENTAIRES
   → input swipe 540 1800 540 600 500
   → attendre: 1-2 secondes

4. TAPER SUR "Add comment"
   → input tap {x} {y}
   → attendre: 1 seconde

5. TAPER + POSTER
   → input text '{commentaire}'
   → input tap {x_post} {y_post}
   → attendre: 2-3 secondes

6. HOME + REPORTER
```

### Notes communes à toutes les séquences

**Calibration des coordonnées** :
- Les x/y doivent être calibrés pour chaque app + version + résolution
- Méthode : se connecter en streaming, effectuer les actions manuellement,
  noter les coordonnées depuis les événements touch ou via screenshot + mesure
- Les coordonnées peuvent changer si l'app se met à jour

**App native vs Chrome** :
- App native = plus fiable, moins de popups, plus rapide
- Chrome = pas besoin d'installer l'app, mais redirections possibles,
  cookies à gérer, parfois layouts différents mobile/desktop
- **Recommandation** : utiliser les apps natives

**Gestion des erreurs** :
- Compte bloqué → l'app affiche un message → le flow ne progresse pas → `failed`
- Vérification requise (CAPTCHA, téléphone) → idem → `failed`
- Rate limit → l'app peut ne pas poster → vérifier si le commentaire apparaît
- App crash → `dumpsys window` ne montre plus l'app → `failed`
- Pas de retry : marquer `failed`, loguer la raison, passer au suivant

**Timing** :
- Les `attendre` sont des `sleep` côté gateway (pas des appels API)
- Adapter les durées selon la vitesse du proxy et de la connexion
- Sur un proxy lent, augmenter les waits de 50-100%

**Statut d'installation** (testé le 13/04/2026) :
- Twitter (`com.twitter.android`) : **NON installé** sur les devices actuels
- TikTok (`com.zhiliaoapp.musically`) : **NON installé** sur les devices actuels
- Chrome (`com.android.chrome`) : **Installé** sur tous les devices
- Les apps sociales sont installées manuellement par l'opérateur via le streaming

---

## 12. Limites et points d'attention

### Ce qui ne fonctionne PAS

| Fonctionnalité | Résultat | Alternative |
|----------------|----------|-------------|
| Chaîner des commandes avec `&&` | **Timeout** | Envoyer une commande par appel API |
| `uiautomator dump` | `null root node` | Non disponible dans les containers VMOS |
| `GET /app_get/{db_id}` | Tableau toujours vide | Utiliser `pm list packages` via shell |
| API `app_start` avec `package_name` | Champ non reconnu | Utiliser `am start` via shell |

### Latence via tunnel

| Opération | Latence |
|-----------|---------|
| Un appel shell simple | 200-500ms |
| Screenshot | 150-300ms |
| Séquence 6 étapes | ~2.1s |
| RTT réseau moyen | 137ms |

### Devices qui s'éteignent

Les devices peuvent passer en `stopped` entre deux appels (économie d'énergie, maintenance).
Toujours vérifier le `state` via `list_names` avant d'exécuter une automation.

### Sécurité des commandes

Le code de MagicBox-Industrial (`device-bridge.ts` + `safe-shell-command.ts`) impose :
- Validation regex sur les endpoints : `^[a-zA-Z0-9_/-]+$`
- Shell quoting de tous les paramètres
- Validation JSON des payloads avant construction de la commande
- Pas d'injection possible via les champs `cmd`

---

## 13. Code existant réutilisable

| Module | Fichier | Ce qu'il fait |
|--------|---------|---------------|
| Client HTTP résilient | `MagicBox-Industrial/src/infrastructure/http/http-client.ts` | Retries, circuit breaker, timeouts |
| Client MagicBox | `MagicBox-Industrial/src/infrastructure/magicbox/magicbox-client.ts` | `call()` pour API, `callDevice()` pour bridge |
| Device Bridge | `MagicBox-Industrial/src/infrastructure/magicbox/device-bridge.ts` | Construit les commandes curl sécurisées |
| Shell quoting | `MagicBox-Industrial/src/infrastructure/magicbox/safe-shell-command.ts` | Échappement sécurisé |
| Apps service | `MagicBox-Industrial/src/domain/apps/apps-service.ts` | Mute, sensors, battery, screen, permissions, wake |
| Humanisation | `MagicBox-Industrial/src/domain/humanisation/humanisation-service.ts` | Contacts, SMS, call logs par pays |
| Fingerprint | `MagicBox-Industrial/src/domain/fingerprint/fingerprint-service.ts` | replaceDevInfo, resetGaid |
| Locale | `MagicBox-Industrial/src/domain/locale/locale-service.ts` | Timezone, language, GPS |
| Proxy | `MagicBox-Industrial/src/domain/proxy/proxy-service.ts` | Set/get proxy |
| Provisioning | `MagicBox-Industrial/src/application/provisioning/provisioning-orchestrator.ts` | Séquence complète 19 étapes |
| Scrcpy player | `MagicBox-Tunnel/webapp/src/components/scrcpy-player.tsx` | WebCodecs H.264 + contrôle tactile |
| Scrcpy codec | `MagicBox-Tunnel/webapp/src/lib/scrcpy-codec.ts` | Parseur protocole binaire VMOS |
| API client | `MagicBox-Tunnel/webapp/src/lib/api.ts` | Client fetch typé (attention: utilise `command` au lieu de `cmd`) |
| Contracts | `MagicBox-Industrial/contracts/device-api.v1.json` | Contrat API versionné |
