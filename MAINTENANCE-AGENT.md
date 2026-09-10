# Maintenance des avatars — étude et tests du 9 septembre 2026

> Ce document consigne l'étude « opérateur IA » (maintenance automatisée des
> avatars, de leurs devices et de leurs comptes), les tests réels qui l'ont
> étayée, les décisions prises et ce qui reste ouvert. **Rien de ce qui est
> décrit ici n'est implémenté** : c'est l'état des lieux qui précède le
> chantier. Les chiffres sont ceux mesurés le 9 septembre 2026 ; ils périment.
>
> Lire avant : `AGENTS.md`, `AUTOMATION-PIPELINE.md`, `X-AUTOMATE.md`,
> `TIKTOK-AUTOMATE.md`, `VMOS-API-V2-EVALUATION.md`, `infra/boxes/MAINTENANCE.md`.
> Le protocole comportemental de référence est le PDF opérateur
> `Attila_Tutoriel_Avatar_Device.pdf` (hors repo).

---

## 1. Le problème, mesuré

Source : Supabase Attila V4, requêtes en lecture seule.

| Mesure | Valeur |
|---|---|
| Avatars non archivés | 159, tous créés depuis plus de 60 jours |
| Avatars avec un compte X **et** TikTok renseignés | 57 · X seul 24 · TikTok seul 22 · aucun compte 53 |
| Identifiants complets (handle + e-mail + mot de passe) | X 67 sur 103 activés · TikTok 76 sur 93 |
| Avatars sans session (opérateur ou automator) depuis plus de 7 jours | 121 sur 159 (75 jamais depuis la création de `avatar_usage_sessions` le 31/08) |
| Dernier job de campagne | 14 juillet 2026, X et TikTok — 0 job sur 30 jours |
| Sessions opérateur par jour (14 derniers jours) | 64, **231**, 5, 1, 9, 2, 0, 12, 19, 1 — un burst puis rien |
| Blocs actifs `avatar_platform_blocks` | 24 (7 `logged_out` TikTok, 12 `notfound`, 3 `suspended` X, 1 shadow-ban, 1 `blocked`) |
| Jobs historiques | 1 250, dont 580 échecs ; 74 % des échecs sont device ou infrastructure (`app_not_ready` 161, `infrastructure` 105, `network_unavailable` 91, `device_setup_required` 68), 2 % sont des comptes déconnectés |
| Devices exploitables (ADBKeyboard + une app sociale) | 150 sur 452 |
| Devices dont le fuseau n'a jamais été synchronisé | 107 avatars concernés (repli obligatoire sur `avatars.country_code` : US 47, GB 30, FR 29, AE 27, ES 19, DE 7) |

Le parc est exactement dans le pattern « dormance puis burst » que le protocole
désigne comme le pire. Les comptes ne vivent qu'au moment d'une campagne, et
il n'y a plus eu de campagne depuis deux mois.

### Santé hors device de toute la flotte (TikHub, 179 sondes)

Le worker `Account-Health` ne sonde que les avatars des campagnes **actives** ;
aucune campagne n'étant active, `avatar_platform_health` est périmée. Un
recensement complet donne :

| Plateforme | Sondés | Actifs | Suspendus | Introuvables / handle invalide |
|---|---:|---:|---:|---|
| X | 86 | 73 | **7** (Trevor Holloway, Harriet Walton, Miguel Santos, Jamal Ortiz, Andre Nguyen, Salem Al Shamsi, Latifa Al Mazrouei) | 6 (dont le handle `test`) |
| TikTok | 93 | 86 | 0 | 7 handles invalides en base (`camiro/camiro74`, `o'connethan`, …) |

Graphe social : X, médiane 33 abonnements et 10 posts, 10 comptes sans aucun
post. TikTok, **80 comptes sur 86 n'ont aucun abonnement, 83 aucune vidéo,
75 aucun abonné**. La « clusterisation » demandée par le protocole n'a jamais
commencé sur TikTok.

---

## 2. Ce qui a été testé, et ce que ça a donné

Tous les tests ont été faits via le tunnel Cloudflare depuis un poste de
travail (pas depuis Render), en démarrant un seul device à la fois par box,
jamais sur box-1 pendant qu'un opérateur y était en session, et en arrêtant
chaque conteneur à la fin. Aucun code du repo n'a été modifié pour tester.

### 2.1 Les flux de campagne de production, exécutés tels quels

**TikTok — `postTikTokComment` (US13 `EDGEMK9EWI0B3EAJ`, TikTok 44.8.3, vidéo @nba).**
Échec correct en 99 s, `ui_unexpected`, aucun commentaire posté (vérifié
TikHub). Cause : le tap « ouvrir les commentaires » (540, 2262) a touché le
bouton **Créer** de la barre du bas ; la caméra s'est ouverte, le texte a été
tapé dans le vide, le tap d'envoi (970, 1515) a atterri sur l'écran de
capture. Trois `uiautomator dump` à **12 s chacun** avant la composition. La
vérification par signal positif a tenu ; les coordonnées codées en dur ont
cédé.

**X — `postReply` (US24 `EDGE5R3QHJ8G7MUS`, X 11.97.0, tweet @nba).**
Verdict **SUCCESS** en 37,8 s parce que le focus est revenu sur
`TweetDetailActivity`. Faux succès : la capture « preuve » montre « Cannot
retrieve posts at this time », le tweet n'a jamais chargé, le texte est parti
dans le vide, TikHub confirme zéro reply. Le marqueur `network_unavailable`
existe dans `x-reply.ts`, mais ce flux n'a exécuté aucun dump. Trois minutes
plus tard, X a renvoyé le compte vers `BouncerWebViewActivity` (page Cloudflare
« Performing security verification » qui ne se termine pas). TikHub donne
ensuite le compte comme **suspendu** ; son état avant le test est inconnu (jamais
sondé). « Cannot retrieve posts » est l'écran d'un compte déjà restreint.

