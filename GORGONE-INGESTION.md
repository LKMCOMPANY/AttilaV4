# Gorgone Ingestion Module

> Push pipeline (webhook + sweep) for Twitter & TikTok data flowing
> from Gorgone into Attila V4.
> Refactored 17 avril 2026 — replaces the legacy polling design.

---

## Contexte

Gorgone est la plateforme de monitoring des réseaux sociaux. Elle
collecte les données Twitter et TikTok via des "zones" (topics) et
les stocke dans son propre Supabase.

Attila V4 a besoin de ces données **au fil de l'eau** pour son mode
Sniper : capter les posts → filtrer (rules + IA) → rédiger des
réponses → publier via les avatars (devices Android sur des box).

Ce module gère la **première étape** : capter les données de Gorgone
et les stocker dans Attila au moment exact où elles arrivent.

---

## Architecture

### Flow de bout en bout

```
┌──────────── GORGONE (Supabase) ─────────────┐
│                                             │
│  zones.push_to_attila ──┐ (toggle on/off)   │
│                         │                   │
│  twitter_tweets ─► trigger ─► function ─┐   │
│  tiktok_videos  ─► trigger ─► function ─┤   │
│                                         │   │
│                pg_net.http_post (async) │   │
│                                         ▼   │
│  integration_config:                        │
│    attila_webhook_url     (Attila V4 URL)   │
│    attila_webhook_secret  (shared secret)   │
└─────────────────────────────────────┬───────┘
                                      │ HTTPS POST + X-Webhook-Secret
                                      ▼
┌──────────── ATTILA V4 (Render) ─────────────┐
│                                             │
│  POST /api/gorgone/webhook                  │
│   1. timing-safe secret check               │
│   2. Zod parse (twitter | tiktok)           │
│   3. resolve account via gorgone_links      │
│   4. upsert gorgone_tweets|videos           │
│      ON CONFLICT(gorgone_id) DO NOTHING     │
│   5. register_gorgone_event RPC             │
│      (advances last_event_at, +counter)     │
│   6. status='pending' → claimed by pipeline │
│                                             │
│  Sweep worker (server.mjs, every 60s)       │
│   - safety net behind the webhook           │
│   - per (zone, platform): query Gorgone     │
│     since last_event_at, ingest via SAME    │
│     ingestTweet/ingestTiktok function       │
│                                             │
└─────────────────────────────────────────────┘
```

### Pourquoi le webhook (et pas le polling, ni Realtime)

- **Push, pas polling** → latence < 1 s, zéro requête à vide.
- **Webhook plutôt que Realtime Broadcast** → server-to-server, l'historique
  complet est tracé dans `net._http_response` côté Gorgone, pas de
  WebSocket à maintenir, scaling horizontal trivial.
- **Sweep en filet** → si Attila est down lors d'un déploiement Render,
  la boucle 60 s rattrape silencieusement les événements perdus
  (idempotence garantie par `UNIQUE(gorgone_id)` + cursor composite
  `(last_event_at, last_event_id)`).

---

## Tables Attila

### `gorgone_links`
Mapping `accounts ↔ Gorgone clients`. FK `account_id` → `accounts`,
CASCADE on delete. UNIQUE sur `(account_id, gorgone_client_id)`.

### `gorgone_zone_state`
Une ligne par `(account, zone, platform)`. Stocke uniquement l'**état
observé** côté Attila (l'activation vit côté Gorgone via
`zones.push_to_attila`). Champs clés :

| Colonne              | Rôle |
|----------------------|------|
| `last_event_at`      | timestamp du dernier post ingéré pour ce cursor |
| `last_event_id`      | UUID du dernier post (avec `last_event_at` forme un cursor composite anti-collision sur les bordures de batch) |
| `last_event_source`  | `webhook` ou `sweep` |
| `last_webhook_at`    | timestamp de la dernière livraison par webhook |
| `last_sweep_at`      | timestamp de la dernière livraison par sweep |
| `total_received`, `total_via_webhook`, `total_via_sweep` | compteurs informatifs |

RPC `register_gorgone_event(...)` : upsert atomique idempotent qui
n'avance le cursor que vers l'avant. Appelée à la fois par le webhook
et par le sweep.

### `gorgone_tweets` / `gorgone_tiktok_videos`
Tables d'ingestion. `gorgone_id` UNIQUE = clé de dedup. Auteur
dénormalisé. `status='pending'` à l'insertion → consommé par le
pipeline (RPC `claim_pending_post`).

---

## Code

### `src/lib/gorgone/`

| Fichier               | Rôle |
|-----------------------|------|
| `client.ts`           | Supabase client vers le projet Gorgone (service role, server-only) |
| `zones.ts`            | `fetchGorgoneClients()`, `fetchGorgoneZones()` — listing depuis Gorgone |
| `webhook-payload.ts`  | Schemas Zod du contrat webhook v2 (discriminated union `tweet.created` / `tiktok.created`) |
| `ingest.ts`           | `ingestTweet`, `ingestTiktok` — upsert idempotent + advance cursor. Source unique partagée par webhook **ET** sweep. |
| `sweep.ts`            | `runSweepCycle` — boucle de réconciliation (filet de sécurité) |
| `admin-config.ts`     | Lit/écrit `zones.push_to_attila` et `integration_config` côté Gorgone |
| `capacity-estimator.ts` | Estimateur de volume + capacité (inchangé) |
| `types.ts`            | Types du capacity estimator |
| `index.ts`            | Barrel exports |

