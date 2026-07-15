# Automation Pipeline — Documentation technique

> Pipeline d'automatisation des commentaires sur Twitter/X et TikTok.
> Concu le 15 avril 2026. Refactor 18 avril 2026.

> ⚠️ **Terminologie périmée : "gateway".** Le document parle d'un "gateway"
> Node.js **sur chaque box** qui poll `campaign_jobs` et exécute les jobs. Ce
> service n'existe pas. En production, l'exécution se fait dans le **web
> service** : [src/app/api/pipeline/execute/route.ts](src/app/api/pipeline/execute/route.ts)
> (claim → `ensureContainerReady` → `executeJob` → `stopContainerIfIdle`),
> déclenché par les **worker loops de [server.mjs](server.mjs)**. Partout où on
> lit "le gateway" ci-dessous, comprendre "la route `/api/pipeline/execute`
> pilotée par les workers de server.mjs". La logique décrite (claim `scheduled_at
> <= now()`, expiration, reset des `executing` au démarrage) reste correcte —
> seul l'emplacement (box → web service) a changé.

---

## ⚡ État actuel — refactor 18 avril 2026

Une refonte structurelle a corrigé une famille de bugs où des jobs étaient
marqués `done` alors que rien n'était posté. À lire avant tout dev sur
le pipeline.

### Ce qui a changé

| Composant | Avant | Maintenant |
|---|---|---|
| `box-api.ensureContainerRunning` | Returned as soon as VMOS reported `running` | `ensureContainerReady` polls `getprop sys.boot_completed=1` (timeout 90 s) |
| `shell()` | Returned `{ ok: false }` on VMOS code 201, callers ignored it | Throws `ContainerNotReadyError` → automation aborts immediately |
| `screenshot()` | Single fetch — VMOS server-side caches for ~5 s, source ≡ proof in many jobs | Adaptive retry on hash match (max 3× × 1 s) — never returns the same image as the previous one for that device |
| Twitter flow | `app` and `chrome` modes with auto-detection (chrome never worked) | App-mode only; deep link always opens native app anyway |
| TikTok coords | Comment button at `(985, 1425)` tapped the follow ⨁ button | Validated `(970, 1500)` — opens the comments panel |
| IME lifecycle | `restoreGboard()` hard-coded; no capture of the previous IME | `executor` snapshots `getCurrentIme()` then `restoreIme()` from `finally` — operator never sees the "ADB Keyboard {ON}" banner |
| Source/proof timing | Source after `am start`, proof after re-`am start` (always cold-start splash) | Source after `waitForFocus`, proof with composer open + text typed |
| Success signal | `success: true` if no exception thrown | X: focus must return to `TweetDetailActivity`. TikTok: typed text must no longer be in any `EditText` node |
| Error reporting | Free-form `error_message` strings | `JobError` with 11 typed categories encoded as `[category]` prefix, badges in automator UI |

### Devices known-good

Validated end-to-end via CLI scripts on 18 April 2026:

| Platform | Device | Avatar | Result |
|---|---|---|---|
| Twitter (X) | `EDGEQ3CM8BJHIE64` | Lucas Bernard | Reply posted, focus returned to tweet detail |
| TikTok | `EDGE8DK15O299ST5` | Sami Abadi | Comment posted, count went from 452 → 453 |

### Reference docs

| File | What |
|---|---|
| `X-AUTOMATE.md` | Twitter flow (current — app-mode only) |
| `TIKTOK-AUTOMATE.md` | TikTok flow (current — validated coords) |
| `ADB-REFERENCE.md` | All Android shell helpers and ADBKeyboard provisioning |
| `src/lib/automation/errors.ts` | Source of truth for `JobErrorCategory` |

---

## Prerequis devices

Avant qu'un device puisse executer des jobs du pipeline, il doit avoir
**ADBKeyboard installe et active**. Sans ca, l'execution echoue avec
`Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled`.

Provisioning de masse (idempotent) :
```bash
node scripts/install-adbkeyboard.mjs --concurrency 1
```

Audit read-only :
```bash
node scripts/audit-adbkeyboard.mjs
```

Detail technique : voir `ADB-REFERENCE.md` section 2 bis. Tous les 46 devices
de `box-1.attila.army` ont ete provisionnes le 17 avril 2026.

---

## Vue d'ensemble

Le pipeline automatise la reponse aux posts des reseaux sociaux via des avatars
sur des devices Android virtuels (VMOS). Il se decompose en 3 systemes independants :

```
INGESTION (fait)          WORKER (intelligence)         GATEWAY (execution)
─────────────────         ────────────────────          ──────────────────
Cron 30s                  Poll posts pending            Poll jobs ready
Gorgone → Supabase        Filtre regles                 Slot management
gorgone_tweets            Filtre IA (Aleria)            Start/stop containers
gorgone_tiktok_videos     Selection avatars             Execute ADB scripts
status=pending            Redaction commentaires        Screenshots proof
                          INSERT campaign_jobs          Report done/failed
```

Chaque systeme est independant, observable, et scale separement.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           RENDER                                     │
│                                                                      │
│   Next.js Web Service              Worker (Node.js)                  │
│   ─────────────────                ─────────────────                 │
│   Dashboard admin/client           Boucle polling continue           │
│   API routes                       processNext() — 1 post/cycle     │
│   Operator UI                      Filtre → IA → Jobs               │
│                                                                      │
│                    Supabase (DB + Auth + Realtime + Storage)          │
│                    ─────────────────────────────────────              │
│                    gorgone_tweets, gorgone_tiktok_videos              │
│                    campaigns, campaign_posts, campaign_jobs           │
│                    avatars, devices, boxes                            │
│                    Bucket 'proofs' (screenshots)                      │
│                                                                      │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                  Supabase Realtime / Poll
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       BOX 1            BOX 2            BOX N
      gateway           gateway          gateway
      (stateless)       (stateless)      (stateless)
      max_concurrent    max_concurrent   max_concurrent
      = 10              = 10             = 50
```

---

## Etape 1 — Ingestion Gorgone (FAIT, push pipeline)

Implemente dans `src/lib/gorgone/` et `src/app/api/gorgone/{webhook,sweep}/route.ts`.
Voir `GORGONE-INGESTION.md` pour les details d'archi.

