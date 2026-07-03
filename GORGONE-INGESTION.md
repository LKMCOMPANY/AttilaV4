# Gorgone V4 Ingestion Module

> Push pipeline (webhook + sweep) for the Gorgone V4 unified `posts` stream
> flowing into Attila V4's avatar pipeline.
> Migrated 19 May 2026 from the V3 dual-cache (`twitter_tweets` /
> `tiktok_videos`) to a single lightweight ledger.

---

## Contexte

Gorgone V4 est la plateforme de monitoring multi-réseaux (Twitter,
TikTok, Instagram, YouTube, Reddit). Elle stocke ses données dans une
table `posts` partitionnée mensuelle (1 ligne par post collecté, tous
réseaux confondus), avec 1:1 extras par réseau.

Attila V4 a besoin de capter le sous-ensemble Twitter + TikTok pour son
mode Sniper : capter les posts → filtrer (rules + IA) → rédiger des
réponses → publier via les avatars (Android sur des box VMOS).

Ce module gère la **première étape** : capter les posts de Gorgone V4 et
les enfiler dans la pipeline Attila — sans dupliquer leur contenu. Le
contenu reste dans Gorgone, source de vérité unique. Attila tient
seulement un **ledger léger** (`gorgone_post_jobs`) qui suit le statut
pipeline de chaque post.

---

## Architecture

### Flow de bout en bout

```
┌──────── GORGONE V4 (Supabase) ────────────────────────┐
│                                                       │
│  attila_zone_subscriptions(zone_id, networks[])       │
│      ▲                                                │
│      │ admin Attila write (server-side)               │
│                                                       │
│  posts (partitioned)                                  │
│   └─► AFTER INSERT trigger ─► notify_attila_new_post  │
│         filtre par subscription + network             │
│         pg_net.http_post (async, fire-and-forget)     │
│                                                       │
│  attila_integration_config (kv: webhook_url,          │
│                                  webhook_secret)      │
└─────────────────────────────────┬─────────────────────┘
                                  │ HTTPS POST
                                  │ X-Webhook-Secret + payload v3 (minimal)
                                  ▼
┌──────── ATTILA V4 (Render) ───────────────────────────┐
│                                                       │
│  POST /api/gorgone/webhook                            │
│    1. timing-safe secret check                        │
│    2. Zod parse (payload v3)                          │
│    3. enqueue_gorgone_job RPC (ON CONFLICT NOTHING)   │
│       → INSERT gorgone_post_jobs (status='pending')   │
│                                                       │
│  Sweep worker (server.mjs, ~60s):                     │
│    - filet de sécurité derrière le webhook            │
│    - lit posts(zone_id, network) since cursor         │
│    - même enqueue_gorgone_job                         │
│                                                       │
│  Pipeline (server.mjs / API route):                   │
│    1. claim_pending_job RPC (FOR UPDATE SKIP LOCKED)  │
│    2. fetchFullGorgonePost(id, posted_at) → Gorgone   │
│         (joint social_users, post_extras,             │
│          post_ai_classifications, post_translations)  │
│    3. filter / analyst / writer / executor            │
└───────────────────────────────────────────────────────┘
```

### Pourquoi ledger + re-fetch (et pas duplication V3)

- **Single source of truth** : Gorgone owns le contenu. Quand un post est
  édité ou supprimé en amont, on voit l'état à jour à chaque traitement.
- **Bonus V4 gratuits** : `post_ai_classifications` (sentiment) et
  `post_translations` sont calculés par le worker Gorgone — on les
  consomme dans le même re-fetch sans coût LLM côté Attila.
- **Stockage Attila ÷4** : ~10 colonnes au lieu de 40, pas de payload
  texte ni d'auteur dupliqué.
- **Coût** : 1 round-trip Supabase intra-Frankfurt par post claimé
  (~3-5 ms). Négligeable à 1500 posts/jour.

### Pourquoi webhook + sweep (et pas Realtime ou polling pur)

- **Push, pas polling** → latence < 1 s, zéro requête à vide.
- **Outbox + at-least-once** → pattern canonique, idempotence via
  `enqueue_gorgone_job` (`ON CONFLICT (gorgone_post_id) DO NOTHING`).
- **Sweep filet** → 60 s interval, rattrape silencieusement si Attila
  est down lors d'un déploiement Render.