### `src/app/actions/gorgone.ts`

| Action                       | Usage |
|------------------------------|-------|
| `getGorgoneLinks(accountId)` | Liens enrichis avec `push_to_attila` (live Gorgone) + `gorgone_zone_state` |
| `getGorgoneClients()`        | Liste les clients Gorgone disponibles |
| `linkGorgoneClient(...)`     | Crée le lien + pré-enregistre les zone states |
| `unlinkGorgoneClient(...)`   | Supprime le lien (CASCADE supprime les states) |
| `refreshGorgoneZones(...)`   | Pré-enregistre les nouvelles zones côté Attila |
| `setZonePushEnabled(...)`    | Toggle `zones.push_to_attila` côté Gorgone |
| `pushWebhookConfigToGorgone()` | Mirror URL + secret de Attila → `integration_config` Gorgone |
| `inspectWebhookConfig()`     | Lit la config webhook actuelle dans Gorgone |
| `runSweepNow()`              | Déclenche un cycle de sweep manuel |

### `src/app/api/gorgone/`

| Route               | Rôle |
|---------------------|------|
| `webhook/route.ts`  | Endpoint POST appelé par les triggers Postgres Gorgone |
| `sweep/route.ts`    | Endpoint POST appelé par le sweep worker (server.mjs) |

### `server.mjs`
Le worker `Gorgone-Sweep` tourne en continu à intervalle fixe
(`GORGONE_SWEEP_INTERVAL_MS`, défaut 60 s) et tape sur
`/api/gorgone/sweep`. Même pattern que les workers pipeline.

---

## Variables d'environnement

```
NEXT_PUBLIC_APP_URL=https://attila-yew3.onrender.com
GORGONE_SUPABASE_URL=https://rgegkezdegibgbdqzesd.supabase.co
GORGONE_SUPABASE_SERVICE_ROLE_KEY=eyJhb...
GORGONE_WEBHOOK_SECRET=<32 chars base64url>
GORGONE_SWEEP_INTERVAL_MS=60000
CRON_SECRET=<protège /api/gorgone/sweep>
```

---

## Activation (par zone)

1. Lien le client Gorgone à un account Attila depuis `/admin/accounts`.
2. Sur chaque zone listée, toggle "Live" → écrit `push_to_attila=true`
   dans Gorgone.
3. La prochaine INSERT sur `twitter_tweets`/`tiktok_videos` pour cette
   zone déclenche le webhook → ingestion immédiate dans Attila.

Pour rotater le secret webhook : changer `GORGONE_WEBHOOK_SECRET` dans
les env Render, puis cliquer "Push webhook config" dans l'admin (ou
appeler `pushWebhookConfigToGorgone`).

---

## Garanties

| Propriété | Mécanisme |
|---|---|
| **Latence < 1 s** | trigger Postgres synchrone → `pg_net` async → POST direct |
| **Zéro doublon** | `UNIQUE(gorgone_id)` + `ON CONFLICT DO NOTHING` |
| **Zéro perte** | webhook + sweep 60 s, cursor composite `(collected_at, id)` |
| **Pas de back-pressure** | `pg_net` est async, ne bloque pas l'INSERT côté Gorgone |
| **Observabilité** | tous les calls webhook tracés dans `net._http_response` Gorgone |
| **Activation par zone** | `zones.push_to_attila` (Gorgone, source de vérité) |

---

## Filtres disponibles pour les campagnes

Toutes les données nécessaires au filtrage (`src/lib/pipeline/filter.ts`)
sont incluses dans le payload webhook v2 et stockées dénormalisées dans
`gorgone_tweets` / `gorgone_tiktok_videos`. Aucune query vers Gorgone
n'est jamais nécessaire dans le pipeline.

**Twitter :** `post_type` (post/reply/retweet), `min_author_followers`,
`verified_only`, `languages`, `min_engagement`, `min_like_count`,
`min_view_count`, `min_reply_count`, `min_quote_count`, `min_retweet_count`.

**TikTok :** `exclude_ads`, `exclude_private`, `min_author_followers`,
`verified_only`, `languages`, `min_engagement`, `min_play_count`,
`min_comment_count`, `min_digg_count`, `min_share_count`, `min_collect_count`.

---

## Pipeline downstream (inchangé)

```
[1. Ingestion]  ← CE MODULE (push webhook + sweep)
[2. Filtrage par règles]   src/lib/pipeline/filter.ts
[3. Filtrage IA]           src/lib/pipeline/analyst.ts
[4. Sélection avatars]     src/lib/pipeline/avatar-selector.ts
[5. Rédaction]             src/lib/pipeline/writer.ts
[6. Publication ADB]       campaign_jobs → executor.ts
```

Le champ `status` sur `gorgone_tweets` / `gorgone_tiktok_videos`
(valeurs : `pending`, `processing`, `processed`, `filtered_out`,
`error`) est piloté par le pipeline. Le webhook insère toujours en
`pending`.