- **Push webhook** : trigger Postgres cote Gorgone (`pg_net.http_post`)
  appelle `POST /api/gorgone/webhook` (timing-safe `X-Webhook-Secret`)
  des qu'une ligne arrive dans `twitter_tweets` / `tiktok_videos` pour
  une zone avec `push_to_attila = true`. Latence < 1 s.
- **Sweep filet** : worker in-process (`server.mjs`) tape
  `POST /api/gorgone/sweep` toutes les 60s. Pour chaque
  `(account, zone, platform)` actif, query Gorgone depuis
  `last_event_at` (cursor composite anti-collision sur batchs
  isochrones) et reuse exactement la meme logique d'ingestion que le
  webhook. Filet en cas de webhook rate.
- **Idempotence** : `UNIQUE(gorgone_id)` + `ON CONFLICT DO NOTHING`
  cote Attila, plus le RPC `register_gorgone_event` qui n'avance le
  cursor que vers l'avant. Aucun doublon, aucune perte.

### Volumes mesures (avril 2026)

| Table | Rows dans Gorgone | Cadence |
|-------|-------------------:|---------|
| `twitter_tweets` | 4.6M | ~2.2K/jour/zone active |
| `tiktok_videos` | 33.8K | ~500/semaine/zone |

### Tables Attila

- `gorgone_tweets` : tweets ingeres, avec auteur denormalise, stats, `status`
- `gorgone_tiktok_videos` : videos TikTok ingeres, meme pattern
- `gorgone_zone_state` : etat observe par `(account, zone, platform)`
  (cursor composite + compteurs par canal)
- `gorgone_links` : mapping comptes Attila → clients Gorgone

Le champ `status` (`pending` / `processing` / `processed` / `filtered_out` / `error`)
est utilise par le pipeline pour tracker l'avancement de chaque post.

---

## Etape 2 — Filtrage par regles

Le worker charge les posts `pending` des zones liees aux campagnes actives et
applique les filtres configures dans `campaign.filters` (type `CampaignFilters`).

Source de verite unique : `lib/pipeline/filter.ts` (`applyFilters`). La meme
fonction est utilisee par le pipeline runtime ET par le capacity estimator
(simulation sur echantillon) — les deux ne peuvent pas diverger.

### Filtres communs (les deux plateformes)

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Min followers | `author_followers >= N` | `>= 100` |
| Verified only | `author_verified = true` | Comptes verifies |
| Langue | `language IN (...)` | `['en', 'fr']` |
| Min engagement | `total_engagement >= N` | `>= 50` (likes+RT+replies+quotes sur X ; diggs+comments+shares sur TikTok) |

### Filtres Twitter

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Types de post | `post_type IN (post, reply, retweet)` | Originaux seulement |
| Min likes / views / replies / quotes / RTs | `raw_metrics.* >= N` | Seuils specifiques |

### Filtres TikTok

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Types de contenu | `tiktok_content_kinds IN (video, comment)` | Videos seulement (les commentaires representent souvent ~80% du volume d'une zone) |
| Exclure pubs | `is_ad = false` | Pas de reponse aux ads |
| Exclure comptes prives | `author_is_private = false` | Impossible de commenter |
| Min plays / comments / diggs / shares / saves | `raw_metrics.* >= N` | Seuils specifiques (saves = `bookmarks` Gorgone) |

### Capacity estimator

`lib/gorgone/` (queries → math → orchestrateur) alimente le panneau "Capacity"
du wizard et des reglages campagne :

- **Fenetre** : les 24h precedant le dernier `first_seen_at` de la (zone,
  network) ; le debit horaire divise par les heures reellement couvertes
  (une zone qui n'a collecte que 2h n'est pas diluee par /24).
- **Volume brut** : count exact sur `posts` (tous kinds ingeres par le
  pipeline, commentaires TikTok inclus).
- **Taux de passage** : mesure empiriquement en executant le vrai
  `applyFilters` du pipeline sur les 5000 posts les plus recents de la
  fenetre (taux joint + taux par filtre individuel pour le breakdown UI).
- **Capacite avatars** : `filtered/h × avg avatars/post` compare aux caps
  horaires/journaliers des armees selectionnees.

Toute erreur de requete Gorgone est propagee jusqu'a l'UI (etat d'erreur +
Retry) — jamais de zero silencieux.

Les posts filtres sont marques `filtered_out`. Seuls les posts qui passent vont
a l'etape suivante (filtre IA).

---

## Ordre de traitement et gestion de la charge

### Priorite par engagement

Les posts pending ne sont pas traites chronologiquement. Ils sont tries par
**engagement decroissant** puis par date :

```sql
ORDER BY total_engagement DESC, collected_at ASC
```

Cela fait que les posts a fort engagement passent en premier. Les posts faibles
restent en queue et expirent naturellement (TTL) si la queue est chargee.

### Auto-regulation par TTL

Le systeme se regule sans regle speciale :

| Situation queue | Comportement |
|-----------------|-------------|
| Vide | Tout passe, les posts moyens sont traites aussi |
| Moderee | Les forts passent d'abord, les faibles passent apres |
| Chargee | Les forts passent, les faibles expirent avant d'etre atteints |
| Saturee | Seuls les plus forts passent, le reste expire |

### Pas de logique de queue pressure dans l'IA

L'Analyst ne sait pas et n'a pas besoin de savoir que la queue est chargee.
Son job est de juger si un post **merite** une reponse (decision editoriale),
pas de gerer la capacite (decision systeme).

On ne passe pas la profondeur de queue a l'IA. Ce serait imprevisible
(la meme queue depth donnerait des decisions differentes a chaque appel)
et plein de biais caches. Le tri par engagement + le TTL font le travail
de maniere deterministe et transparente.

---

## Etape 3 — Filtre IA (Analyst)

L'Analyst est une fonction LLM qui decide si un post merite une reponse et
combien d'avatars deployer.

### Input

- Le post (texte, auteur, stats, plateforme)
- La guideline de la campagne (`operational_context`, `strategy`, `key_messages`)

### Output (JSON parse du texte retourne par le LLM)

```typescript
{
  relevant: boolean;
  reason: string;
  suggested_avatar_count: number;
}
```

### Repartition IA / Code pour les avatars

| Decision | Qui | Pourquoi |
|----------|-----|----------|
| Repondre ou pas ? | IA (Analyst) | Comprend le contexte, la guideline, la pertinence |
| Combien d'avatars ? | IA (Analyst) | Comprend l'importance du post, la viralite, l'opportunite |
| Lesquels deployer ? | Code (avatar-selector) | Connait la dispo temps reel, rate limits, scoring diversite |

L'IA ne recoit pas la liste des avatars. Elle ne connait pas leur disponibilite,
leurs rate limits, ni leurs cooldowns. Elle juge uniquement le post et dit
"ce post merite N reponses". Le code borne N entre `min_avatars_per_post` et
`max_avatars_per_post`, puis selectionne les meilleurs avatars disponibles.

### Modele et implementation

- `aleria-vl` (vision) via Aleria inference (`https://inference.aleria.com/v1`)
- **Vision (07/2026)** : l'image du post (cover TikTok / media Twitter, extraite
  par drill-down JSON dans `post-fetcher.ts`) est telechargee une fois par post
  (`post-image.ts`, fetch 8s max, types jpeg/png/webp/gif, cap 4 MB) et attachee
  en base64 a l'appel. Les captions TikTok sont souvent de purs hashtags — le
  cover frame porte le vrai sujet. URL CDN morte / type non supporte → degrade
  silencieusement en texte-seul ; echec de l'appel vision → retry texte-seul
  (une image cassee ne coute jamais un post).
