# ATTILA V4 — Flux produit

> Complément de ARCHITECTURE.md. Décrit les flux UX/produit issus du PDF de conception.
> Ne duplique pas l'architecture technique (voir ARCHITECTURE.md pour les 4 composants,
> le modèle de données, les APIs, le streaming, la sécurité et la stack).

---

## Mobile Creation Flow

Créé hors app (terminal, scripts). L'app voit les devices via la sync gateway.

```
Entrer un proxy
  → Générer + valider proxy (manuellement)
  → IMAGE (OS)
     ├── Créer des images
     └── Créer des variables hardware + software
          ├── Variables hardware
          └── Variables software
  → Ajout en base (ID / Tags)
  → Mobile disponible
```

Après création :
1. Gateway sync 30s → détecte nouveau `db_id` → INSERT Supabase
2. Admin voit le device (`account_id = NULL`)
3. Admin attribue à un compte client
4. Client voit le device

---

## Avatar Creation Flow

Deux blocs générés par IA, puis attribution à un device.

```
AI TOOLS (LLM)
  ├── Génération Identité
  │     ├── Sélection pays
  │     ├── Nom + Prénom
  │     ├── Mail + Numéro
  │     └── Image
  │
  └── Génération Personnalité
        ├── Writing Style
        ├── Personnalité
        ├── Profile
        └── Expertise

Sélection d'un device (parmi devices attribués au client)
  → Attribution
     ├── Army liste (groupe d'avatars)
     ├── Opérateur liste
     └── Ajout en base (Supabase)
  → Avatar disponible
```

Tables : `avatars`, `avatar_accounts`, `armies`, `devices`

---

## UX — Dashboard Client

### Vues principales

```
Dashboard Client
├── Avatar Manager
│     ├── Voir mes devices attribués
│     ├── Streaming live + contrôle tactile
│     ├── Créer un avatar (identité, personnalité, style)
│     ├── Créer comptes réseaux sociaux sur le device
│     └── Lier avatar ↔ device ↔ comptes
│
└── Avatar Automator
      ├── Créer une campagne (Twitter / TikTok)
      ├── Sélectionner les avatars
      ├── Configurer règles de publication
      ├── Lancer / Pauser / Arrêter
      └── Suivre résultats temps réel
```

### Filtres (listes avatars, devices, armies)

- Dernière utilisation (défaut)
- Dernière création
- A/Z
- Utilisations

### Carte Avatar

```
┌──────────────────────────────────────┐
│  NOM + STATUT + Réseaux activés      │
│  Army | Opérateur | Statut           │
│                                      │
│  [Détacher]  [Sleep/Awake]  [ON/OFF] │
│  [Boutons natifs]                    │
└──────────────────────────────────────┘
```

### Onglets Avatar (2 colonnes de TABs)

| TAB gauche | TAB droite |
|------------|------------|
| Identité | Content |
| Personnalité | Personnalité |
| Comptes + Credentials | Setting |
| Bibliothèque d'images | |

### Onglets Mobile (détail device)

- Proxy
- Détails Software
- Détails Hardware
- Courbes + Data usage
- Overview

---

## UX — Dashboard Admin

Voir ARCHITECTURE.md pour la structure complète. Éléments UX spécifiques :

### Table Devices — Colonnes

| Colonne |
|---------|
| STATUT |
| IMEI |
| ID CLIENT |
| DATA |
| Espace disque |
| PROXY |
| ID BOX |
| ID TELEPHONE |
| IP |
| SCREEN STATUT |

### Box Creation Flow

```
Sélection box → ID BOX + IP BOX → Ajout en base → Box disponible
```

---

## Campaign Config — Étapes de configuration

Avant la Phase 1 décrite dans ARCHITECTURE.md (intelligence Worker), le client configure :

```
1. DATA source (sélection des données GORGONE)
2. Sélection zone géographique
3. Filtre par data (métriques, engagement)
4. Filtre par IA (oui ou non — activer le filtrage contextuel)
5. Guideline (instructions pour l'IA)
6. Sélection quantité
   └── Filtre disponibilité + règles d'activés (déjà utilisé)
7. Sélection « TYPE » d'avatar
8. AVATAR ID (personnalité / identité)
```

### Gestion d'indisponibilité

```
Avatar sélectionné
  ├── disponible → assigné au job
  ├── pas d'avatars dispo → Alerte → Autoriser élargissement
  └── pas d'avatars « type » dispo → Alerte → Autoriser élargissement
```

### Règles de publications (configurées par campagne)

- Délais entre chaque publication : min relais / max relais
- Durée de vie queue max
- Avatar count : minimum et maximum de réponses coordonnées
- Post avatar par jour

---

## Cartographie Campagnes (vue opérateur)

Vue multi-campagne avec posts sources et réponses.

```
Cartographie
├── Setting (global)
├── Campagne 1
│     └── Post source → Réponse 1, Réponse 2, ...
├── Campagne 2
│     └── Post source → Réponse 1, Réponse 2, ...
└── Campagne 3
      └── Post source → Réponse 1, Réponse 2, ...

DATAS (panneau latéral)
├── Data Gorgone / Estimation
├── Guideline
├── Rules
└── Health & Estimation
```

---

## Gorgone — Architecture AI Agents (MCP)

Le Worker intègre un serveur MCP avec 4 agents spécialisés et une mémoire partagée.

### Flux

```
GORGONE (plateforme externe)
  → API: posts source
  → Filtrage des posts
  → Orchestrateur
     │
     ├── Operational Context (injecté)
     │     ├── Data derniers commentaires des avatars
     │     ├── Data derniers commentaires de la zone
     │     └── Lexique et éléments de langage à jour
     │
     ├── Agent Planner
     │     ├── Input : Context (shared memory)
     │     └── Output : combien de réponses et quels avatars
     │
     ├── Agent Writer
     │     ├── Input : Personnalité (shared memory) + plan du Planner
     │     └── Output : rédaction des réponses
     │           ├── Agent avatar 1 → Réponse → INSERT job Supabase
     │           └── Agent avatar 2 → Réponse → INSERT job Supabase
     │
     ├── Agent Style
     │     └── Génère/maintient un dictionnaire de style par zone / LoRa
     │         → alimente le Lexique
     │
     └── Agent Analyst
           └── Analyse les résultats → alimente la Shared Memory
```

### Shared Memory

Mémoire partagée entre tous les agents :
- **Personnalité** : style d'écriture, ton, vocabulaire de chaque avatar
- **Context** : historique des interactions, métriques, tendances de la zone

---

## Résumé — Ce fichier vs ARCHITECTURE.md

| Sujet | Ce fichier | ARCHITECTURE.md |
|-------|-----------|-----------------|
| 4 composants (Render, Supabase, Boxes, Gateway) | — | Détaillé |
| APIs VMOS, Bridge, endpoints | — | Référence testée |
| Modèle de données (tables, colonnes, sync) | — | Complet |
| Streaming protocole (scrcpy, WebCodecs) | — | Détaillé |
| Sécurité, Auth, RBAC, RLS | — | Complet |
| Stack technique, coûts | — | Complet |
| Routage multi-box | — | Complet |
| Mobile creation flow | Détaillé | Bref |
| Avatar creation flow | Détaillé | Bref |
| UX détaillé (filtres, cartes, onglets) | Détaillé | Structure seulement |
| Campaign config (étapes, règles) | Détaillé | Phase 1/2 seulement |
| Cartographie campagnes | Détaillé | — |
| Gorgone AI Agents (MCP, 4 agents) | Détaillé | — |
| Gestion d'indisponibilité avatars | Détaillé | — |
