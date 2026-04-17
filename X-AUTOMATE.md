# X-AUTOMATE — Automation Twitter/X via ADB sur containers VMOS

> Référence complète pour poster des commentaires Twitter/X via les containers VMOS Magic Box.
> Validé en live le 15 avril 2026 sur box-1.attila.army (devices FR2, FR8, US1).

---

## Principe

On poste des commentaires sur Twitter/X via les containers Android VMOS.
Le script **détecte automatiquement** si l'app Twitter native est installée :

- **App installée** → deep link ouvre le tweet dans l'app, le champ reply est en bas
- **Pas d'app** → deep link ouvre Chrome, on utilise l'URL `intent/post` pour le compose

Les deux flows sont 100% déterministes, pas besoin de LLM à l'exécution.

---

## Prérequis par device

| Élément | Détail |
|---------|--------|
| Chrome | Pré-installé sur tous les devices |
| Compte Twitter | Connecté dans l'app OU dans Chrome (login manuel via streaming) |
| ADBKeyboard | Installé et activé (`ime enable`) |
| Proxy | Configuré (Oxylabs ou autre) pour l'IP de sortie |

### Installation ADBKeyboard (une seule fois par device)

**Trois étapes obligatoires**, dans cet ordre :

```
1. POST /android_api/v1/install_apk_from_url_batch
   Body: {
     "db_ids": "{DB_ID}",
     "url": "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk"
   }

2. POST /android_api/v1/shell/{DB_ID}
   Body: { "id": "{DB_ID}", "cmd": "pm enable com.android.adbkeyboard" }

3. POST /android_api/v1/shell/{DB_ID}
   Body: { "id": "{DB_ID}", "cmd": "ime enable com.android.adbkeyboard/.AdbIME" }
```

⚠️ Sans le `pm enable` (étape 2), `install_apk_from_url_batch` laisse le package
en `enabled=0` et le service IME ne le voit pas — `ime enable` retourne alors
`Unknown input method ... cannot be enabled for user #0`.

Temps d'installation : ~6 secondes. À intégrer dans la séquence de provisioning.

**Provisioning de masse** : `node scripts/install-adbkeyboard.mjs` —
voir `ADB-REFERENCE.md` section 2 bis.

---

## Détection du mode : App native vs Chrome

```bash
pm list packages | grep twitter
```

| Résultat | Mode |
|----------|------|
| `package:com.twitter.android` | **APP** — utiliser le flow app native |
| *(vide)* | **CHROME** — utiliser le flow Chrome web |

---

## Flow APP NATIVE (quand `com.twitter.android` est installé)

### Avantages