- Utilise via `@ai-sdk/openai-compatible` (PAS `@ai-sdk/openai`, voir section Dependances)
- `generateText()` simple + parsing JSON (`parseAleriaJSON()`) — PAS `Output.object()`
  car Aleria ne supporte pas `responseFormat`/structuredOutputs
- `maxOutputTokens` : 4000 analyst / 6000 writer — le reasoning interne compte
  dans le budget completion et le raisonnement vision est long (>2500 tokens
  observes sur un commentaire TikTok banal ; un budget trop bas = `content` vide)
- Latence mesuree : 5-18s texte, 12-20s avec image

### Resultats des tests (avril 2026)

| Post teste | Resultat | Avatars | Latence |
|------------|----------|---------|---------|
| Promo crypto @mamo (14K followers) | `relevant: false` — "unrelated to political campaign" | - | 18.6s |
| Tweet politique @microinteracti1 (27K followers) | `relevant: true` — "diplomatic solutions" | 3 | 5.9s |
| Pub IA @patsnapeurekaip (130 followers) | `relevant: false` — "commercial advertisement" | - | 12.1s |
| TikTok @aljazeeraenglish (75M plays) | `relevant: true` — "military conflict, central topic" | 4 | 10.4s |

### Decisions

- `relevant: false` → post marque `filtered_out` dans `gorgone_tweets`
- `relevant: true` → passe a la selection d'avatars
- `suggested_avatar_count` est borne par `capacity_params.min_avatars_per_post` et `max_avatars_per_post`

---

## Etape 4 — Selection des avatars

### Criteres de selection (une seule query SQL, source de verite unique)

Un avatar est eligible si **toutes** ces conditions sont remplies :

1. **Membre de l'army** de la campagne (`avatar_armies`)
2. **Status `active`** (pas `inactive` ou `suspended`)
3. **Plateforme activee** (`twitter_enabled` ou `tiktok_enabled` selon le post)
   **ET credentials présents** (`{platform}_credentials->>'handle'` non vide) —
   parité exacte avec la définition Operator d'un compte « créé et connecté ».
   Le toggle seul ne suffit pas : un avatar activé sans handle n'a pas de compte
   et ne doit jamais recevoir de job.
4. **Device assigne** (`device_id IS NOT NULL`)
5. **Pas de blocage actif dans `avatar_platform_blocks`** (garde-fou, ligne avec
   `resolved_at IS NULL` pour ce couple avatar/plateforme). C'est l'unique
   verrou de sélection ; il remplace l'ancien tag `blocked_{platform}`.
   Alimenté automatiquement par : l'executor sur échec account-level
   (`account_logged_out` / `account_blocked` / `account_captcha`, source
   `on_device`), et le worker santé (TikHub `suspended`, `notfound` sans post
   confirmé, shadow-ban — sources `tikhub` / `verification`). Levé par le
   bouton « Mark resolved » de l'Overview opérateur (le worker peut auto-fermer
   ses propres blocages dérivés quand le signal repasse au vert). Le `status`
   de l'avatar n'est pas touché (blocage par plateforme, réversible). Voir
   `src/lib/account-state/blocks.ts`.
6. **Pas de job en cours** : aucun `campaign_jobs` avec `status IN ('ready', 'executing')` pour cet avatar
7. **Rate limit horaire** : nombre de jobs dans la derniere heure < `capacity_params.max_responses_per_hour`
8. **Rate limit journalier** : nombre de jobs dans les dernieres 24h < `capacity_params.max_responses_per_day`

### Rate limits par plateforme

Les `capacity_params` sont differencies par plateforme dans la campagne :

```typescript
twitter: { max_responses_per_hour: 5, max_responses_per_day: 50, min_avatars_per_post: 1, max_avatars_per_post: 3,
           delay_min_seconds: 30, delay_max_seconds: 120, queue_max_age_minutes: 120 }
tiktok:  { max_responses_per_hour: 3, max_responses_per_day: 30, min_avatars_per_post: 1, max_avatars_per_post: 2,
           delay_min_seconds: 60, delay_max_seconds: 180, queue_max_age_minutes: 180 }
```

### Scoring (diversite)

Si plus d'avatars sont disponibles que necessaire, on selectionne avec un score :
- **Charge journaliere** (40%) : moins un avatar a poste aujourd'hui, plus il est prioritaire
- **Cooldown** (30%) : temps depuis la derniere reponse (minimum 5 minutes)
- **Random** (30%) : composante aleatoire pour la diversite naturelle

Apres scoring, les meilleurs sont selectionnes puis **shuffles** pour un ordre naturel.

### Pas assez d'avatars