### 2.2 Le futur moteur, rejoué à la main : sélecteurs v2 + ADBKeyboard + signal positif

Deux publications réelles, réussies et vérifiées, avec les primitives cibles.

**TikTok (US13).** Deep link → `dump_compact` (52 commentaires) → clic
« Read or add comments » par `xpath contains(@content-desc, …)` → clic du champ
par `resource_id com.zhiliaoapp.musically:id/e02` → ADBKeyboard → texte →
**un `dump_compact` pendant la saisie ne referme pas le composer** (le
composer reste ouvert avec le texte, contrairement à `uiautomator dump`) →
clic du bouton d'envoi par `resource_id …:id/cj9` (son `content-desc` est une
référence non résolue « @2131953937 », inutilisable) → arbre : notre texte est
un `TextView` (`…:id/eim`), le champ est vide, compteur 52 → 53. TikHub voit
le commentaire deux minutes plus tard.

**X (FR32 `EDGE6QPUQ7MYT33R`, X 12.21.1, UI FR, tweet @lequipe).** Sonde TikHub
avant d'agir (compte actif) → deep link → arbre : détail chargé, composer
inline « Postez votre réponse » → clic du champ par
`xpath //*[@resource-id="post-detail-reply-text-field"]` (l'id X n'a pas de
préfixe de paquet, le sélecteur `resource_id` le rate) → ADBKeyboard → le
texte est visible dans l'`EditText` focalisé → clic `//*[@text="Répondre"]`
(le bouton ; l'icône de réponse du tweet porte le même mot en `content-desc`)
→ arbre : notre reply est un `TextView` signé « Kylian Moretti · 1s », le
champ est vide. TikHub la retrouve **39 s** plus tard. C'est le signal positif
qui manque au flux actuel.

### 2.3 Sonde en lecture seule de 30 devices (box-2, box-3, box-4)

Boot 9 à 17 s en série ; 44 à 89 s par device tout compris (démarrage,
version, paquets, notifications, comptes Google, IP de sortie, ouverture de
TikTok puis X avec dump et capture, arrêt).

**X** — versions ≤ 12.5 sur 22 devices sur 29 (12.20+ sur 7, presque tous sur
box-3) ; mur « This app is out of date » (EN, ES) ou feuille Google Play
« Mise à jour disponible » sur 9 des 16 écrans lisibles de la sonde ; les
12.20+ affichent le feed. La mise à jour reste
manuelle (décision) ; la **détection** est à la charge de la maintenance.

**TikTok** — 10 feeds connectés, 1 déconnecté (sélecteur de compte « Welcome
back »), 1 consentement pubs (FR), 1 dialogue « Link email », 1 dialogue
« Give TikTok access to your Facebook friends list », 3 dumps vides alors que
le feed était à l'écran (instant de chargement ou notification heads-up ; 0
dump vide sur 10 lorsqu'on relit un feed stable).

**Cohérence des personas** — 3 devices FR de box-3 sur 6 sortaient par des IP
américaines, et le même device est sorti de Bastia puis de Londres entre deux
démarrages ; les 3 avatars émiratis sondés sur box-4 vivent sur des devices
US (fuseau New York, IP Connecticut ou Massachusetts) ; un avatar GB/ES reçoit
des notifications X en arabe (son cluster a été façonné par les campagnes
Golfe, pas par sa persona). Sur box-2 et box-4, les proxies NodeMaven sont de
type `mobile` avec un paramètre pays cohérent avec le device.

### 2.4 Taxonomie des 13 états d'écran observés

| État | Marqueur observé | Action sûre |
|---|---|---|
| Feed connecté | For You / Following / Inbox / Profile (EN, FR, ES) ; « Like video. N likes » | session |
| Déconnecté, sélecteur de compte | « Welcome back », handle, « Log in », « Add another account » | relogin ou escalade |
| Consentement pubs (FR) | « Choisir comment afficher les publicités » | choisir « Pubs génériques » |
| Permission Facebook | « Give TikTok access to your Facebook friends list » | « Don’t allow » |
| Lier un e-mail | « Link email » · OK / Not now | « Not now » |
| X mur de version | « This app is out of date » / « Esta app está desactualizada » | item `app_outdated`, aucun job |
| X feuille Play Store | `com.android.vending` « Mise à jour disponible » | fermer ou mettre à jour |
| X état de paiement | « Failed to load payment state » · Close | Close |
| X contenu indisponible | « Cannot retrieve posts at this time » | `network_unavailable`, aucun job, sonde TikHub |
| X bouncer / challenge | `BouncerWebViewActivity`, « Performing security verification » | escalade opérateur |
| X chargement lent | écran noir, spinner, « Fermer » après 9 s | attendre, relire |
| Dump vide | arbre à 0 octet alors que le feed est à l'écran | relire après 1 s, sinon capture + vision |
| Agent v2 injoignable | `dial tcp 172.17.0.x:18185: no route to host` | repli shell v1 + `curl 127.0.0.1:18185` |

### 2.5 Faits mesurés sur l'API v2 et l'hôte

- **Sélecteurs `accessibility/node`** : `text` et `content_desc` sont des
  égalités strictes, sensibles à la casse et à l'apostrophe typographique ;
  `xpath` avec `contains()` et `@resource-id` fonctionne ; `class_name` filtre
  mal (71 nœuds renvoyés pour `android.widget.EditText`) ; `resource_id` exige
  la forme `paquet:id/nom` ; un élément absent coûte tout le `wait_timeout`
  (3,7 s via tunnel pour 3 000 ms).
- **Latences via tunnel depuis le bureau** : 0,5 à 1,0 s par appel (TLS
  0,25 s) ; `dump_compact` 0,5 à 1,2 s ; clic par sélecteur 1,1 s (90 ms sur
  le device) ; `scroll_bezier` 1,5 s (515 ms sur le device) ; capture JPEG
  1,3 s. La latence depuis Render n'a pas pu être mesurée (clé SSH non
  enregistrée sur Render).
