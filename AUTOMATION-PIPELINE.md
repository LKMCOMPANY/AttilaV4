# Automation Pipeline — Documentation technique

> Pipeline d'automatisation des commentaires sur Twitter/X et TikTok.
> Concu le 15 avril 2026. Ce document est la reference pour tout developpement sur le pipeline.

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

## Etape 1 — Ingestion Gorgone (FAIT)

Deja implemente dans `src/lib/gorgone/` et `src/app/api/gorgone/sync/route.ts`.

- Cron toutes les 30s appelle `POST /api/gorgone/sync` (protege par `CRON_SECRET`)
- Sync incrementale par cursor (`collected_at`) depuis le Supabase Gorgone (lecture seule)
- Upsert dans `gorgone_tweets` et `gorgone_tiktok_videos` avec `status = 'pending'`
- Dedup par `UNIQUE(gorgone_id)` + `ON CONFLICT DO NOTHING`
- Batch de 500 rows max, les prochains cycles rattrapent si plus

### Volumes mesures (avril 2026)

| Table | Rows dans Gorgone | Cadence |
|-------|-------------------:|---------|
| `twitter_tweets` | 4.6M | ~2.2K/jour/zone active |
| `tiktok_videos` | 33.8K | ~500/semaine/zone |

### Tables Attila

- `gorgone_tweets` : tweets ingeres, avec auteur denormalise, stats, `status`
- `gorgone_tiktok_videos` : videos TikTok ingeres, meme pattern
- `gorgone_sync_cursors` : un cursor par zone par plateforme
- `gorgone_links` : mapping comptes Attila → clients Gorgone

Le champ `status` (`pending` / `processing` / `processed` / `filtered_out` / `error`)
est utilise par le pipeline pour tracker l'avancement de chaque post.

---

## Etape 2 — Filtrage par regles

Le worker charge les posts `pending` des zones liees aux campagnes actives et
applique les filtres configures dans `campaign.filters` (type `CampaignFilters`).

### Filtres Twitter

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Type de post | `is_reply`, `text LIKE 'RT @%'` | Exclure RT et replies |
| Min followers | `author_followers >= N` | `>= 100` |
| Verified only | `author_verified = true` | Comptes verifies |
| Langue | `lang IN (...)` | `['en', 'fr']` |
| Min engagement | `total_engagement >= N` | `>= 50` |
| Min likes/views | `like_count`, `view_count >= N` | Seuils specifiques |

### Filtres TikTok

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Min followers | `author_followers >= N` | `>= 100` |
| Verified only | `author_verified = true` | Comptes verifies |
| Exclure comptes prives | `author_is_private = false` | Impossible de commenter |
| Exclure pubs | `is_ad = false` | Pas de reponse aux ads |
| Langue | `language IN (...)` | `['en', 'fr']` |
| Min plays | `play_count >= N` | `>= 1000` |
| Min engagement | `total_engagement >= N` | `>= 100` |

### Taux de passage

Le capacity estimator (`lib/gorgone/capacity-estimator.ts`) mesure un taux de
passage d'environ **9%** apres filtrage. Sur 2.2K tweets/jour/zone, ~200 passent
les filtres.

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

- `aleria` via Aleria inference (`https://inference.aleria.com/v1`)
- Utilise via `@ai-sdk/openai-compatible` (PAS `@ai-sdk/openai`, voir section Dependances)
- `generateText()` simple + parsing JSON (`parseAleriaJSON()`) — PAS `Output.object()`
  car Aleria ne supporte pas `responseFormat`/structuredOutputs
- `maxOutputTokens >= 2000` obligatoire (le reasoning interne consomme des tokens,
  les posts courts avec 1000 tokens causent `content: null`)
- Latence mesuree : 5-18s par appel selon le contenu

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
4. **Device assigne** (`device_id IS NOT NULL`)
5. **Pas de tag `blocked_{platform}`** (avatar qui a echoue recemment)
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

- `aleria` via `generateText()` simple (texte brut, pas de JSON)
- `maxOutputTokens: 2000`
- Latence mesuree : 1.8-4.2s par avatar

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

### Scripts ADB (code partage)

La logique ADB est dans `src/lib/automation/` (source unique de verite).
Les scripts CLI dans `scripts/` sont des wrappers fins qui importent de la.
L'executor du pipeline (`src/lib/pipeline/executor.ts`) importe aussi de la.

```
src/lib/automation/
  adb-helpers.ts       Helpers partages (shell, screenshot, sleep, IME, wake)
  x-reply.ts           postReply() — Twitter app vs Chrome auto-detect
  tiktok-reply.ts      postTikTokComment() — TikTok app native
```

**Twitter/X** : auto-detection app native vs Chrome. Deep link → ADBKeyboard → post.
**TikTok** : app native obligatoire. `ime enable` avant `ime set`, re-tap apres switch IME.

### Expiration

Avant d'executer, le gateway verifie que le job n'est pas expire :
`queued_at > now() - campaign.queue_max_age`. Si expire → marque `expired`, libere le slot.

### Echecs et avatar tagging

Si un job echoue :
- Le job est marque `failed` avec `error_message`
- Si l'erreur indique un blocage de compte (verification, CAPTCHA) :
  un tag `blocked_{platform}` est ajoute a l'avatar
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
| `aleria` | Chat, analyse, redaction | 2-18s selon le contenu |
| `aleria-vl` | Vision (screenshots, fallback) | ~9s |

### Points critiques

- **`maxOutputTokens >= 2000`** — le reasoning interne consomme des tokens. Avec 1000,
  les posts courts causent `content: null` (tout part en reasoning).
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
  analyst.ts                Appel LLM Analyst (generateText + parseAleriaJSON)
  writer.ts                 Appel LLM Writer (generateText + post-processing)
  avatar-selector.ts        Selection + rate-limiting + scoring (source unique)
  processor.ts              Orchestrateur : processNext() = 1 pipe complet
  executor.ts               Wrapper mince → appelle src/lib/automation/
  index.ts                  Barrel exports

src/app/api/pipeline/
  process/route.ts          Cron endpoint (Option A dev)
  execute/route.ts          Simule gateway (dev) avec guard anti-race

src/app/actions/
  pipeline.ts               Server actions avec auth (getCampaignPosts, getJobs, purge)

src/components/automator/
  pipeline-activity.tsx     UI: queue, activity, posts, job detail

scripts/
  x-reply.ts                CLI wrapper → importe de src/lib/automation/
  tiktok-reply.ts           CLI wrapper → importe de src/lib/automation/
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