Si le nombre d'avatars disponibles est inferieur a `min_avatars_per_post`, le post
est skip (pas de reponse partielle sauf si configure autrement). Un log warning
est emis pour alerter.

---

## Etape 5 — Redaction (Writer)

Le Writer genere le texte du commentaire pour chaque avatar selectionne.
Les commentaires d'un meme post sont generes **sequentiellement** pour
accumuler le contexte anti-repetition.

### Input (par appel)

- Le post original (texte, auteur, plateforme)
- La guideline de la campagne (`operational_context`, `strategy`, `key_messages`)
- La personnalite complete de l'avatar :
  - `writing_style` (casual / formal / journalistic / provocative / diplomatic)
  - `tone` (neutral / humorous / serious / sarcastic / empathetic / aggressive)
  - `vocabulary_level` (simple / standard / advanced / technical)
  - `emoji_usage` (none / sparse / moderate / frequent)
  - `personality_traits`, `topics_expertise`, `topics_avoid`
  - `language_code` → l'avatar ecrit dans SA langue
- **Commentaires deja generes** sur ce post (par les avatars precedents)
- **5 derniers commentaires** de cet avatar (sur d'autres posts)
- La plateforme (adapte le format : Twitter 280 chars max, TikTok 500 chars)

### Anti-repetition

Le mecanisme fonctionne a deux niveaux :

1. **Intra-post** : l'avatar N voit les commentaires des avatars 1 a N-1 sur le meme post.
   Instruction dans le prompt : "do NOT repeat their ideas"

2. **Inter-posts** : l'avatar voit ses 5 derniers commentaires (sur d'autres posts).
   Instruction : "vary your style and ideas"

### Resultats des tests anti-repetition

| Avatar | Style/Tone | Langue | Commentaire genere |
|--------|-----------|--------|-------------------|
| test en | casual/neutral | en | "What's the minimum deposit to qualify?" |
| john do | casual/neutral | ca | "Fins quan va aquesta campanya? M'interessa provar-ho" |

Verification : 0% de mots partages, langues differentes, contenus differents.

### Post-processing

Le texte genere est nettoye avant insertion :
- Strip des wrappers markdown (backticks, guillemets)
- Strip des prefixes IA ("Here's my response:")
- Normalisation des tirets (em dash → hyphen)
- Strip des hashtags en fin de message
- Troncature naturelle (coupe au dernier espace/ponctuation)
- Verification des ouvertures bannies ("Great point!", "I completely agree", etc.)
- 1 retry si la validation echoue (ouverture bannie, trop court)

### Adaptation par plateforme

| Plateforme | Max chars | Style | Regles |
|-----------|----------|-------|--------|
| Twitter/X | 280 | Court, punchy, conversationnel | Pas de hashtags, mentions possibles |
| TikTok | 500 | Casual, energetique, playful | Emojis naturels, pas de hashtags |

### Modele

- `aleria-vl` via `generateText()` simple (texte brut, pas de JSON)
- L'image du post (fetchee une fois par le processor) est attachee au 1er
  essai — le commentaire reagit a ce qu'on VOIT dans la video, pas juste a la
  caption. Le retry (validation ou erreur) droppe l'image.
- `maxOutputTokens: 6000` (reasoning vision long, compte dans le budget)
- Latence mesuree : 1.8-4.2s texte, 12-20s avec image

---

## Etape 6 — Creation des jobs

Apres la redaction, le worker insere en transaction :

1. **`campaign_posts`** : le post source avec la decision IA et les metriques
2. **`campaign_jobs`** : un job par avatar avec le texte du commentaire

### Scheduling anti-detection (stagger cumulatif)

Les jobs d'un meme post ne sont pas tous executables immediatement. Le worker
calcule un `scheduled_at` avec un stagger cumulatif :

```
Avatar 1 : now() + random(delay_min, delay_max)
Avatar 2 : avatar_1.scheduled_at + random(delay_min, delay_max)
Avatar 3 : avatar_2.scheduled_at + random(delay_min, delay_max)
```

Le gateway ne prend un job que si `scheduled_at <= now()`. Cela espace les
commentaires dans le temps pour paraitre naturel.

Les `delay_min` et `delay_max` sont configures par campagne dans
`capacity_params` (defauts : 30-120s Twitter, 60-180s TikTok).
Validation : `delay_max = Math.max(delay_max, delay_min)` garanti cote code.

### Resolution device → box

Pour chaque job, le worker resout la chaine :

```
avatar.device_id → devices.box_id → boxes.tunnel_hostname
```

Le job stocke `device_id`, `box_id`, et `post_url` pour que le gateway ait tout
ce qu'il faut sans query supplementaire.

### Statuts des jobs

| Statut | Signification |
|--------|---------------|
| `ready` | Cree, en attente d'execution (dans la queue) |
| `executing` | Le gateway l'a pris, container demarre, ADB en cours |
| `done` | Commentaire poste avec succes |
| `failed` | Echec (compte bloque, erreur ADB, timeout) |
| `cancelled` | Annule manuellement (purge queue) |
| `expired` | Trop vieux pour etre execute (queue TTL depasse) |

---

## Etape 7 — Execution (Gateway)

Le gateway est un service Node.js sur chaque box. Il consomme les jobs et
execute les scripts ADB pour poster les commentaires.

### Principe : stateless, tout en DB

Le gateway n'a aucune queue interne. Il poll `campaign_jobs` pour sa box
et verifie les contraintes de slots. Si il redemarre, il reprend les jobs
`ready` sans rien perdre.

### Slot management

Chaque box a une limite de containers simultanes (`boxes.max_concurrent_containers`,
default 10, configurable par box directement en DB).

Avant de prendre un job, le gateway verifie :

```sql
SELECT count(*) FROM campaign_jobs
WHERE box_id = $my_box_id AND status = 'executing'
```

Si `count < max_concurrent_containers` → il peut prendre un job.
Sinon → il attend qu'un slot se libere.

La valeur est stockee en DB et lue dynamiquement. Pour la modifier :
```sql
UPDATE boxes SET max_concurrent_containers = 50 WHERE tunnel_hostname = 'box-2.attila.army';
```

### Lifecycle d'un job