- **Disponibilité de v2 après `run`** : parfois à la première sonde, parfois
  après 16 s, parfois jamais pendant plusieurs minutes — l'hôte route encore
  vers l'ancienne IP Docker du conteneur (`no route to host` vers 172.17.0.2
  alors que l'invité est en .3). Le repli `curl http://127.0.0.1:18185/api/…`
  via le shell v1 fonctionne ; `dump_compact` gzippé en base64 tient en 2,5 KB.
- **`POST /workflow` (actions en ligne)** : 404 sur les agents 1.1.1 et
  1.1.3 ; `workflow/execute` exige un script nommé et `script_list` est vide.
  Pas de batching d'appels disponible.
- **MCP par device** (`/android_api/v2/{db_id}/mcp/sse`) : serveur
  `vmos-edge-control-api 1.1.1`, protocole MCP 2024-11-05 (SSE historique),
  20 outils dont `input_text` et `system_shell`, sans `accessibility_node`.
  **MCP box** (`/mcp/sse`) : transport propriétaire « mcp-sse 1.0 », 65
  outils. Les deux sont des outils de développement, jamais de production.
- **Agent IA embarqué** (`ai_agent/config_get`) : provider `dashscope`,
  modèle et base_url vides — non configuré.
- **Contention sur box-3 (16 GB)** : 6 démarrages simultanés → prêts en 35 à
  82 s (10 à 17 s en série) ; 4 de plus → 69 à 89 s ; CPU 100 %, RAM
  12,1 / 15,9 GB à 10 conteneurs. **L'API accepte un 11ᵉ `run`** (état
  `starting`, refusé au `stop` jusqu'à ce qu'il passe `running`) : le plafond
  de 10 et les démarrages en série sont entièrement notre responsabilité.
- **Aleria** : `aleria-vl` fait du tool calling (réponse en 0,5 s avec un
  appel d'outil) et classe correctement un écran depuis une capture en 4 à
  10 s pour 0,16 à 0,28 centime ; le modèle texte `aleria` expire (90 et 150 s)
  dès qu'on lui passe des outils. `aleria-vl` normalise « Don’t » en « Don't » :
  ne jamais sélectionner un nœud par égalité de texte à partir d'une sortie du
  modèle.
- **Agent borné (prototype de la couche B)** : face au dialogue « Link email »,
  `aleria-vl` avec une liste blanche d'outils (`observe`, `click_node`,
  `press_back`, `finish`) a cliqué « Not now », observé, conclu — 3 pas,
  10,5 s ; un vérificateur indépendant a confirmé le feed ; l'outil aurait
  refusé « OK ».
- **Délai d'indexation TikHub** : commentaire TikTok visible à ≈ 2 min ;
  reply X visible à 39 s.

### 2.6 Campagne 0-A (9 septembre, soir) — ce que le plan a dû changer

Quatre sessions en lecture/écriture contrôlée sur box-2 (agent 1.1.1) et
box-5 (agent 1.1.3), plus un recensement hors ligne des versions sur 154
conteneurs arrêtés (décodeur ABX de `packages.xml`). Tout conteneur démarré a
été arrêté derrière nous.

- **Le contrat du moteur tient sur deux versions et deux langues.** Like et
  follow par sélecteur `content-desc` avec signal positif (`Like`→`Liked`,
  `Follow`→`Following`) sur TikTok 44.8.3 EN (box-2) et 44.9.3 ES (box-2) ;
  flux commentaire complet par sélecteurs — deep link, identité de la cible
  vérifiée, panneau, saisie ADBKeyboard, envoi — avec relecture positive sur le
  device en < 3 s et indexation TikHub à 3 min. Les ids de ressource des
  composants du composer changent d'une version à l'autre : d'où la table
  `app_ui_selectors` versionnée et des dictionnaires de `content-desc` par
  locale (EN/FR/ES/DE/AR).
- **Un deep link peut retomber sur le feed** (vidéo indisponible, compte
  privé) : l'auteur affiché est comparé à celui de l'URL avant tout
  commentaire, sinon `target_mismatch`.
- **L'arbre est périmé sur la ligne 1.1.3** après tout changement dans la
  fenêtre (défilement, saisie, like) : le service d'accessibilité de l'agent
  n'écoute que `TYPE_WINDOW_STATE_CHANGED`. Deux « kicks » fiables et bon
  marché : la barre de statut (`cmd statusbar expand-notifications` puis
  `collapse`, 0,58 s, 2/2, sans effet visible) et `keyevent [24,25]` (0,37 s,
  mais overlay de volume et dérive possible). `uiautomator dump` fonctionne
  (3/3) mais coûte 2,65 s et referme le composer TikTok. Le lecteur applique la
  barre de statut d'abord, `uiautomator dump` en secours, jamais quand un
  composer contient du texte (vérification par transition de fenêtre).
- **`aleria-vl` classe un écran en ≈ 6 s** à condition de laisser ≥ 1 200
  tokens de sortie (coupure JSON à 600) ; l'analyse d'image reste un repli,
  jamais le chemin nominal.
- **Trois états d'écran ajoutés** à la taxonomie : `target_mismatch`,
  `version_wall` (X ≤ 12.5 : « This app is out of date »), `empty_tree`
  (lancement, heads-up). `set_hidden` retiré du plan (sans effet mesurable).