- Le deep link ouvre directement le tweet dans l'app (pas dans Chrome)
- Le champ "Post your reply" est toujours visible en bas de l'écran
- Un seul deep link suffit (pas besoin de l'URL `intent/post`)
- `uiautomator dump` retourne de vrais resource-ids exploitables
- Layout plus stable que la webview Chrome

### Resource IDs de l'app Twitter

| Resource ID | Élément | Usage |
|-------------|---------|-------|
| `com.twitter.android:id/tweet_text` | Champ "Post your reply" (`EditText`) | Taper dessus pour focus |
| `com.twitter.android:id/tweet_button` | Bouton "Reply" (`Button`) | Taper pour poster |
| `com.twitter.android:id/inline_reply` | Icône Reply sous le tweet | Alternative pour ouvrir le compose |
| `com.twitter.android:id/persistent_reply` | Barre reply persistante en bas | Container du champ reply |
| `com.twitter.android:id/reply_sorting` | "Most relevant replies" | Filtre des réponses |
| `com.twitter.android:id/reply_context_text` | "Replying to @user" | Texte contextuel |

### Coordonnées (résolution 1080×2340)

| Élément | Coordonnées | Bounds du dump |
|---------|-------------|----------------|
| Champ "Post your reply" | `input tap 540 2277` | `[0,2214][1080,2340]` |
| Bouton "Reply" (poster) | `input tap 947 2220` | `[843,2172][1050,2268]` |

### Les 12 étapes (consolidé V4.1, 16 avril 2026)

```
ÉTAPE   COMMANDE                                                    DURÉE
─────   ────────                                                    ─────
 1      wakeDevice (WAKEUP + MENU + verify, retry swipe)            ~2s
 2      am start -d "{TWEET_URL}"                                   ~500ms
 3      sleep 6                                                     6s
 4      GET /screenshots/{DB_ID}                      📸 SOURCE     ~500ms
 5      input tap 540 2277  (reply field)                            ~500ms
 6      sleep 1.5                                                   1.5s
 7      ensureAdbKeyboard (enable + set + verify)                    ~1.5s
 8      input tap 540 2277  (re-tap après IME switch)                ~500ms
 9      typeText (broadcast + verify)                                ~500ms
10      sleep 1                                                     1s
11      input tap 947 2220  (bouton Reply)                           ~500ms
12      sleep 6 → am start -d "{TWEET_URL}" → sleep 6 → 📸 PREUVE  ~13s

TOTAL : ~28 secondes par commentaire
```

### Points critiques (bugs corrigés V4.1)

- **`ime enable` AVANT `ime set`** : sans enable, le device retourne code 201
  "Unknown input method" et le texte ne s'injecte jamais
- **Re-tap du champ** après switch IME : le focus se perd au changement de clavier
- **Vérification broadcast** : `typeText()` vérifie "Broadcast completed" dans la réponse
- **Vérification IME active** : `ensureAdbKeyboard()` vérifie via
  `settings get secure default_input_method` que le switch a bien pris effet

---

## Flow CHROME WEB (quand l'app Twitter n'est pas installée)

### Avantages

- Pas besoin d'installer l'app Twitter
- Chrome est pré-installé sur tous les devices
- L'URL `intent/post` ouvre directement le compose reply

### URL magique

```
https://x.com/intent/post?in_reply_to={TWEET_ID}
```

Ouvre directement la page de composition de réponse dans Chrome :
- Le tweet source est affiché en contexte
- Le champ "Post your reply" est prêt
- Le bouton "Reply" est en haut à droite

**Toujours utiliser `intent/post`**, jamais `compose/post` (layout instable, liens cliquables parasites).

### Coordonnées (résolution 1080×2340)

| Élément | Coordonnées | Note |
|---------|-------------|------|
| Champ "Post your reply" | `input tap 300 1000` | Sous le "Replying to @user" |
| Bouton "Reply" (poster) | `input tap 920 285` | En haut à droite de la page |

### Zones à éviter

| Zone | Coordonnées | Ce qui se passe |
|------|-------------|-----------------|
| "Replying to @user" | y=700-900, x=80-400 | Ouvre le sélecteur (page `compose/reply_to`) |
| Barre d'adresse Chrome | y=70-240 | Perd le contexte |

### Les 14 étapes (consolidé V4.1, 16 avril 2026)

```
ÉTAPE   COMMANDE                                                          DURÉE
─────   ────────                                                          ─────
 1      wakeDevice (WAKEUP + MENU + verify, retry swipe)                   ~2s
 2      am start -d "{TWEET_URL}"                                          ~500ms
 3      sleep 6                                                            6s
 4      GET /screenshots/{DB_ID}                             📸 SOURCE     ~500ms
 5      am start -d "https://x.com/intent/post?in_reply_to={TWEET_ID}"    ~500ms
 6      sleep 6                                                            6s
 7      input tap 300 1000  (reply field)                                   ~500ms
 8      sleep 1.5                                                          1.5s
 9      ensureAdbKeyboard (enable + set + verify)                           ~1.5s
10      input tap 300 1000  (re-tap après IME switch)                       ~500ms
11      typeText (broadcast + verify)                                       ~500ms
12      sleep 1                                                            1s
13      input tap 920 285  (bouton Reply)                                   ~500ms
14      sleep 6 → am start -d "{TWEET_URL}" → sleep 6 → 📸 PREUVE         ~13s

TOTAL : ~34 secondes par commentaire
```

---

## Saisie de texte — ADBKeyboard

### Pourquoi ADBKeyboard

| Méthode | ASCII | Espaces | Accents | Emojis | Recommandé |
|---------|-------|---------|---------|--------|------------|
| `input text` | ✅ | Via `%s` | ❌ CRASH | ❌ | Non |
| ADBKeyboard broadcast | ✅ | ✅ | ✅ | ✅ | **Oui** |

`input text` provoque un `NullPointerException` sur les caractères non-ASCII.

### Commandes

```bash
# Saisir du texte (unicode complet)
am broadcast -a ADB_INPUT_TEXT --es msg "Texte avec accents é è à et emojis 🤖🔥"

# Effacer le champ
am broadcast -a ADB_CLEAR_TEXT

# Activer ADBKeyboard
ime set com.android.adbkeyboard/.AdbIME

# Revenir à Gboard
ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME
```

### Workflow clavier

```
1. Gboard est le clavier par défaut (pour l'opérateur en streaming)
2. Avant la saisie → ime set ADBKeyboard
3. Saisie via broadcast
4. Après le post → ime set Gboard (restore)
```

---

## Vérification du résultat

### Succès

| Mode | Signal de succès |
|------|-----------------|
| App native | Retour automatique au tweet detail, reply visible |
| Chrome | Redirection vers `x.com/home` |

Le screenshot preuve montre le commentaire sous le tweet avec le timestamp ("Xs" ou "Xm").

### Échec — cas connus

| Écran | Signification | Action |
|-------|---------------|--------|
| "Unlock more on X" | Rate limiting nouveau compte | Le post passe souvent quand même |
| "Something went wrong" | Erreur Twitter temporaire | Retry |
| "Verify your identity" / CAPTCHA | Vérification requise | Marquer `failed` |
| Page blanche | Timeout réseau / proxy lent | Retry avec sleep plus long |

---

## Tests validés (15 avril 2026)

| # | Device | Mode | Compte | Tweet | Commentaire | Résultat |
|---|--------|------|--------|-------|-------------|----------|
| 1 | FR2 `EDGEMMSDVAA82KIU` | Chrome | @EmilyPolicy | @J0NB13 | "Attila V4 test 🤖" | ✅ |
| 2 | FR8 `EDGE3BD3397RQJPC` | Chrome | @DelhormePaulo | @JustRocketMan | "Those Furbys look ready for a board meeting" | ✅ |
| 3 | FR8 `EDGE3BD3397RQJPC` | Chrome | @DelhormePaulo | @JustRocketMan | "Donald Furby en mode attaque 😂" | ✅ |
| 4 | US1 `EDGEFXX5W5CEHEZ0` | **App** | @SmithOlive2... | @JustRocketMan | "Epic Fury mode activated, those Furbys are going full MAGA 😂🔥" | ✅ |

---

## Latences mesurées

| Opération | Latence |
|-----------|---------|
| Commande shell (tap, keyevent, broadcast) | 450-580ms |
| Screenshot | 500-700ms |
| Deep link + chargement page | 5-6s (avec sleep) |
| Flow complet app native | **~21 secondes** |
| Flow complet Chrome | **~25 secondes** |
| Installation APK | ~6s |

---

## Architecture globale

```
Worker Render (intelligence)          Gateway Box (exécution)
────────────────────────              ──────────────────────
GORGONE → filtre → LLM               Reçoit le job Supabase
    ↓                                     ↓
LLM choisit les avatars              Détecte app ou Chrome
    ↓                                     ↓
LLM rédige le commentaire            postReply(dbId, tweetId, text)
    ↓                                     ↓
INSERT campaign_job                   Screenshots source + preuve
  (device, text, tweet_url)               ↓
                                      UPDATE job → done/failed
```

Le LLM rédige. Le gateway exécute. Pas d'intelligence côté exécution.

---

## Évolutions futures

### TikTok
- Probablement nécessitera l'app native + navigation UI
- Le dump `uiautomator` ou le LLM vision pourrait être utile

### Instagram
- Instagram web mobile est très limité (popups constants)
- App native fortement recommandée

### Gestion des erreurs avancée
- Détecter "Unlock more on X" via screenshot ou dump UI
- Fallback LLM vision Aleria pour les états inconnus (gratuit)
