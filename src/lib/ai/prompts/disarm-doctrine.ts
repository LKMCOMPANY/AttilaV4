/**
 * DISARM Framework — top-15 cheatsheet, Attila side.
 *
 * Vendored on 2026-05-20 from Gorgone V4
 * `packages/ai-chat/src/prompts/_shared/analytic-doctrine.ts`
 * (DISARM_TOP_15_BLOCK), itself sourced from the canonical DISARM
 * Frameworks repo (https://github.com/DISARMFoundation/DISARMframeworks)
 * — open-source MIT-licensed taxonomy adopted by EEAS, NATO StratCom,
 * DFRLab.
 *
 * Why duplicated here (and not imported from Gorgone V4)
 *   The campaign-guideline generator is a one-shot LLM call from
 *   Attila — it does not need (and should not couple to) the running
 *   `gorgoneV4-AI` service. We embed the doctrine as a static block
 *   so the prompt is reproducible without any cross-service runtime.
 *   When the Gorgone master copy moves, bump the version stamp below
 *   and re-vendor — same posture as a `package.json` lockfile.
 *
 * Source version
 *   - Gorgone V4 source file SHA verified 2026-05-20.
 *   - DISARM IDs verified against the canonical repo same day.
 *
 * Token budget
 *   ~1500 tokens including the wrapper prose.
 */

export const DISARM_TOP_15_BLOCK = `═══ DISARM TTP LENS — top 15 cheatsheet ═══
When the campaign needs to recognise or counter an adversarial
pattern, refer to a DISARM technique id so the strategy interoperates
with EEAS / NATO StratCom / DFRLab reporting. Format:
"[T0049] <one-line pattern description>".

The 15 highest-frequency techniques on social media monitoring
surfaces — non-exhaustive. When unsure of the precise id, DO NOT
INVENT — describe the pattern in plain prose without a tag.

NARRATIVE
  T0002          Facilitate State Propaganda — citizens organised
                 around pro-state messaging; paid or volunteer groups
                 pushing state lines.
  T0003          Leverage Existing Narratives — adapt messaging to
                 the target audience's bedrock narratives so it lands
                 with minimal friction.
  T0004          Develop Competing Narratives — push contradictory
                 alternatives (deny / dismiss / counter-charge) to
                 muddy the conversation, the "firehose of falsehood".
  T0010          Cultivate Ignorant Agents — "useful idiots":
                 independent actors whose own message aligns with
                 the operator's, whose reach is leveraged without
                 their awareness.

HASHTAG / CONTENT
  T0015.002      Create New Hashtag — campaign-dedicated hashtag
                 (gives the event a name, drives trending behaviour).
  T0049.002      Flood Existing Hashtag — drown a hashtag with
                 unrelated or campaign content to ruin its signal
                 (formerly "Hijack Hashtag").
  T0016          Create Clickbait — outrage / doubt / humour
                 headlines designed to maximise engagement velocity.

AMPLIFICATION
  T0049          Flood Information Space — high volume of inauthentic
                 content drowns opposing voices.
  T0049.001      Trolls Amplify and Manipulate — human trolls coordinated
                 around a campaign timeline.
  T0049.003      Bots Amplify via Automated Forwarding and Reposting —
                 automated accounts retweet / repost to boost
                 algorithmic reach.
  T0118          Amplify Existing Narrative — boost ALREADY existing
                 (often organic) content that aligns with the operator's
                 line, vs. fabricating new content.
  T0060          Continue to Amplify — sustain amplification past the
                 initial burst to keep a topic on the agenda.
  T0119          Cross-Posting — same content distributed across
                 multiple platforms simultaneously to maximise reach
                 and survive single-platform takedowns.

ATTACK
  T0048          Harass — coordinated personal attacks on a target
                 voice; often paired with T0094-style discrediting.
  T0075.001      Discredit Credible Sources — undermine voices that
                 expose or counter the operation, by attacking their
                 person rather than their content.

When you reference a TTP, ALWAYS include the id in brackets so
downstream tooling can chip-render it: "[T0049] flooding burst
14:00-15:00 UTC, multiplier 11×". When you DO NOT tag, do not write
"T0049-style" or "like flooding" — describe the pattern in plain
English. Tags are contracts, not decoration.`;

/**
 * Stable identifier of this vendored copy. Bump whenever the
 * upstream Gorgone V4 master changes; consumers can include it in
 * their `prompt_version` metadata so two runs of the generator with
 * different doctrines stay distinguishable in logs and audits.
 */
export const DISARM_DOCTRINE_VERSION = "2026-05-20";