```
1. Poll:    SELECT ... WHERE box_id=$1 AND status='ready'
            AND scheduled_at <= now()
            ORDER BY scheduled_at LIMIT 1
            FOR UPDATE SKIP LOCKED

2. Claim:   UPDATE status='executing', started_at=now()
            (avec guard .eq("status", "ready") pour eviter double-claim)

3. Start:   POST /container_api/v1/run/{db_id}  (si container stopped)
            Poll rom_status/get_android_detail jusqu'a running

4. Execute: Appel depuis src/lib/automation/ :
            - Twitter → postReply()     (src/lib/automation/x-reply.ts)
            - TikTok  → postTikTokComment() (src/lib/automation/tiktok-reply.ts)

5. Proof:   Screenshots source + proof → upload Supabase Storage
            bucket 'proofs', path: {campaign_id}/{job_id}_{type}.jpg

6. Stop:    POST /container_api/v1/stop/{db_id}
            Exception : si un autre job ready attend pour ce device, pas de stop

7. Report:  UPDATE campaign_jobs SET
              status = 'done' / 'failed',
              completed_at = now(),
              duration_ms = ...,
              source_screenshot = ...,
              proof_screenshot = ...,
              error_message = ... (si failed)
            UPDATE campaigns SET
              total_responses_sent = total_responses_sent + 1  (ou total_responses_failed)
```

### Modules d'automation (refactor 18 avril 2026)

La logique ADB est dans `src/lib/automation/` (source unique de verite).
Les scripts CLI dans `scripts/` sont des wrappers fins qui importent de la.
L'executor du pipeline (`src/lib/pipeline/executor.ts`) importe aussi de la.

```
src/lib/box-api.ts         VMOS HTTP layer
                             boxFetch — primitive fetch + CF-Auth
                             shell — throws ContainerNotReadyError on code 201
                             shellSafe — same but never throws (cleanup paths)
                             screenshot — adaptive cache busting via SHA-256 retry
                             ensureContainerReady — start + poll boot_completed=1
                             stopContainerIfIdle / stopContainer
                             ContainerNotReadyError (export class)

src/lib/automation/
  adb-helpers.ts           Android-level helpers
                             wakeDevice — WAKEUP + MENU + verify + retry swipe
                             isPackageInstalled — pm list packages probe
                             getCurrentIme / activateAdbKeyboard / restoreIme
                             typeText — broadcast + verifies "Broadcast completed"
                             getCurrentFocus / waitForFocus — bounded poll
                             tryUiDump — best-effort uiautomator dump --compressed
                             (re-exports shell/shellSafe/screenshot from box-api)
  x-reply.ts               postReply() — Twitter native app only
  tiktok-reply.ts          postTikTokComment() — TikTok native app
  errors.ts                JobError + JobErrorCategory + parseJobError
```

Patterns:

- **Twitter/X** : `force-stop` → deep link → `waitForFocus(TweetDetailActivity)`
  → blocker detection (login wall, deleted post) → SOURCE → tap reply field
  → `activateAdbKeyboard` → re-tap → `typeText` → PROOF → submit → focus
  must return to tweet detail.
- **TikTok** : `force-stop` → deep link → 8 s video load → blocker detection
  (consent dialog, login, video unavailable) → SOURCE → tap comment icon →
  tap field → `activateAdbKeyboard` → re-tap → `typeText` → PROOF → submit
  → verify field is empty.

### Vérification du succès — confirmation positive (refonte 07/2026)

Règle unique : **le screenshot n'est jamais une entrée de la décision** (un lag
d'image ne doit pas créer un faux `done`) ; la décision vient de l'arbre
d'accessibilité (`uiautomator dump`), et « je ne peux pas vérifier » = **échec**,
jamais succès. Un audit de campagne a montré que l'ancienne heuristique TikTok
(`isTextStuckInEditText` avec dump `null` traité comme succès) produisait ~90%
de faux `done`.

- **TikTok** : après l'envoi, on exige un signal POSITIF — notre commentaire
  présent comme item posté dans la liste (`postedCommentPresent`, nœud non-
  `EditText`) OU le compteur de commentaires incrémenté (N→N+1). Texte encore
  dans l'`EditText` → `rate_limited`. Champ vidé sans signal positif → drop
  silencieux → `rate_limited`. Arbre illisible → `ui_unexpected`. La phase de
  saisie tourne **sans dump** (un dump referme le composer). Voir
  `TIKTOK-AUTOMATE.md`.
- **Twitter** : `getCurrentFocus()` doit revenir sur `TweetDetailActivity` après
  l'envoi (gate on-device). ⚠️ Ce gate est FAIBLE : « composer fermé » ne prouve
  pas que la réponse a atterri (un shadow-ban / silent-drop est identique
  on-device — vérifié en live : un `done` absent de la timeline TikHub). La
  couche TikHub (ci-dessous) est donc essentielle sur Twitter, pas juste un bonus.

### Vérification off-device différée (TikHub) — colonne `verification`

`src/lib/pipeline/verify.ts` (worker `Verify`, endpoint `/api/pipeline/verify`)
relit chaque job `done` via TikHub après un délai d'indexation (90s min, 2h max)
et écrit une colonne `verification` **indépendante de `status`** :
- `confirmed` — commentaire/réponse retrouvé sur la cible
- `unconfirmed` — vérifié mais absent (silent-drop / shadow-ban) → badge ambre
  « Publié — non confirmé » dans l'UI
- `unchecked` — TikHub injoignable, clé absente, ou (TikTok) commentaire enfoui
  sous le tri par pertinence → « on ne sait pas »

Ne touche JAMAIS `status` (pas de re-post → zéro risque de doublon) ; annote
seulement. Activée par `TIKHUB_API_KEY`.

**Asymétrie Twitter vs TikTok** :
- Twitter : `fetch_user_tweet_replies` lit la timeline PROPRE de l'avatar →
  fiable quelle que soit la taille du thread cible. Compense le gate on-device
  faible. Verdict confirmed/unconfirmed robuste.
- TikTok : pas d'historique par-user ; on ne peut scanner que les commentaires
  de la VIDÉO cible, triés par pertinence (pas par récence). Sur une vidéo
  active (milliers de commentaires) le nôtre est enfoui → `available:false` →
  `unchecked` (jamais un faux `unconfirmed`). Verdict fiable seulement sur les
  vidéos ≤100 commentaires. Le gate on-device TikTok étant déjà fort (on lit
  notre commentaire dans la liste), TikHub y est un bonus, pas une béquille.