- **Après `stop`, attendre ≥ 4 s avant `run`** (le conteneur répond encore
  `running` pendant ~3 s) ; concurrence de démarrage bornée à deux par box.
- **Recensement des versions** : X ≤ 12.5 sur la majorité des images (mur),
  12.20+ sur box-3 ; ADBKeyboard présent partout où il a été vérifié.

Résidu exécuté le soir même par le chemin de production (`scripts/maintenance-task.ts`,
file `maintenance_tasks` → `claim_maintenance_task` → session device → recette) :

- **box-3, FR35, X 12.21.1** : sonde en 27,6 s, `feed_ok` (« pour vous »),
  jumeau écrit `logged_in`. Le classifieur lit X 12.20+ ; la relecture
  positive d'une *réponse* sur cette version attend le premier job de
  campagne réel (aucun tweet de test posté depuis un compte client).
- **box-4, Alya Al Ameri, TikTok 45.0.3, agent 1.1.3, image 20260511** :
  session passive d'une minute, 3 défilements, `refreshed_reads = 2`,
  `stale_reads = 0` — l'arbre périmé se reproduit sur box-4 comme sur box-5
  et le kick de la barre de statut le rattrape à chaque fois. Dans la flotte,
  l'agent 1.1.3 n'existe que sur l'image 20260511 et l'agent 1.1.1 que sur
  l'image 20260417 : la question « agent ou image ? » n'est pas séparable par
  observation ; la garde de fraîcheur est indexée sur la ligne d'agent, ce qui
  suffit opérationnellement.
- **box-4, Tarek Mansour (US56), TikTok 45.2.3** : la sonde a trouvé l'écran
  « welcome back » — `logged_out`, preuve, bloc `avatar_platform_blocks`
  (`logged_out`, `on_device`) et item d'attention `needs_login` critique
  reliés : l'escalade réelle fonctionne de bout en bout.
- **box-2, ES14, TikTok 44.8.3 ES** : sonde en 28 s, sessions passives de 1
  et 2 min (3 et 5 défilements, `feed_ok` en continu), ligne `session` dans
  `avatar_actions`, conteneur arrêté après chaque tâche. Trois défauts
  corrigés à cette occasion : `launcher_activity` non-chaîne sur certains
  agents, IME restaurée à tort (Gboard non sélectionnable), index
  d'idempotence du registre partiel que PostgREST ne pouvait pas nommer
  (toutes les écritures `avatar_actions`, Automator compris, échouaient —
  migration `20260909210000`).

---

## 3. Décisions prises

1. **Un seul moteur** pour l'Automator et l'opérateur IA : mêmes primitives,
   même arbitrage des slots, même compteur d'actions par avatar et par jour
   (l'Automator y écrit, l'opérateur IA le lit et s'efface). La fusion se fait
   en trois temps : budget commun, signaux de préparation partagés
   (`ready_for_jobs`, `on_device_status` lus par le sélecteur), puis — en
   dernier et sous condition de résultats — les campagnes comme source de
   missions pour l'agent avatar.
2. **Le chantier commence par la fondation commune**, pas par la maintenance :
   lecture par `dump_compact` v2 avec repli, actions par sélecteur au lieu de
   coordonnées, sonde d'état d'écran avant d'agir, vérification par signal
   positif sur X comme sur TikTok. Les flux de campagne sont le premier
   consommateur parce qu'ils sont cassés aujourd'hui.
3. **Humain / IA** : provisionner box et devices, créer les comptes, trancher
   un `suspended`, régénérer fingerprint + proxy, tout challenge illisible par
   la machine (SMS, captcha, identité) restent humains. L'agent d'un avatar
   s'active par un interrupteur ; sans compte ou sans identifiants, il s'arrête
   et ouvre un item d'attention.
4. **File d'attention unique** à trois portées (avatar × plateforme, device,
   box) en généralisant `avatar_platform_blocks` ; « marquer fait » déclenche
   une re-sonde, l'item se rouvre si l'écran est inchangé.
5. **Brief** : army = objectif de cluster (texte court compilé une fois par le
   LLM en objet structuré, versionné), avatar = persona jamais écrasée ; une
   contradiction est affichée et tranchée par un humain ; le brief effectif est
   visible dans les clients. Le brief décrit une personne, jamais une mission.
6. **Limites** : `capacity_params` restent propres aux campagnes ; les plafonds
   du PDF s'appliquent à l'opérateur IA ; la seule limite d'infrastructure
   partagée est 10 conteneurs par box, à faire respecter par nous.
7. **Reprise après dormance** : une session tous les deux jours, puis une par
   jour, puis plusieurs ; horaires et durées tirés dans des fourchettes
   humaines, jamais la même heure deux jours de suite.
8. **Mise à jour des APK** : manuelle (zip distribué). L'opérateur IA détecte
   seulement (version, mur, feuille Play Store).
9. **Périmètre v1** : TikTok et X.
10. **Garde-fous portés par les outils**, pas par le prompt : l'outil `like`
    refuse au-delà du quota, l'outil `login` refuse une deuxième tentative
    dans les 24 h, la saisie dans une app sociale passe uniquement par
    ADBKeyboard, un captcha n'est jamais résolu, chaque outil écrit sa preuve.

---

## 4. Architecture cible (résumé)

Cinq couches, une seule nouvelle en profondeur :

1. **Vérité et budgets — Supabase** : brief (army → surcharges avatar), état du
   jumeau (phase, type de profil, compteurs du jour), file `maintenance_tasks`
   (claim `FOR UPDATE SKIP LOCKED`), file d'attention, taxonomie d'écrans,
   `on_device_status` / `ready_for_jobs`.