---

## Tables Attila

### `gorgone_links`
Mapping `accounts ↔ Gorgone V4 accounts`. FK `account_id` → `accounts`,
CASCADE on delete.

| Colonne | Rôle |
|---|---|
| `gorgone_account_id` | UUID du compte Gorgone V4 (canonique post-V4) |
| `gorgone_client_name` | Nom affichable copié depuis `accounts.name` Gorgone |
| `is_active` | Toggle global de la liaison |
| `gorgone_client_id` | (legacy V3, droppé en cleanup migration) |

### `gorgone_post_jobs` — le ledger
Une ligne par post Gorgone forwardé à Attila. Pas de contenu — juste les
IDs + métadonnées pour l'ordering du claim et le tracking du pipeline.

| Colonne | Rôle |
|---|---|
| `gorgone_post_id` (PK) | UUID du post côté Gorgone |
| `gorgone_post_posted_at` | Composite PK partner pour les re-fetch |
| `account_id`, `zone_id`, `network`, `kind` | Tenant + dispatch |
| `collected_at`, `total_engagement` | Ordering du claim |
| `status` | `pending` / `processing` / `processed` / `filtered_out` / `error` / `expired` |
| `delivery_source` | `webhook` ou `sweep` |
| `attempts`, `error_message`, `campaign_id` | Diagnostics |

RPC `claim_pending_job(zone_ids?, networks?)` : pick atomique (FOR UPDATE
SKIP LOCKED), marque `processing`, renvoie la row.

RPC `enqueue_gorgone_job(...)` : insert idempotent (ON CONFLICT DO NOTHING).
Webhook + sweep call into the same function.

---

## Tables Gorgone V4

### `attila_zone_subscriptions` (Phase 1 migration)
La whitelist explicite par zone : `zone_id`, `account_id`, `is_active`,
`networks[]`. Ecrit depuis l'admin Attila via le service-role key.

### `attila_integration_config` (kv)
`webhook_url` et `webhook_secret` mirrorés depuis l'env Attila. Lit par
le trigger pour signer chaque dispatch.

### `attila_zone_directory` (vue)
Jointure pratique zones × subscriptions × networks-avec-règles-actives.
Consommée par l'admin Attila pour afficher l'état complet.

### Trigger `posts_after_insert_attila`
- AFTER INSERT sur `public.posts` (parent table — partitions héritent)
- Lookup subscription + network match
- pg_net.http_post avec payload v3 minimal
- Best-effort, swallows errors (sweep rattrape)

---

## Code Attila

### `src/lib/gorgone/`

| Fichier | Rôle |
|---|---|
| `client.ts` | Supabase service-role client vers le projet Gorgone V4 |
| `directory.ts` | `fetchGorgoneAccounts`, `fetchGorgoneZoneDirectory` (lecture du view) |
| `webhook-payload.ts` | Schéma Zod v3 (post.created, network discriminé) |
| `ingest.ts` | `enqueueGorgoneJob` — appelle l'RPC ledger |
| `post-fetcher.ts` | `fetchFullGorgonePost` — re-fetch full payload (auteur + extras + AI) |
| `sweep.ts` | `runSweepCycle` — boucle de réconciliation 60 s |
| `admin-config.ts` | Webhook config + zone subscriptions (writes Gorgone) |
| `capacity-estimator.ts` | Stats 24 h sur `posts` partitioned (queries unifiées) |
| `index.ts` | Barrel exports |

### `src/app/actions/gorgone.ts`

| Action | Usage |
|---|---|
| `getGorgoneLinks(accountId)` | Lien + zones + état ingestion live |
| `getGorgoneAccountsAction()` | Liste des comptes Gorgone V4 dispo |
| `linkGorgoneAccount(...)` | Crée le lien Attila ↔ Gorgone account |
| `unlinkGorgoneAccount(...)` | Supprime le lien |
| `setZoneSubscription(...)` | Toggle/update subscription Gorgone |
| `pushWebhookConfigToGorgone()` | Mirror URL + secret |
| `inspectWebhookConfig()` | Lecture config courante |
| `runSweepNow()` | Trigger manuel de sweep |

### `src/app/api/gorgone/`

