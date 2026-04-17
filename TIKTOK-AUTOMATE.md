# TIKTOK-AUTOMATE — Automation TikTok via ADB sur containers VMOS

> Référence complète pour poster des commentaires TikTok via les containers VMOS Magic Box.
> Validé en live le 15 avril 2026 sur box-1.attila.army (device US1).

---

## Principe

On poste des commentaires sur TikTok **via l'app native** (`com.zhiliaoapp.musically`).
TikTok web mobile ne fonctionne pas pour l'automation (popups RGPD, "Ouvrir l'app", login requis).
L'app native est **obligatoire**.

Le deep link ouvre la vidéo dans l'app. On tape le bouton commentaire,
on saisit le texte via ADBKeyboard, et on poste via le bouton send.

---

## Prérequis par device

| Élément | Détail |
|---------|--------|
| App TikTok | `com.zhiliaoapp.musically` installée |
| Compte TikTok | Connecté dans l'app (login manuel via streaming) |
| ADBKeyboard | Installé et activé (`ime enable`) |
| Proxy | Configuré pour l'IP de sortie |

### Vérification de l'app

```bash
pm list packages | grep musically
# → package:com.zhiliaoapp.musically
```

### Installation ADBKeyboard (une seule fois par device)

**Trois étapes obligatoires**, dans cet ordre (le `pm enable` est requis car
`install_apk_from_url_batch` installe le package en `enabled=0`) :

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

Provisioning de masse : `node scripts/install-adbkeyboard.mjs`. Voir
`ADB-REFERENCE.md` section 2 bis pour le détail.

---

## Différences avec Twitter/X

| Aspect | Twitter/X | TikTok |
|--------|-----------|--------|
| URL compose directe | `x.com/intent/post?in_reply_to={ID}` | **N'existe pas** |
| Navigation | 1 deep link suffit | Deep link + tap comment + tap field |
| Layout | Fixe (page compose) | Variable (vidéo en fond, panneau slide) |
| `uiautomator dump` | Fonctionne | **Échoue pendant lecture vidéo** ("could not get idle state") |
| Bouton send | Position fixe (haut droite) | Position fixe dans le panneau commentaire |
| Complexité | Simple (4 commandes utiles) | Moyenne (6 commandes utiles) |

---

## Contrainte technique : `uiautomator dump` ne fonctionne pas

`uiautomator dump` appelle `waitForIdle()` en interne (hardcodé, pas de flag pour skip).
TikTok joue une vidéo en continu → le thread UI n'est jamais idle → timeout → erreur.

```
ERROR: could not get idle state.
```