### Reporting d'erreur — JobError

Tout chemin d'erreur passe par `encodeJobError(err)` avant d'écrire en DB.
Format `[category] message`. 11 catégories définies dans
`src/lib/automation/errors.ts` avec sévérité (`action_required` /
`transient` / `terminal` / `bug`). Le frontend automator parse et rend un
badge coloré + hint contextuel pour l'opérateur.

Catégories d'action immédiate :
- `account_logged_out` → opérateur doit re-logger l'avatar
- `consent_required` → ack manuel du dialog TikTok
- `device_setup_required` → APK manquant
- `account_blocked` / `account_captcha` → intervention compte

### Expiration

Avant d'executer, le gateway verifie que le job n'est pas expire :
`queued_at > now() - campaign.queue_max_age`. Si expire → marque `expired`, libere le slot.

### Echecs et garde-fou avatar

Si un job echoue :
- Le job est marque `failed` avec `error_message`
- Si l'erreur est account-level (`account_logged_out` / `account_blocked` /
  `account_captcha`) : un blocage est ouvert dans `avatar_platform_blocks`
  (raison = catégorie parsée, source `on_device`, `job_id` pour la traçabilité).
  L'avatar n'est plus sélectionnable sur cette plateforme tant qu'un opérateur
  n'a pas cliqué « Mark resolved » dans l'Overview.
- Le worker santé (`/api/avatars/health`) ouvre/ferme de la même façon les
  blocages dérivés : TikHub `suspended`, `notfound` sans post confirmé,
  shadow-ban (posts `done` jamais confirmés sur 7 j). Un `notfound` AVEC posts
  confirmés n'est PAS bloquant (juste « handle à corriger »). Anti-flap : un
  blocage résolu n'est pas rouvert pendant 24 h.
- L'avatar n'est **pas** desactive automatiquement (pas de changement de `status`)
- Pas de retry automatique : la priorite est aux nouveaux posts

### Cleanup au demarrage

Au demarrage, le gateway marque `failed` les jobs `executing` pour sa box depuis
plus de 5 minutes (crash recovery).

---

## Worker — Entry points et scaling

### Option A — Dev (API route)

```
POST /api/pipeline/process
Authorization: Bearer {CRON_SECRET}
```

Traite 1 post par appel. Peut etre appele manuellement ou par un cron.
Utile pour tester le pipeline etape par etape en local.

### Option B — Prod (Render Background Worker)

```typescript
// worker.ts
async function main() {
  while (true) {
    const processed = await processNext();
    if (!processed) await sleep(10_000); // 10s idle
  }
}
```

Process Node.js long-running sur Render. Scale horizontal en ajoutant des instances.
Chaque instance fait la meme boucle, `FOR UPDATE SKIP LOCKED` garantit zero collision.

### Capacite

| Workers | Posts/heure | Posts/jour | Cas d'usage |
|---------|-------------|-----------|-------------|
| 1 | ~72 | ~1,700 | Lancement, quelques zones |
| 2 | ~144 | ~3,400 | 10+ zones actives |
| 3 | ~216 | ~5,100 | Volume important |
| 5 | ~360 | ~8,600 | Grosse echelle |

Le bottleneck est la latence Aleria (5-18s par appel LLM), pas PostgreSQL.

---

## IA — LLM Aleria

### Configuration

```
ALERIA_API_KEY=...
ALERIA_BASE_URL=https://inference.aleria.com/v1
```

### Provider : `@ai-sdk/openai-compatible` (PAS `@ai-sdk/openai`)

Aleria est une API OpenAI-compatible qui utilise `/v1/chat/completions`.
Le provider `@ai-sdk/openai` du AI SDK v6 envoie a `/v1/responses` (nouvelle API
OpenAI Responses) qu'Aleria ne supporte pas → erreur 404.

```typescript
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const aleria = createOpenAICompatible({
  name: "aleria",
  baseURL: process.env.ALERIA_BASE_URL,
  apiKey: process.env.ALERIA_API_KEY,
});

const { text } = await generateText({
  model: aleria.chatModel("aleria"),
  system: "...",
  prompt: "...",
  maxOutputTokens: 2000,
});
```

### Structured output : JSON dans le texte, pas Output.object()

`Output.object()` du SDK envoie un `responseFormat` qu'Aleria ne supporte pas
(warning: "The feature responseFormat is not supported"). L'Analyst utilise
`generateText()` simple et parse le JSON du texte retourne avec `parseAleriaJSON()`.

Le Writer utilise `generateText()` simple (texte brut, pas de JSON).

### Modeles

| Model ID | Usage | Latence mesuree |
|----------|-------|-----------------|
| `aleria-vl` | Analyst + Writer du pipeline (texte + image du post) | 5-20s |
| `aleria` | Taches texte-seul hors pipeline (guideline generator) | 2-18s |

### Points critiques

- **`maxOutputTokens` genereux obligatoire** (4000 analyst / 6000 writer) — le
  reasoning interne consomme le budget completion, et le raisonnement vision
  depasse facilement 2500 tokens. Budget trop bas = `content` vide.
- **Posts courts** (< 80 chars, promos) : latence plus elevee (18s) car le reasoning
  est disproportionne par rapport au contenu. Posts longs : 5-6s.
- **Reponses JSON** parfois wrappees dans des backticks markdown → `parseAleriaJSON()`
  les strip automatiquement.
- **Cout : gratuit** (infrastructure privee)

### Pas de framework agent

Pas de LangChain, pas de CrewAI, pas d'orchestrateur multi-agent. Le flow est lineaire :
post → analyse → selection → redaction → job. `generateText()` suffit.

Le document PRODUCT-FLOWS.md decrit un design multi-agent (Planner, Writer, Style, Analyst)
avec shared memory. C'est un objectif a moyen terme, pas la V1 du pipeline.

---

## Base de donnees — Nouvelles tables

### `boxes` — Modification