| Route | Rôle |
|---|---|
| `webhook/route.ts` | POST appelé par le trigger Postgres (X-Webhook-Secret) |
| `sweep/route.ts` | POST appelé par le worker (Bearer CRON_SECRET) |

### `server.mjs`
Worker `Gorgone-Sweep`, intervalle `GORGONE_SWEEP_INTERVAL_MS` (60 s).

---

## Pipeline aval

```
[1. Ingestion]            ← CE MODULE (webhook + sweep, ledger only)
[2. Claim + Re-fetch]     src/lib/pipeline/processor.ts (claim_pending_job + fetchFullGorgonePost)
[3. Filtrage par règles]  src/lib/pipeline/filter.ts
[4. Filtrage IA]          src/lib/pipeline/analyst.ts (sentiment Gorgone surfacé en prompt)
[5. Sélection avatars]    src/lib/pipeline/avatar-selector.ts
[6. Rédaction]            src/lib/pipeline/writer.ts (translation Gorgone surfacée si dispo)
[7. Publication ADB]      campaign_jobs → executor.ts
```

Le pipeline `processor.ts` opère sur le ledger : il claim, re-fetch
Gorgone (avec auteur + extras + AI), construit `PipelinePost`, applique
le pipeline existant, marque le job `processed` / `filtered_out` /
`error` selon l'issue.

---

## Variables d'environnement

```
NEXT_PUBLIC_APP_URL=https://attila-yew3.onrender.com
GORGONE_SUPABASE_URL=https://ceizkeiphuvnjnizjcjl.supabase.co
GORGONE_SUPABASE_SERVICE_ROLE_KEY=eyJhb...        # service-role key Gorgone V4
GORGONE_WEBHOOK_SECRET=<32+ chars base64url>
GORGONE_SWEEP_INTERVAL_MS=60000
CRON_SECRET=<protect /api/gorgone/sweep>
```

---

## Activation (par zone)

1. **Lien** : `/admin/accounts` → "Link Gorgone Account" → choisir le
   compte Gorgone V4 cible.
2. **Webhook config** : "Push config" pousse l'URL + le secret Attila
   vers `attila_integration_config` côté Gorgone.
3. **Subscription** : pour chaque zone, toggle "Live" sur les networks
   souhaités. Écrit `attila_zone_subscriptions` côté Gorgone.
4. La prochaine INSERT sur `posts` pour cette `(zone, network)`
   déclenche le webhook → enqueue dans `gorgone_post_jobs` → pipeline.

Pour rotater le secret webhook : changer `GORGONE_WEBHOOK_SECRET` dans
les env Render, puis cliquer "Push webhook config".

---

## Garanties

| Propriété | Mécanisme |
|---|---|
| **Latence < 1 s** | Trigger Postgres synchrone → pg_net async → POST direct |
| **Zéro doublon** | `UNIQUE (gorgone_post_id)` + `ON CONFLICT DO NOTHING` |
| **Zéro perte** | Webhook + sweep 60 s, cursor `MAX(collected_at)` par (zone, network) |
| **Pas de back-pressure** | pg_net est async, ne bloque pas l'INSERT côté Gorgone |
| **Single source of truth** | Le contenu reste 100 % dans Gorgone — Attila ne stocke que des IDs |
| **Observabilité** | Tous les calls webhook tracés dans `net._http_response` Gorgone |
| **Activation par (zone, network)** | `attila_zone_subscriptions.networks[]` (Gorgone, source de vérité) |

---

## Filtres campagne

Les filtres `CampaignFilters` (Twitter + TikTok) sont appliqués par
`lib/pipeline/filter.ts` — même fonction pour le runtime et le capacity
estimator. TikTok dispose d'un filtre `tiktok_content_kinds`
(videos / comments) car les commentaires collectés sous les vidéos
représentent souvent la majorité du volume d'une zone. Le `PipelinePost`
expose aussi deux champs optionnels exploitables côté analyst :

- `sentiment_label` / `sentiment_score` — top sentiment Gorgone si dispo.
- `translation_text` / `translation_lang` — traduction dans la locale du
  compte Gorgone si dispo.

Le LLM analyst voit ces champs comme du contexte additionnel — il n'y a
pas de court-circuit automatique. Le strategy + key_messages de la
campagne reste le seul critère de pertinence.
