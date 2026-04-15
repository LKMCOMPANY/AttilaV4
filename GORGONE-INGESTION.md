# Gorgone Ingestion Module

> Module d'ingestion des données Twitter et TikTok depuis Gorgone vers Attila V4.
> Implémenté et testé le 15 avril 2026. Capacity Estimator mis à jour le 15 avril 2026.

---

## Contexte

Gorgone est la plateforme de monitoring des réseaux sociaux. Elle collecte les données Twitter et TikTok par batch via des règles API configurées dans des "zones" (topics).

Attila V4 a besoin de ces données pour le mode Sniper de l'automator : capter les posts → filtrer → décider via IA → rédiger des réponses → publier via les avatars.

Ce module gère la **première étape** : capter les données de Gorgone et les stocker dans Attila.

---

## Architecture

### Deux projets Supabase distincts

```
Gorgone Supabase (lecture seule)          Attila V4 Supabase
─────────────────────────────             ──────────────────
twitter_tweets      (4.6M rows)    →      gorgone_tweets
twitter_profiles    (1.4M rows)           gorgone_tiktok_videos
tiktok_videos       (33.8K rows)   →      gorgone_links
tiktok_profiles     (18.7K rows)          gorgone_sync_cursors
zones               (66 rows)
clients             (17 rows)
```

Les bases ne sont **pas connectées**. L'application fait le pont :
1. Se connecte à Gorgone via un Supabase client (service role, lecture seule)
2. Query les nouveaux posts depuis le dernier cursor
3. Upsert dans les tables Attila avec dedup

### Sync incrémentale par cursor

Chaque zone/plateforme a un cursor (`gorgone_sync_cursors`) qui stocke le `collected_at` du dernier row synchronisé.

```
Premier sync : WHERE collected_at >= now()     → 0 rows (démarre au présent)
Sync suivant : WHERE collected_at > cursor     → nouveaux posts seulement
Pas de données : query retourne 0 rows         → cursor ne bouge pas
Erreur : cursor ne bouge pas                   → prochain cycle re-essaie
```

Batch de 500 rows max par sync. Dedup garanti par `UNIQUE(gorgone_id)` + `ON CONFLICT DO NOTHING`.

### Données dénormalisées

Les tweets/vidéos sont stockés avec les infos auteur (username, followers, verified) dénormalisées au moment du sync. Le JOIN avec `twitter_profiles`/`tiktok_profiles` est fait côté Gorgone, une seule fois. Aucune query cross-DB ensuite.

---

## Mapping des comptes

Un compte Attila peut être lié à **plusieurs** clients Gorgone (relation 1:N).

```
accounts (Attila)
  └── gorgone_links (1:N)
        ├── gorgone_client_id → clients.id (Gorgone)
        └── gorgone_sync_cursors (1:N par zone par plateforme)
              ├── zone_id → zones.id (Gorgone)
              └── platform: 'twitter' | 'tiktok'
```

L'admin lie les comptes dans `/admin/accounts` > détail du compte > section Gorgone.

---

## Tables Attila

### `gorgone_links`
Mapping comptes. FK `account_id` → `accounts`, CASCADE on delete. UNIQUE sur `(account_id, gorgone_client_id)`.

### `gorgone_sync_cursors`
Un cursor par zone par plateforme. FK `gorgone_link_id` → `gorgone_links`, CASCADE on delete. Colonnes clés : `last_cursor` (timestamptz), `total_synced` (bigint), `status` (idle/syncing/error), `error_message`.

### `gorgone_tweets`
Tweets ingérés. `gorgone_id` (UNIQUE) = l'UUID du tweet dans Gorgone, clé de dedup. Auteur dénormalisé (`author_username`, `author_followers`, `author_verified`, etc.). Index sur `(zone_id, collected_at DESC)` et `(account_id, status)`.

### `gorgone_tiktok_videos`
Vidéos TikTok ingérées. Même pattern que les tweets. Champs spécifiques : `play_count`, `digg_count`, `share_url`, etc.

### RLS
Chaque table : admin full access + account members read own (filtré par `account_id`).

---

## Code

### `src/lib/gorgone/` — Module pur (pas de framework)