Nouvelle colonne : `max_concurrent_containers` (integer, default 10).
Configurable par box directement en DB. Pas d'UI — on change en SQL quand necessaire.

### `campaign_posts`

Chaque post source traite par le pipeline.

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid PK | |
| campaign_id | uuid FK campaigns | |
| account_id | uuid FK accounts | Multi-tenant (RLS) |
| source_table | text | 'gorgone_tweets' ou 'gorgone_tiktok_videos' |
| source_id | uuid | ID dans la table source (dedup) |
| platform | text | 'twitter' ou 'tiktok' |
| post_url | text | URL du post original |
| post_text | text | Texte du post |
| post_author | text | Username auteur |
| post_metrics | jsonb | Stats au moment du traitement |
| ai_decision | jsonb | Decision Analyst : relevant, reason, avatar_count |
| status | text | pending / processing / responded / filtered_out / error |
| processed_at | timestamptz | Quand le traitement est termine |
| created_at | timestamptz | |

### `campaign_jobs`

Chaque commentaire a poster. **Sert aussi de queue visible.**

| Colonne | Type | Description |
|---------|------|-------------|
| id | uuid PK | |
| campaign_id | uuid FK campaigns | |
| campaign_post_id | uuid FK campaign_posts | |
| account_id | uuid FK accounts | Multi-tenant (RLS) |
| avatar_id | uuid FK avatars | |
| device_id | uuid FK devices | |
| box_id | uuid FK boxes | Pour le routage gateway |
| platform | text | 'twitter' ou 'tiktok' |
| post_url | text | URL cible |
| comment_text | text | Texte genere par le Writer |
| status | text | ready / executing / done / failed / cancelled / expired |
| error_message | text | Raison de l'echec (si failed) |
| source_screenshot | text | Storage path proof "before" |
| proof_screenshot | text | Storage path proof "after" |
| scheduled_at | timestamptz | Quand le job peut etre execute (stagger) |
| queued_at | timestamptz | Quand le job a ete cree |
| started_at | timestamptz | Debut d'execution par le gateway |
| completed_at | timestamptz | Fin d'execution |
| duration_ms | int | Duree execution ADB en ms |
| created_at | timestamptz | |

### Index

- `(box_id, status, scheduled_at)` — queue par box avec scheduling
- `(campaign_id, status)` — stats par campagne
- `(avatar_id, created_at)` — rate limiting par avatar
- `(campaign_post_id)` — jointure post → jobs
- `(source_table, source_id)` — dedup post source

### RLS

- Admin : acces total (lecture + ecriture)
- Account members : lecture de leur `account_id` uniquement

### RPC Functions

- `claim_pending_post(p_table)` — claim atomique avec `FOR UPDATE SKIP LOCKED`,
  ordonne par `total_engagement DESC, collected_at ASC`
- `increment_campaign_counter(p_campaign_id, p_counter)` — increment atomique des
  compteurs campagne

### Queue = une vue SQL

La "queue" n'est pas une structure separee. C'est simplement :

```sql
SELECT * FROM campaign_jobs
WHERE status = 'ready' AND scheduled_at <= now()
ORDER BY scheduled_at;
```

Tout est visible dans le dashboard, purgeable, monitorable.

---

## Counters campagne

Les compteurs sur la table `campaigns` sont mis a jour par **application code**
via la RPC `increment_campaign_counter` (pas par des triggers PostgreSQL) :

- `total_posts_ingested` — incremente quand un post passe le pipeline complet
- `total_posts_filtered` — incremente quand un post est filtre (regles ou IA)
- `total_responses_sent` — incremente par le gateway apres un job `done`
- `total_responses_failed` — incremente par le gateway apres un job `failed`

La V3 utilisait des triggers qui causaient du drift entre trigger et callback.
L'application code est plus simple et plus previsible.

---

## Structure du code

```
src/lib/ai/
  client.ts                 Provider Aleria (AI SDK v6 + @ai-sdk/openai-compatible)
                            Lazy singleton — cree une seule fois

src/lib/automation/
  adb-helpers.ts            Helpers ADB partages (shell, screenshot, IME, wake)
  x-reply.ts                postReply() — Twitter app/Chrome (source unique)
  tiktok-reply.ts           postTikTokComment() — TikTok app (source unique)

src/lib/pipeline/
  types.ts                  Types pipeline + withTimeout() + structured logging
  prompts.ts                Templates prompts Analyst et Writer + post-processing
  filter.ts                 Filtrage par regles (pure function)
  analyst.ts                Appel LLM Analyst aleria-vl (image + texte, fallback texte-seul)
  writer.ts                 Appel LLM Writer aleria-vl (image + texte, retry texte-seul)
  post-image.ts             Fetch de l'image du post (CDN signee, 1x/post, fail-safe)
  avatar-selector.ts        Selection + rate-limiting + scoring (source unique)
  processor.ts              Orchestrateur : processNext() = 1 pipe complet
  executor.ts               Wrapper mince → appelle src/lib/automation/
  verify.ts                 Passe TikHub differee : done → confirmed/unconfirmed
  index.ts                  Barrel exports

src/app/api/pipeline/
  process/route.ts          Cron endpoint (Option A dev)
  execute/route.ts          Simule gateway (dev) avec guard anti-race
  verify/route.ts           Passe de verification off-device (worker Verify)

src/app/actions/
  pipeline.ts               Server actions avec auth (getCampaignPosts, getJobs, purge)

src/components/automator/
  pipeline-activity.tsx     UI: queue, activity, posts, job detail

scripts/
  x-reply.ts                CLI wrapper → importe de src/lib/automation/
  tiktok-reply.ts           CLI wrapper → importe de src/lib/automation/
  install-adbkeyboard.mjs   Provisioning ADBKeyboard sur tous les devices
                            (boot → install APK → pm enable → ime enable → stop).
                            Idempotent. Flags : --concurrency N, --only DBID1,DBID2.
                            Limite host VMOS : 10 containers running max.
  audit-adbkeyboard.mjs     Audit read-only ADBKeyboard sur tous les devices
                            (pour les devices currently running uniquement).
```

---

## Dependances

```
ai@^6.0.0                           Vercel AI SDK v6
@ai-sdk/openai-compatible@latest     Provider pour APIs OpenAI-compatible (Aleria)
```

