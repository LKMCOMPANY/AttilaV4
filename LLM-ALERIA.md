# LLM Aleria — Référence technique

> Documentation du LLM Aleria pour les agents Attila V4.
> Testé en live le 15 avril 2026.

---

## Endpoint d'inférence

| Paramètre | Valeur |
|-----------|--------|
| Base URL | `https://inference.aleria.com/v1` |
| Auth header | `Authorization: Bearer {ALERIA_API_KEY}` |
| Protocole | OpenAI-compatible API |
| Coût | **Gratuit** (infrastructure privée) |

### Variables d'environnement

```
ALERIA_API_KEY=jerome-YDhHeYTV4Aj8NdBxVBdJd1qv1paEctth4bXaGuujsllSP4yx7adFNjAVrHOhhN05
ALERIA_BASE_URL=https://inference.aleria.com/v1
```

---

## Modèles disponibles

| Model ID | Usage | Testé |
|----------|-------|-------|
| `aleria` | Chat, génération de texte, embeddings (4096 dim) | ✅ |
| `aleria-vl` | Vision (analyse d'images/screenshots) | ✅ |
| `aleria_thinking` | Reasoning explicite | Non testé |
| `aleria-asr` | Speech recognition | Non testé |
| `qwen-qwq` | Qwen reasoning | Non testé |
| `nemotron` / `nemotron3-super-120b` | Nemotron | Non testé |
| `qwen-image` / `qwen-image-edit` | Génération/édition d'images | Non testé |
| `wan22` | Vidéo | Non testé |
| `whisper` | Transcription audio | Non testé |
| `embedding` | Embeddings dédiés | Non testé |

---

## Endpoints HTTP

| Route | Méthode | Description |
|-------|---------|-------------|
| `/v1/models` | GET | Liste des modèles disponibles |
| `/v1/chat/completions` | POST | Génération de texte / chat |
| `/v1/embeddings` | POST | Vecteurs d'embeddings |

---

## Comportement du modèle `aleria`

### Reasoning par défaut

Le modèle `aleria` fait du **thinking/reasoning automatique**. La réponse est structurée en deux champs :

```json
{
  "choices": [{
    "message": {
      "content": "La réponse finale",           // ← ce qu'on utilise
      "reasoning_content": "Le raisonnement..."  // ← la réflexion interne
    }
  }]
}
```

**Point critique** : le reasoning consomme des tokens. Si `max_tokens` est trop bas,
tout est consommé par le reasoning et `content` reste `null`.

| max_tokens | Résultat |
|------------|----------|
| 50-200 | `content: null` — le reasoning mange tous les tokens |
| 500 | Fonctionne pour des réponses courtes (JSON, une phrase) |
| 1000+ | Fonctionne pour des réponses détaillées |

**Recommandation : toujours mettre `max_tokens: 1000` minimum.**

### Latences mesurées

| Tâche | max_tokens | Latence |
|-------|------------|---------|
| Réponse simple ("dis bonjour") | 1000 | ~11s |
| Analyse UI dump (trouver un bouton) | 500 | ~12s |
| Analyse UI complexe (scénario complet) | 800 | ~38s |
| Vision (analyse screenshot) | 1000 | ~9s |

Le reasoning est la cause principale de la latence. Le modèle réfléchit longuement
avant de répondre, même pour des questions simples.

---

## Usage dans Attila V4

### Rôle : Worker Render (Phase 1 — Intelligence)

Le LLM Aleria est utilisé **uniquement dans le Worker**, pas dans le Gateway.

```
GORGONE détecte un post
    ↓
Aleria filtre : "ce post mérite une réponse ?"
    ↓
Aleria choisit les avatars qui doivent répondre
    ↓
Aleria rédige le commentaire (style propre à chaque avatar)
    ↓
INSERT campaign_job (texte prêt à poster)
    ↓
Le Gateway exécute via ADB (script déterministe, pas de LLM)
```

### Pas de LLM côté Gateway

Le flow d'exécution ADB est **100% déterministe** grâce à l'URL `intent/post`.
Pas besoin de LLM pour naviguer, trouver des boutons, ou interpréter l'écran.

### Fallback LLM vision (futur, optionnel)

Si un état imprévu apparaît (CAPTCHA, popup inconnu), on pourrait envoyer
un screenshot au modèle `aleria-vl` pour diagnostiquer. Mais c'est du fallback,
pas le flow principal.

---

## Exemples d'appels

### Chat completion — Rédiger un commentaire

```bash
curl -X POST "https://inference.aleria.com/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALERIA_API_KEY" \
  -d '{
    "model": "aleria",
    "messages": [
      {
        "role": "system",
        "content": "Tu es un avatar Twitter nommé Paul. Tu commentes des tweets de manière naturelle, en français familier. Tu utilises parfois des emojis. Tes réponses font 1-2 phrases max."
      },
      {
        "role": "user",
        "content": "Tweet de @JustRocketMan: every time I hear \"Epic Fury\" (image de Furbys en costume). Rédige un commentaire."
      }
    ],
    "max_tokens": 1000
  }'
```

### Chat completion — Filtrage contextuel

```bash
curl -X POST "https://inference.aleria.com/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALERIA_API_KEY" \
  -d '{
    "model": "aleria",
    "messages": [
      {
        "role": "system",
        "content": "Tu es un filtre de campagne. On te donne un tweet. Réponds UNIQUEMENT par JSON: {\"relevant\": true/false, \"reason\": \"...\"}"
      },
      {
        "role": "user",
        "content": "Campagne: commenter les tweets politiques français.\nTweet: @EmmanuelMacron: Yesterday I spoke with Iranian President...\nCe tweet est-il pertinent pour la campagne ?"
      }
    ],
    "max_tokens": 1000
  }'
```

### Vision — Analyser un screenshot (fallback)

```bash
curl -X POST "https://inference.aleria.com/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALERIA_API_KEY" \
  -d '{
    "model": "aleria-vl",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Screenshot Android 1080x2340. Quel écran est affiché ? Y a-t-il un CAPTCHA ou une erreur ?"},
          {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,{BASE64_IMG}"}}
        ]
      }
    ],
    "max_tokens": 1000
  }'
```

---

## Code TypeScript — Client Aleria

```typescript
interface AleriaMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface AleriaResponse {
  id: string;
  choices: Array<{
    message: {
      content: string | null;
      reasoning_content: string | null;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function askAleria(
  messages: AleriaMessage[],
  model: string = "aleria",
  maxTokens: number = 1000
): Promise<string> {
  const res = await fetch("https://inference.aleria.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.ALERIA_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  });

  const data: AleriaResponse = await res.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error(
      "Aleria returned null content — increase max_tokens (reasoning consumed all tokens)"
    );
  }

  return content;
}

async function askAleriaVision(
  prompt: string,
  imageBase64: string
): Promise<string> {
  return askAleria(
    [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    }],
    "aleria-vl",
    1000
  );
}
```

---

## Parsing de la réponse

Le champ `content` peut contenir du JSON wrappé dans des backticks markdown :

```
```json
{"tap":[500,1740]}
```
```

Pour parser proprement :

```typescript
function parseAleriaJSON<T>(content: string): T {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}
```

---

## Limites et points d'attention

| Limite | Détail |
|--------|--------|
| Reasoning obligatoire | Le modèle `aleria` fait toujours du thinking, ce qui consomme des tokens et ajoute de la latence |
| `max_tokens` minimum | Mettre 1000+ sinon `content` est `null` |
| Latence | 10-40 secondes selon la complexité (le reasoning est la cause) |
| Pas de streaming observé | Non testé, mais l'API est OpenAI-compatible donc devrait supporter `stream: true` |
| Vision lente | `aleria-vl` prend ~9s même pour une question simple sur un screenshot |

---

## Résumé

| Question | Réponse |
|----------|---------|
| Quel modèle pour rédiger des commentaires ? | `aleria` |
| Quel modèle pour analyser des screenshots ? | `aleria-vl` |
| Faut-il un LLM dans le gateway ? | **Non** — le flow ADB est déterministe |
| Coût ? | **Gratuit** (infrastructure privée) |
| `max_tokens` recommandé ? | **1000 minimum** |
| Format de réponse ? | `response.choices[0].message.content` (ignorer `reasoning_content`) |