2. **Le « quoi » — planificateur pur + LLM borné** : le planificateur traduit le
   protocole en tâches datées (heures locales du proxy ou du `country_code`,
   jitter, jours off, désynchronisation entre avatars d'une même army ou box) ;
   `aleria` choisit (quoi liker, qui suivre parmi des candidats, rédiger une
   reply organique) ; `aleria-vl` classe un écran inconnu. Jamais un geste,
   jamais un quota.
3. **Le « comment » — boucle `Maintain` dans `server.mjs`** : même modèle de
   claim et de reprise que `execute`, même gate de slots
   (`max_concurrent_containers − operator_reserve`, refus si un stream est
   ouvert), démarrages en série, recettes `probe`, `warmup_device`,
   `social_session`, `relogin`, `app_check`. Déplaçable vers un Background
   Worker Render, puis vers un runner sur la box si la latence l'impose.
4. **Les gestes — VMOS via Cloudflare** : v2 pour lire (`dump_compact`), agir
   (`accessibility/node` par xpath, `scroll_bezier`), v1 pour le cycle de vie
   et le repli in-guest ; ADBKeyboard seul chemin de saisie.
5. **Capteurs et cockpit** : TikHub (santé de **tous** les comptes, candidats),
   `notification/list`, Email Worker Cloudflare (codes), Gorgone (thèmes de
   zone, communautés, scorer bot-detection en auto-audit). Web et macOS
   restent des cockpits ; une façade MCP côté serveur (intentions, JWT client,
   spec 2026-07-28) est envisagée plus tard.

Résilience : recettes à postconditions (80 à 90 % des sessions), agent de
rattrapage borné sur `aleria-vl` (≤ 12–15 pas, liste blanche, succès décidé
par un vérificateur), journal de pas en Postgres pour reprendre après un
redéploiement. Ce qui est réessayé : les obstacles d'interface. Ce qui ne
l'est jamais : les obstacles de sécurité du compte.

Ce qui a été écarté, et pourquoi : MCP dans l'app macOS et agents Cursor comme
runtime (Mac d'un opérateur, sandbox, secrets, aucune planification — banc
d'essai seulement), agent IA embarqué VMOS (non configuré, boîte noire,
`input/text`), frameworks GUI-agent (APK de service d'accessibilité à
installer alors que VMOS fournit le sien), Cloudflare Agents / Durable Objects
(seulement si la mémoire par agent et l'e-mail intégré justifient un second
runtime), LangGraph / Temporal (durabilité de bibliothèque, inutile en v1).

---

## 5. Feuille de route proposée

| Phase | Contenu | KPI |
|---|---|---|
| 0 · Fondation et remise à niveau des flux (2 à 3 sem.) | audit APK par device (versions en colonnes), `probeAccount()` sur la taxonomie ci-dessus, file d'attention à trois portées, audit de cohérence `country_code` ↔ fuseau ↔ IP de sortie, read-path v2 avec sonde post-démarrage et repli in-guest, actions par sélecteur dans les flux X et TikTok, vérification X par signal positif, sonde TikHub avant tout job | zéro faux `done` sur X ; TikTok commente sur 44.8.x ; détection d'un `logged_out`, d'un bouncer ou d'une app obsolète en moins de 24 h |
| 1 · Maintainer v1 (2 à 3 sem.) | brief, planificateur, boucle `Maintain`, recettes `warmup_device` et `social_session` (Passive), budget commun, `actor_type = maintainer` | pilote 10 avatars contre 10 manuels sur 30 jours : ≥ 3 sessions / avatar / semaine sans opérateur, blocs / 100 sessions, survie J30 ≥ 90 % |
| 2 · Réparation et codes (2 à 3 sem.) | relogin déterministe, Email Worker Cloudflare → `verification_codes`, boucle vision bornée, `needs_operator` avec preuve, « prendre la main » dans les clients | ≥ 60 % des `logged_out` résolus sans opérateur en moins de 24 h |
| 3 · Clusterisation et jumeau (3 à 4 sem.) | candidats via communautés Gorgone + TikHub, `topics_expertise` alimentés, mémoire du jumeau, auto-audit bot-detection, rapport hebdo | 100 % des comptes TikTok avec un graphe social non nul (80 sur 86 à zéro aujourd'hui) |
| 4 · Latence et échelle (optionnel) | mesure depuis Render ; runner sur la box ou Durable Objects seulement si les mesures l'imposent | temps de session, gestes / heure / box |

Paliers de déploiement : observation seule → supervisé (chaque session visible
et annulable, cohorte pilote) → autonome, avec un critère de passage explicite.

### 5.1 Pilote de la phase 1 — protocole

Prérequis : déployer `main` sur Render (les workers Schedule et Maintain
démarrent avec `server.mjs` et répondent `idle` tant que
`maintenance.global_enabled` est faux).

**Interrupteurs** (admin, SQL sur `runtime_settings`) :

```sql
update runtime_settings set value = 'true'::jsonb where key = 'maintenance.global_enabled';
update runtime_settings set value = '"observe"'::jsonb where key = 'maintenance.mode';     -- puis "supervised"
update avatars set maintenance_enabled = true, maintenance_profile = 'mature' where id in (…10 avatars…);
```

**Cohorte** : 10 avatars TikTok maintenus (box-2 et box-4, deux locales,
deux lignes d'agent) contre 10 témoins comparables laissés à la main.

**Paliers** :
1. *Observation* (7 jours) — mode `observe` : le planificateur remplit
   `maintenance_tasks`, les sondes, `app_check` et `coherence` s'exécutent,
   les sessions sont marquées `skipped / observe_mode`. On lit : la file
   d'attention se remplit-elle de vrais problèmes ? les sondes lisent-elles
   juste (comparer `avatar_platform_state` à un contrôle manuel sur 10 devices) ?
2. *Supervisé* (jusqu'à J30) — mode `supervised` : les sessions passives
   tournent sur la cohorte ; chaque session est visible (onglet Maintenance,
   journal de pas, preuves) et annulable.

**KPI hebdomadaires** (requêtes de référence) :

```sql
-- sessions par avatar et par semaine
select avatar_id, count(*) from avatar_actions where actor = 'maintainer' and action = 'session'
  and occurred_at > now() - interval '7 days' group by avatar_id;
-- issues des tâches
select kind, status, outcome, count(*) from maintenance_tasks
  where created_at > now() - interval '7 days' group by 1, 2, 3 order by 4 desc;
-- fraîcheur de l'arbre (ligne 1.1.3)
select result->>'agent_line' as agent, sum((result->>'refreshed_reads')::int) as refreshed,
       sum((result->>'stale_reads')::int) as stale, sum((result->>'scrolls')::int) as scrolls
  from maintenance_tasks where kind = 'social_session' and status = 'done' group by 1;
-- escalades
select reason, severity, count(*) from attention_items where opened_at > now() - interval '7 days' group by 1, 2;
-- blocs ouverts par 100 sessions (cohorte vs témoins)
select a.maintenance_enabled, count(distinct b.id) as blocks
  from avatar_platform_blocks b join avatars a on a.id = b.avatar_id
  where b.first_detected_at > now() - interval '7 days' group by 1;
```

Cibles (§5) : ≥ 3 sessions / avatar / semaine sans opérateur ; blocs / 100
sessions ≤ témoins ; survie J30 ≥ 90 % ; zéro `dialog_unknown` non traité de
plus de 48 h ; `stale_reads` = 0.

**Journal du pilote** : 9/09 22h47 (Paris) — `main` déployé sur Render
(workers Schedule et Maintain démarrés) ; `maintenance.global_enabled = true`,
mode `observe`, cohorte = ES14 (Yassine Benomar, box-2) ; première sonde
exécutée par le worker Render en 17 s (`logged_in`, conteneur arrêté après).
Le planificateur remplit la journée d'ES14 à partir de 8 h locales.

10/09 16h30 — **première nuit relue** (logs Render, `maintenance_tasks`,
`attention_items`). Ce qui a marché : la journée a été planifiée à minuit
locale (00h24 Madrid) pour les deux plateformes d'ES14, puis pour Lina Haddad
(box-1, agent 1.0.8, activée depuis l'onglet Maintenance) ; 6 sondes
`logged_in`, 3 `coherence` justes (Madrid / New York), 4 sessions `skipped /
observe_mode` à l'heure prévue, aucun conteneur laissé `running`, aucune erreur
serveur ; la coupure des tunnels de 11h27 (502 sur box-1/2/3/5) a été absorbée
par Reconcile. Trois défauts corrigés dans la journée (commit `224288d`,
migration `20260910142443`) :
1. les deux workers Maintain ont réclamé sonde, `app_check` et `coherence` du
   même device à deux secondes d'intervalle — la réclamation exclut désormais
   tout device qui porte déjà une tâche `running` ;
2. la route hôte → agent v2 de box-1 a répondu « no route to host » et la sonde
   a lu ce silence comme « X non installé » (fausse alerte `app_missing`) —
   `readPackages()` interroge l'agent v2 puis le shell invité (`dumpsys
   package`) et n'affirme « absent » que sur une réponse ; un device muet fait
   échouer le pas ;
3. un avatar à deux plateformes recevait `app_check` et `coherence` deux fois
   par jour — les contrôles device sont planifiés une fois par avatar ; et
   `app_check` ne juge plus le mur X sur le seul numéro de build : X 11.86 a
   ouvert son fil sur box-2 ce matin alors que le recensement le disait muré.
   La sonde, qui voit l'écran, ouvre et résout `app_outdated`.
Les deux fausses alertes ont été résolues par `system` (audit_log). La file
porte par ailleurs 21 alertes de santé de flotte (15 `account_missing`, 6
`suspended_decision`, source TikHub) et le `needs_login` réel de US56 : à
trier par un humain.

10/09 17h40 — **cohorte élargie à box-1** (commit `64eea6e`). Le repli shell de
`readPackages()` échouait encore sur box-1 : `dumpsys package X | grep -m2`
fermait le tube après deux lignes, `dumpsys` mourait en « Broken pipe » et le
shell invité rendait un échec (code 201) alors que les deux lignes étaient là ;
`grep` lit désormais jusqu'à la fin et une sentinelle distingue « aucun
résultat » (paquet absent) de « le shell n'a pas répondu ». Mesure sur DE3
(Felix Hoffmann, box-1, agent **1.0.8**, image 20260307) par le chemin de
production : sonde TikTok 44.8.3 `feed_ok` (« für dich ») en 37 s, sonde X
11.96.0 `feed_ok` en 29 s, route v2 joignable — la ligne 1.0.8 lit l'arbre
correctement ; le `unreadable` d'X sur US36 est un cas device, pas un cas
d'agent. Sur demande de l'opérateur, `maintenance_enabled` passe à vrai (profil
`mature`, J0 inchangé, mode toujours `observe`) pour les 11 avatars restants de
l'armée **« army user » du compte Argus** — 12 avatars, tous sur box-1, 7 TikTok
+ 12 X (19 comptes) ; changement tracé dans `audit_log` (`maintenance.enable`, acteur
`system`). Cohorte au 10/09 : 13 avatars (ES14 sur box-2, 12 sur box-1).

10/09 18h10 — **premier tick planifié pour la cohorte** (18h07) : 57 tâches
posées dans la journée locale de chaque persona (les US entre 19h41 et 22h11
New York), un device à la fois. Premiers résultats : ES2, GB2 sondes
`logged_in` (« leer o añadir comentarios », « for you »), `coherence` justes
(Madrid, Londres, New York, proxy on), `app_check` ok par la route v2. Un faux
`unknown` : sur US43, une notification heads-up d'X (« REPLY REPOST LIKE »,
paquet `com.android.systemui`) flottait sur le splash TikTok 4 s après le
lancement ; ses nœuds ont fait passer un arbre de chargement au-dessus du seuil
`loading` et la sonde a ouvert `dialog_unknown` (preuve `03-settle.jpg`).
Corrigé : le classifieur ignore les fenêtres System UI quand l'app a des nœuds
(test sur l'arbre mesuré), et `settleApp` borne le chargement par le temps
(45 s — TikTok 44.6 a mis 23 s sur ES2, l'ancien plafond de 8 tours en valait
22) plutôt que par le nombre de tours, les fermetures de dialogues par le
nombre (8), et n'accepte `unknown` qu'après deux lectures d'accord. L'alerte a
été résolue par `system` (audit_log). Vérification à 18h25, correctif déployé
(`4adf7a8`) : sonde TikTok US43 `logged_in` (« like video », settle 10 s) et
sonde X US36 `logged_in` (« for you », settle 2,5 s) — le `unreadable` de la
nuit sur US36 était un chargement à froid, pas un défaut de l'agent 1.0.8. À
18h30 : 9 jumeaux `logged_in`, 0 alerte ouverte par le mainteneur, aucun
conteneur `running` hors tâche, sessions `skipped / observe_mode` à l'heure.

10/09 19h20 — **idempotence des sessions**. Le tick de redémarrage de 18h22 a
posé une deuxième session à une minute de celle de 18h07 (ES10 18h45/18h46,
FR19 18h48/18h49, DE3 22h38/22h39…) : le planificateur ne recevait que le
NOMBRE de sessions déjà au programme et supposait qu'elles occupaient les
premières tranches de la journée. Il reçoit désormais leurs heures : la tranche
qu'elles occupent est prise, où qu'elle soit, et l'écart de 150 min se mesure
aussi contre elles (test de régression sur le cas ES10). Les 4 doublons encore
`scheduled` ont été annulés par `system` (audit_log) ; les autres avaient déjà
été `skipped` sans geste. Sondes de la soirée : FR19 X, ES10 TikTok (settle
45 s — budget de chargement porté à 60 s), US47 TikTok `logged_in` ; ES10 et
US47 `coherence` justes, `app_check` ok.

10/09 20h05 — **bilan de la première soirée de la cohorte box-1** (depuis
17h36) : 16 sondes `logged_in` + 1 faux `unknown` corrigé, 8 `app_check` ok,
8 `coherence` justes, 19 sessions `skipped / observe_mode` à l'heure prévue,
4 doublons annulés ; 18 jumeaux `logged_in` sur 18 sondés (DE3, ES2, ES10,
ES14, FR8, FR19, GB2, GB4, US36, US43, US44, US47), aucun conteneur laissé
`running`, aucune erreur serveur (journaux Render `error` vides), une seule
alerte ouverte par le mainteneur (le `needs_login` réel de US56). Le tick de
redémarrage après `67e95be` n'a posé qu'une session légitime (US47 X, tranche
du matin libérée par l'annulation d'un doublon). Restent ce soir : FR19 TikTok
(21h52), US41 X (02h51) et US47 X (03h57), puis la planification de demain à
minuit locale.

**Critères d'arrêt immédiat** (retour à `observe`) : un compte de la cohorte
suspendu ou verrouillé sans cause externe identifiée ; plus de 2 tâches
`failed / unknown` sur 24 h ; un conteneur laissé `running` sans tâche pendant
plus d'une heure ; une preuve montrant un geste hors du feed.

**État au 9 septembre 2026, 21 h — phase 0 livrée** : `src/lib/box-api/` par
souci, moteur `src/lib/engine/` (lecteur avec garde de fraîcheur, sélecteurs
versionnés, classifieur, acteur, vérificateur), flux TikTok et X réécrits
dessus, arbitre de slots live dans `execute`, worker Reconcile, worker santé
étendu à toute la flotte, migration `20260909163649` (`attention_items` + vue,
`avatar_actions` + backfill, `device_app_versions`, `app_ui_selectors`,
`audit_log`, `runtime_settings`, bucket `maintenance-proofs`), audit hors
ligne des versions (`scripts/audit-app-versions.mjs`), file d'attention dans
les deux cockpits (web : panneau du roster ; macOS : module de desk) avec le
vocabulaire partagé `src/lib/presentation/attention.ts` ↔
`AttentionPresentation.swift`, et les builds d'apps dans l'onglet Device.

**État au 9 septembre 2026, 23 h — phase 1 livrée et validée sur box** :
migration `20260909200000` (jumeau `avatar_platform_state`, `maintenance_tasks`
avec bail et RPC de réclamation, profils et J0 sur `avatars`, briefs),
planificateur pur testé, workers Schedule et Maintain, recettes (sonde,
warmup, app_check, coherence, session passive), briefs compilés par Aleria,
onglet Maintenance et brief effectif dans les deux cockpits, badge « sur le
device » sur la règle unique `actionableOnDeviceStatus`. Quatre tâches réelles
ont tourné par le chemin de production (box-2, box-3, box-4 — §2.6). Le pilote
(§5.1) démarre au déploiement.

**Phase 2, même soir** : mesure sur US56 (TikTok 45.2.3) — « Log in » sur
l'écran « Welcome back » envoie immédiatement un code à la boîte du compte,
sans étape mot de passe ; la reconnexion déterministe est donc « code e-mail
d'abord ». Livré : table `verification_codes` (migration `20260909220000`),
webhook signé `/api/maintenance/verification-codes`, Email Worker Cloudflare
(`infra/email-worker`, à déployer et router sur les domaines des boîtes),
recette `relogin` (compte de l'écran = identifiants, Log in, attente du code
150 s, saisie ADBKeyboard, relecture du feed, un essai par 24 h, escalade
`email_code` sinon), planifiée quand le jumeau dit `logged_out` ; agent vision
borné (12 pas, liste blanche de gestes, jamais Allow / Log in / Update / Pay,
détection de boucle, `maintenance.vision_agent_enabled` faux par défaut) ;
« Take over » sur une tâche en cours dans les deux cockpits (interruption au
pas suivant, le flux est sous les yeux de l'opérateur).

**Phase 3, même soir (socle)** : `cluster_candidates` (migration
`20260909230000`) alimentée par la découverte TikHub (`fetch_search_user` sur
les mots-clés de cluster des armées, 3 recherches / avatar / jour, score par
taille avec plafond) ; la session mature (`allow_engagement`, hors mode
`observe`) suit un créateur du cluster en début de session (deep link profil,
Follow par sélecteur, vérification par l'en-tête) et aime une vidéo du feed
avec une probabilité de 0,15, dans les budgets `likes_per_day` /
`follows_per_day` du profil, chaque geste vérifié dans l'arbre et inscrit au
registre ; rapport hebdomadaire par compte (`/api/maintenance/report`, boîte
« Report » de l'onglet Maintenance) avec l'auto-audit de régularité (sessions
qui démarrent à la même minute = horloge) ; section « Cluster » dans l'onglet
Maintenance. Restent : réponses organiques rares, mémoire du jumeau,
communautés Gorgone comme deuxième source, vue cluster macOS.

---

## 6. Ouvert

- File d'attention : rôles autorisés (`operator`, `manager`) ; critères de
  passage entre paliers.
- Latence depuis Render (clé SSH à enregistrer, ou endpoint de diagnostic).
- Prévalence exacte des murs X sur toute la flotte (lecture hors ligne de
  `/data/system/packages.xml`).
- Effet de `accessibility/set_hidden` sur X et TikTok ; batching sur une
  future version de l'agent.
- Accès au catch-all Cloudflare pour un Email Worker ; quota TikHub pour la
  découverte de candidats ; 5 `gorgone_links` pour 6 comptes.
- Données à compléter : identifiants incomplets, fuseaux non synchronisés,
  `topics_expertise` vides, handles TikTok invalides, box-6 hors tunnel,
  box-4 « offline » en base alors qu'elle répond.
- Rétention des preuves (captures contenant du contenu tiers), accès par
  rôle, `audit_log` des actions du maintainer.

---

## 7. Hygiène relevée pendant les tests

- `proxy_get` renvoie les mots de passe proxy **en clair** dans `nodes[]` : ne
  jamais journaliser la réponse brute. Le sous-compte NodeMaven du device
  `US13` a été affiché dans un journal de test et doit être renouvelé.
- Advisors Supabase : `is_admin()` et `record_automator_usage()` exécutables
  par `anon` en `SECURITY DEFINER`, `get_device_counts_by_box()` par
  `authenticated`, protection contre les mots de passe compromis désactivée.
- `.cursor/mcp.json` porte le token Cloudflare Access de service (gitignoré) ;
  tout banc d'essai externe (Automations Cursor, SDK) doit utiliser un token
  dédié et révocable.
- Le `CRON_SECRET` de `.env.local` diffère de celui de production : normal,
  mais les routes workers ne se déclenchent pas depuis un poste local.

---

## 8. Reproduire les tests

Tout passe par `https://box-N.attila.army` avec les en-têtes CF Access de
`.env.local`. Toujours : un seul device par box, jamais une box où un opérateur
est en session (`avatar_usage_sessions.ended_at IS NULL`), `stop` à la fin.

```bash
# démarrer, attendre Android, sonder v2 (peut demander plusieurs essais)
POST /container_api/v1/run            {"db_ids":["<db_id>"]}
GET  /container_api/v1/rom_status/<db_id>            # jusqu'à code 200
POST /android_api/v1/shell/<db_id>    {"id":"<db_id>","cmd":"getprop sys.boot_completed"}
GET  /android_api/v2/<db_id>/base/version_info       # retry ; sinon repli in-guest

# lire, agir, vérifier
GET  /android_api/v2/<db_id>/accessibility/dump_compact
POST /android_api/v2/<db_id>/accessibility/node
     {"selector":{"xpath":"//*[contains(@content-desc,\"comments\")]"},"wait_timeout":3000,"action":"click"}
POST /android_api/v2/<db_id>/input/scroll_bezier
     {"start_x":540,"start_y":1700,"end_x":530,"end_y":600,"duration":420}
GET  /android_api/v2/<db_id>/screenshot/format?format=jpeg&quality=55

# repli quand v2 est injoignable depuis l'hôte
POST /android_api/v1/shell/<db_id>
     {"id":"<db_id>","cmd":"curl -s http://127.0.0.1:18185/api/accessibility/dump_compact | gzip -c | base64 -w0"}

# toujours à la fin
POST /container_api/v1/stop           {"db_ids":["<db_id>"]}
```

Les flux de production se rejouent avec `scripts/x-reply.ts` et
`scripts/tiktok-reply.ts` (voir `X-AUTOMATE.md`, `TIKTOK-AUTOMATE.md`) ; ils
n'arrêtent pas le conteneur et écrivent leurs captures dans le répertoire
courant.