IMPORTANT : on utilise `@ai-sdk/openai-compatible` et PAS `@ai-sdk/openai`.
Le provider `@ai-sdk/openai` envoie a `/v1/responses` (nouvelle API OpenAI)
qu'Aleria ne supporte pas. `@ai-sdk/openai-compatible` utilise `/v1/chat/completions`.

De plus, `Output.object()` envoie un `responseFormat` non supporte par Aleria.
L'Analyst parse le JSON du texte. Le Writer genere du texte brut.

---

## Variables d'environnement

```
# Aleria LLM
ALERIA_API_KEY=...
ALERIA_BASE_URL=https://inference.aleria.com/v1

# Pipeline cron protection
CRON_SECRET=...

# Cloudflare Access (pour les boxes)
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
```

---

## Lecons de la V3 integrees

| Probleme V3 | Solution V4 |
|-------------|-------------|
| Fire-and-forget dans API route Vercel | `processNext()` atomique, crash-safe |
| QStash pour les delays | `scheduled_at` en DB, stagger cumulatif |
| 3 fonctions "isAvailable" divergentes | 1 seule query SQL dans `avatar-selector.ts` |
| Cache in-memory avatar memory (drift) | Query DB directe a chaque pipe |
| Top-level catch masque la phase | Structured logging `[Pipeline][postId][phase]` |
| Auth header sans verification crypto | `CRON_SECRET` compare correctement |
| Bug delayMin > delayMax (stagger negatif) | `Math.max(delayMax, delayMin)` |
| Code ADB duplique (scripts + executor) | `src/lib/automation/` source unique, wrappers fins |
| `timeout()` duplique dans 2 fichiers | `withTimeout()` generique dans `types.ts` |
| Provider recree a chaque appel LLM | Lazy singleton module-level |
| Race condition double-claim sur execute | Guard `.eq("status", "ready")` sur UPDATE |
| Server actions sans verif auth | `requireSession()` + `requireAdmin()` |

### Patterns V3 conserves

- Contexte cumulatif (`previousCommentsOnPost`) pour anti-repetition
- Avatar memory (5 derniers commentaires) pour varier le style
- Avatar scoring : charge journaliere + cooldown + random
- Fail-fast avec timeout par phase
- Post-processing : strip wrappers, banned openings, length caps
- Structured logging par phase
- Dedup par `UNIQUE` constraint

---

## Edge cases et contraintes

### Device / Container

- Un container stopped ne peut pas recevoir de commandes ADB
- `GET /screenshots/{db_id}` sur un container stopped retourne une erreur JSON
- Les ports dynamiques changent a chaque demarrage
- Le demarrage d'un container prend quelques secondes

### TikTok specifique

- App native obligatoire (web inutilisable)
- `uiautomator dump` ne fonctionne pas pendant la lecture video
- Les coordonnees des boutons peuvent varier (bannieres, description longue)
- `ime enable` avant `ime set` (pas juste `ime set`)
- Re-tap apres switch IME pour restaurer le focus

### Twitter/X specifique

- Deux flows : app native vs Chrome (auto-detecte par `pm list packages`)
- Chrome : utiliser `intent/post?in_reply_to=` (pas `compose/post`)
- Coordonnees differentes entre app et Chrome

### Proxy

- Proxy configure au niveau device, pas au niveau job
- Proxy lent ou down → page blanche → classifier comme `failed`

### Queue / Timing

- Un job expire (TTL depasse) ne doit pas etre execute → marque `expired`
- Les delays entre avatars respectent `scheduled_at` (stagger cumulatif)
- Un avatar ne peut faire qu'un seul job a la fois (device physique unique)
- Si tous les slots sont occupes, les jobs attendent en `ready`

### Aleria LLM

- Posts courts (< 80 chars) : risque de `content: null` (reasoning consomme tout)
- `maxOutputTokens: 2000` minimum (pas 1000)
- JSON parfois wrappe dans des backticks markdown → `parseAleriaJSON()` gere

---

## Avancement du developpement

### Fait

- [x] Ingestion Gorgone (cron + sync)
- [x] Table campagnes + creation campagne
- [x] Scripts ADB (x-reply.ts, tiktok-reply.ts) → refactored dans src/lib/automation/
- [x] Page automator (base + pipeline activity panel)
- [x] Page operator (base)
- [x] API proxy box
- [x] Types avatars, campagnes, devices, pipeline
- [x] Client IA Aleria (AI SDK v6 + @ai-sdk/openai-compatible, lazy singleton)
- [x] Tables campaign_posts et campaign_jobs (migration Supabase, RLS, index, FK)
- [x] Colonne max_concurrent_containers sur boxes
- [x] RPC claim_pending_post + increment_campaign_counter
- [x] Filtrage par regles (filter.ts, pure function)
- [x] Analyst LLM (generateText + parseAleriaJSON, teste en live)
- [x] Writer LLM (generateText + post-processing + validation, teste en live)
- [x] Prompts (templates Analyst et Writer, anti-detection, personnalite)
- [x] Avatar selector (rate-limiting, scoring, source unique)
- [x] Processeur pipeline (processNext(), 1 post end-to-end)
- [x] Executeur (wrapper mince → src/lib/automation/)
- [x] API route /api/pipeline/process (dev, Option A)
- [x] API route /api/pipeline/execute (simule gateway, guard anti-race)
- [x] Server actions pipeline (avec auth session)
- [x] UI automator pipeline activity (queue, activity, posts tabs)
- [x] Tests IA live (Analyst sur 4 posts, Writer sur 2 avatars, anti-repetition, TikTok)
- [x] Audit code complet (8 issues trouvees et corrigees)

### Hors scope (a faire plus tard)

- [ ] Gateway on-box (service Node.js separe)
- [ ] Worker long-running Render (Option B)
- [ ] Cleanup stale posts processing (necessite une colonne processing_started_at)
- [ ] Vision Aleria (aleria-vl) pour diagnostiquer les erreurs ADB
- [ ] Multi-agent MCP (Planner/Writer/Style/Analyst avec shared memory)
- [ ] Cleanup automatique des proofs > 30 jours
- [ ] Upload screenshots dans Supabase Storage bucket 'proofs'