| Fichier | Rôle |
|---------|------|
| `client.ts` | Client Supabase Gorgone (service role, server-only) |
| `types.ts` | Types des données brutes Gorgone (GorgoneRawTweetRow, GorgoneRawTiktokVideoRow, GorgoneClient, GorgoneZone) |
| `sync-core.ts` | Moteur de sync générique `executeCursorSync<T>()` — une seule implémentation pour Twitter et TikTok |
| `sync-tweets.ts` | SELECT + mapping Twitter → appelle sync-core |
| `sync-tiktok.ts` | SELECT + mapping TikTok → appelle sync-core |
| `sync-zones.ts` | `fetchGorgoneClients()` et `fetchGorgoneZones()` — listing depuis Gorgone |
| `index.ts` | Barrel exports |

### `src/app/actions/gorgone.ts` — Server Actions

| Action | Usage |
|--------|-------|
| `getGorgoneLinks(accountId)` | Charge liens + cursors pour l'UI admin |
| `getGorgoneClients()` | Liste les clients Gorgone pour le dialog de linking |
| `linkGorgoneClient(...)` | Crée le lien + cursors pour chaque zone/plateforme |
| `unlinkGorgoneClient(linkId)` | Supprime le lien (CASCADE supprime cursors) |
| `refreshGorgoneZones(linkId)` | Détecte et ajoute les nouvelles zones sans toucher aux existantes |
| `toggleZoneSync(cursorId, isActive)` | Active/désactive un cursor |
| `triggerManualSync(cursorId)` | Lance un sync immédiat |

### `src/app/api/gorgone/sync/route.ts` — Cron endpoint

`POST` protégé par `Authorization: Bearer {CRON_SECRET}`.
1. Auto-discover : détecte les nouvelles zones pour chaque lien actif
2. Sync : itère tous les cursors actifs et lance les syncs
3. Retourne un rapport JSON

### `src/components/admin/` — UI

| Composant | Rôle |
|-----------|------|
| `gorgone-section.tsx` | Section dans AccountDetail avec liens, zones groupées, refresh, unlink |
| `gorgone-link-dialog.tsx` | Dialog pour lier un client Gorgone (Select avec clients disponibles) |
| `gorgone-zone-item.tsx` | Zone groupée avec cursors par plateforme (toggle, sync now, status) |

---

## Variables d'environnement

```
GORGONE_SUPABASE_URL=https://rgegkezdegibgbdqzesd.supabase.co
GORGONE_SUPABASE_SERVICE_ROLE_KEY=eyJhb...
CRON_SECRET=<secret pour protéger l'endpoint sync>
```

---

## Cron (à configurer au déploiement)

Appeler `POST /api/gorgone/sync` avec le header `Authorization: Bearer {CRON_SECRET}`.

- Twitter : toutes les 30 secondes (aligné avec la cadence de collecte Gorgone ~60-100s)
- TikTok : toutes les 5 minutes (Gorgone collecte toutes les 60min)

Le endpoint traite les deux plateformes en un seul appel. Un seul cron suffit.

---

## Points d'attention pour les prochains développements

### Volumes Gorgone (avril 2026)

| Table | Rows | Cadence |
|-------|-----:|---------|
| `twitter_tweets` | 4.6M | ~2.2K/jour/zone active |
| `tiktok_videos` | 33.8K | ~500/semaine/zone |
| `twitter_profiles` | 1.4M | — |
| `tiktok_profiles` | 18.7K | — |

### Pas d'historique

Les cursors démarrent à `now()`. On ne sync que les posts arrivés **après** le linking. L'automator répond en temps réel, pas besoin de rattraper l'historique.

### Dedup garantie

Double protection : cursor strict `>` + `UNIQUE(gorgone_id)` avec `ON CONFLICT DO NOTHING`. Même si le même batch est re-synced (crash, retry), zero doublon.

### Scalabilité

- Un cursor par zone par plateforme = parallélisable
- Le code dans `lib/gorgone/` est du TypeScript pur, déplaçable vers un worker dédié sans modification
- Batch de 500 rows max : si plus de 500 en attente, les prochains cycles rattrapent

### Filtres disponibles pour les campagnes

Toutes les données nécessaires au filtrage sont déjà ingérées. Aucune query vers Gorgone nécessaire.