**Workaround** : on peut pauser la vidéo (tap centre de l'écran) puis dump. Mais en
production c'est fragile. On utilise donc des **coordonnées calibrées** pour les
boutons TikTok.

### Méthode de calibration : `pointer_location`

Pour trouver les coordonnées exactes des boutons sur un device :

```bash
# Activer l'overlay de coordonnées
settings put system pointer_location 1

# L'opérateur tape les boutons via streaming → les X/Y s'affichent en haut
# Noter les coordonnées de chaque bouton

# Désactiver l'overlay
settings put system pointer_location 0
```

---

## Coordonnées calibrées (résolution 1080×2340, device US1)

Calibrées via `pointer_location` le 15 avril 2026.

| Élément | Coordonnées | Méthode de calibration |
|---------|-------------|----------------------|
| Bouton commentaire (💬) | `input tap 985 1425` | pointer_location |
| Champ "Add comment..." | `input tap 200 2290` | pointer_location |
| Bouton send (↑ rose) | `input tap 970 1515` | pointer_location |
| Pause vidéo | `input tap 540 1170` | centre écran |
| Fermer panneau commentaires | `input keyevent KEYCODE_BACK` | — |

### Stabilité des coordonnées

| Élément | Stable ? | Note |
|---------|----------|------|
| Bouton commentaire (💬) | **Relativement stable** | Position fixe à droite de la vidéo, mais peut varier si la barre du bas change |
| Champ "Add comment..." | **Stable** | Toujours en bas du panneau commentaire |
| Bouton send (↑) | **Stable** | Toujours en bas à droite du champ de commentaire |

**Important** : le bouton commentaire (💬) peut varier légèrement selon la présence
de bandeaux "Not interested/Interested", la longueur de la description, etc.
Si les coordonnées ne marchent pas, recalibrer avec `pointer_location`.

---

## Flow complet — Poster un commentaire TikTok

### Les 4 inputs

| Input | Exemple |
|-------|---------|
| `DB_ID` | `EDGEFXX5W5CEHEZ0` |
| `VIDEO_URL` | `https://www.tiktok.com/@foxandfriends/video/7628192741352017165` |
| `TEXT` | `This blockade is historic, we are watching history unfold` |
| `BOX_HOST` | `box-1.attila.army` |

### Les 13 étapes (consolidé V4.1, 16 avril 2026)

```
ÉTAPE   COMMANDE                                                    DURÉE     NOTE
─────   ────────                                                    ─────     ────
 1      wakeDevice (WAKEUP + MENU + verify, retry swipe)            ~2s
 2      am start -d "{VIDEO_URL}"                                   ~500ms    ouvre dans l'app TikTok
 3      sleep 8                                                     8s        chargement vidéo
 4      GET /screenshots/{DB_ID}                      📸 SOURCE     ~500ms
 5      input tap 985 1425                                          ~500ms    ouvre panneau commentaires
 6      sleep 3                                                     3s        panneau slide up
 7      input tap 200 2290                                          ~500ms    focus champ "Add comment..."
 8      sleep 1.5                                                   1.5s      clavier apparaît
 9      ensureAdbKeyboard (enable + set + verify)                   ~1.5s     active le clavier ADB
10      input tap 200 2290                                          ~500ms    re-focus après switch IME
11      typeText (broadcast + verify)                               ~500ms    saisie du texte
12      input tap 970 1515                                          ~500ms    tap bouton send
13      sleep 5 → GET /screenshots/{DB_ID}            📸 PREUVE     ~6s

TOTAL : ~25 secondes par commentaire
```

### Séquence IME — Point d'attention

TikTok perd le focus du champ quand on switch l'IME. Le flow doit :
1. Tap le champ "Add comment..." → le clavier Gboard apparaît
2. `ensureAdbKeyboard()` : `ime enable` + `ime set` + verify → le clavier change
3. Re-tap le champ → refocus avec ADBKeyboard actif
4. Broadcast le texte

**Ne pas switcher l'IME AVANT de taper le champ.** L'ordre est important.

---

## Deep link TikTok

```
https://www.tiktok.com/@{username}/video/{video_id}
```

Le deep link ouvre directement la vidéo dans l'app TikTok quand l'app est installée.
Android résout automatiquement vers `com.zhiliaoapp.musically`.

Vérification :
```bash
dumpsys window | grep mCurrentFocus
# → com.zhiliaoapp.musically/com.ss.android.ugc.aweme.splash.SplashActivity
```

### Extraction du video_id

```typescript
function extractTikTokVideoId(url: string): string {
  const match = url.match(/video\/(\d+)/);
  if (!match) throw new Error(`Cannot extract video ID from: ${url}`);
  return match[1];
}
```

---

## Saisie de texte — ADBKeyboard

Identique à Twitter. Voir `X-AUTOMATE.md` pour les détails complets.

```bash
# Saisir du texte
am broadcast -a ADB_INPUT_TEXT --es msg "Texte avec accents é et emojis 🔥"

# Activer ADBKeyboard
ime enable com.android.adbkeyboard/.AdbIME
ime set com.android.adbkeyboard/.AdbIME

# Revenir à Gboard
ime set com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME
```

**Note** : sur TikTok, `ime enable` doit être appelé avant chaque `ime set` car
l'app TikTok peut réinitialiser les IME activés entre les sessions.

---

## Vérification du résultat

### Succès

Le commentaire apparaît en haut de la liste des commentaires avec le timestamp "1s ago".
Le compteur de commentaires incrémente (+1).
Le champ "Add comment..." est vidé et prêt pour un nouveau commentaire.

### Échec — cas connus

| Écran | Signification | Action |
|-------|---------------|--------|
| "Add comment..." toujours visible avec texte dedans | Le send n'a pas été tapé | Recalibrer coordonnées send via `pointer_location` |
| Panneau commentaires fermé | Le tap sur 💬 a raté | Recalibrer coordonnées comment via `pointer_location` |
| "Comment failed" | Rate limiting TikTok | Attendre, retry |
| Vidéo différente affichée | TikTok a scrollé automatiquement | Re-deep link vers la vidéo |
| "You're posting comments too fast" | Rate limiting | Marquer `failed`, cooldown |
| Login requis | Session expirée | Intervention manuelle |

---

## Resource IDs TikTok (obfusqués)

Les resource-ids TikTok sont obfusqués (changent à chaque version de l'app).
Ils sont utiles pour référence mais **ne pas les utiliser en production** — utiliser
les coordonnées calibrées à la place.

| Resource ID (v2026-04) | Élément |
|------------------------|---------|
| `com.zhiliaoapp.musically:id/e60` | Bouton commentaire (content-desc: "Read or add comments. N comments") |
| `com.zhiliaoapp.musically:id/gmk` | Container keyboard commentaire |
| `com.zhiliaoapp.musically:id/gms` | Items emoji dans le keyboard |
| `com.zhiliaoapp.musically:id/gnl` | Labels emoji |
| `com.zhiliaoapp.musically:id/ls9` | Container principal commentaires |

Ces IDs **changeront** à la prochaine mise à jour de TikTok.

---

## Test validé (15 avril 2026)

| Device | Compte | Vidéo | Commentaire | Résultat |
|--------|--------|-------|-------------|----------|
| US1 `EDGEFXX5W5CEHEZ0` | @smitholiver22 | @foxandfriends (MARITIME BLOCKADE) | "This blockade is historic, we are watching history unfold" | ✅ Posté (387 comments, 1s ago) |

---

## Latences mesurées

| Opération | Latence |
|-----------|---------|
| Deep link → vidéo chargée | 8s |
| Tap comment → panneau ouvert | 3s |
| Saisie texte (ADBKeyboard) | ~500ms |
| Tap send → commentaire posté | 4s |
| Flow complet (14 étapes) | **~22 secondes** |

---

## Architecture dans le pipeline

```
Worker Render (intelligence)          Gateway Box (exécution)
────────────────────────              ──────────────────────
Détecte vidéo TikTok                  pm list packages | grep musically
    ↓                                     ↓
LLM rédige le commentaire            postTikTokComment(dbId, videoUrl, text)
    ↓                                     ↓
INSERT campaign_job                   14 commandes ADB séquentielles
  (device, text, video_url)               ↓
                                      Screenshots source + preuve
                                          ↓
                                      UPDATE job → done/failed
```