**Twitter :**

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Post type (post original) | `is_reply = false AND text NOT LIKE 'RT @%'` | Exclure replies et RT |
| Post type (reply) | `is_reply = true` | Seulement les réponses |
| Post type (retweet) | `text LIKE 'RT @%'` | Seulement les RT |
| Min followers auteur | `author_followers >= N` | `>= 100` |
| Verified only | `author_verified = true` | Comptes vérifiés |
| Langue | `lang IN ('en', 'fr')` | Cibler des langues |
| Min engagement | `total_engagement >= N` | `>= 50` |
| Min likes / views | `like_count >= N`, `view_count >= N` | Seuils spécifiques |

**TikTok :**

| Filtre | Champ | Exemple |
|--------|-------|---------|
| Min followers auteur | `author_followers >= N` | `>= 100` |
| Verified only | `author_verified = true` | Comptes vérifiés |
| Exclure comptes privés | `author_is_private = false` | Ne peut pas commenter |
| Exclure les pubs | `is_ad = false` | Pas de réponse aux ads |
| Langue | `language IN ('en', 'fr')` | Cibler des langues |
| Min plays | `play_count >= N` | `>= 1000` |
| Min engagement | `total_engagement >= N` | `>= 100` |
| Min comments | `comment_count >= N` | Vidéos commentées |

### Capacity Estimator

Module intégré dans l'automator qui estime le volume de posts d'une zone, applique les filtres de campagne, et calcule le besoin en avatars vs la capacité disponible — **par réseau** (Twitter et TikTok séparément).

**Architecture :**

```
lib/gorgone/capacity-estimator.ts    — moteur de calcul pur (3 fonctions composables)
app/actions/capacity.ts              — server action (auth, filtrage avatars par réseau, orchestration)
components/campaigns/capacity-estimator.tsx — composant UI par plateforme
```

**3 fonctions composables (moteur) :**

1. `estimateZoneVolume(zoneId, platform)` — query Gorgone pour le volume brut sur les dernières 24h de données disponibles (fenêtre adaptative, pas NOW()) avec breakdown par type de post, langues, stats auteurs
2. `applyFilters(volume, filters)` — calcul pur : applique les filtres de campagne et retourne le taux de passage et le volume filtré/heure
3. `estimateCapacity(filtered, avatarParams)` — calcul pur : double contrainte horaire/journalière, calcule avatars nécessaires, manquants, bottleneck

**Server action `getCapacityEstimate` :**

- Reçoit les `capacity_params` par réseau depuis la table `campaigns` (JSONB)
- Pour chaque plateforme : filtre les avatars par `twitter_enabled` / `tiktok_enabled`, calcule le volume, applique les filtres, estime la capacité avec les params spécifiques au réseau
- Retourne un résultat par plateforme (volume, filtré, capacité, avatars nécessaires)

**Paramètres par réseau (stockés en DB, colonne `capacity_params` JSONB) :**

```typescript
capacity_params: {
  twitter: { max_responses_per_hour: 5, max_responses_per_day: 50, min_avatars_per_post: 1, max_avatars_per_post: 3 },
  tiktok:  { max_responses_per_hour: 3, max_responses_per_day: 30, min_avatars_per_post: 1, max_avatars_per_post: 2 },
}
```

**Calcul de capacité (par réseau) :**

- `avg_avatars_per_post = (min + max) / 2`
- `blocked_rate` calculé automatiquement depuis le status des avatars (pas un input manuel)
- `avatars_needed = max(ceil(need_hourly / max_per_hour), ceil(need_daily / max_per_day))` — le bottleneck le plus contraint gagne
- `avatars_missing = max(0, avatars_needed - available_avatars)`

**UI :** intégrée dans le settings panel de l'automator et dans le wizard de création de campagne. Un bloc par réseau actif avec les métriques (volume brut, filtré, réponses/h) et les 4 paramètres éditables.

### Prochaines étapes (pipeline automator)

```
[1. Ingestion]  ← CE MODULE (fait)
[2. Filtrage par règles]  — engagement min, type de post, followers, langue
[3. Filtrage IA]  — guideline, pertinence, décision
[4. Rédaction]  — réponses par avatar avec personnalité
[5. Publication]  — scripts ADB via gateway (scripts existants)
```

Le champ `status` sur `gorgone_tweets` et `gorgone_tiktok_videos` (valeurs : `pending`, `processed`, `filtered_out`, `error`) est prévu pour le pipeline. L'étape 2 mettra à jour ce status.
