import { generateText } from "ai";
import { z } from "zod";
import { parseAleriaJSONWithSchema } from "@/lib/ai/aleria-json";
import { getAleriaModel } from "@/lib/ai/client";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Avatar, AvatarBrief, BriefContradiction } from "@/types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The effective brief: what this avatar is for, in one page, compiled from
 * its persona and the objectives of the armies it belongs to. Contradictions
 * (a persona that avoids football in an army that must cluster around
 * Ligue 1) are listed for the operator, never resolved silently. Phase 3's
 * cluster candidates and organic replies read this text; phase 1 only shows it.
 */

const briefSchema = z.object({
  brief: z.string().min(20).max(2400),
  contradictions: z
    .array(z.object({ between: z.string().min(1).max(120), detail: z.string().min(1).max(400) }))
    .max(12),
});

const BRIEF_MAX_TOKENS = 1_800;
const BRIEF_TIMEOUT_MS = 60_000;

type PersonaRow = Pick<
  Avatar,
  | "id"
  | "account_id"
  | "first_name"
  | "last_name"
  | "country_code"
  | "language_code"
  | "writing_style"
  | "tone"
  | "vocabulary_level"
  | "emoji_usage"
  | "personality_traits"
  | "topics_expertise"
  | "topics_avoid"
>;

interface ArmyObjective {
  army_id: string;
  name: string;
  objective: string;
  cluster_keywords: string[];
}

export interface CompiledBrief {
  brief: string;
  contradictions: BriefContradiction[];
  sources: { armies: string[]; persona_version: string };
}

/** Pure prompt assembly — tested without a model. */
export function buildBriefPrompt(persona: PersonaRow, objectives: ArmyObjective[]): { system: string; user: string } {
  const system = [
    "You compile the operating brief of a social-media persona operated by an agency.",
    "Write in the persona's language. Be concrete: who they are, what they care about, how they write,",
    "which communities they should sit in, what they never touch. Under 900 characters for the brief.",
    "Then list every contradiction between the persona and the objectives — a topic in `avoid` that an",
    "objective requires, a tone that clashes with a community, a country that makes a cluster implausible.",
    "Never invent objectives. Never resolve a contradiction yourself: name it.",
    'Answer with JSON only: {"brief": string, "contradictions": [{"between": string, "detail": string}]}.',
  ].join(" ");

  const user = [
    `PERSONA`,
    `Name: ${persona.first_name} ${persona.last_name}`,
    `Country: ${persona.country_code} — language: ${persona.language_code}`,
    `Writing: ${persona.writing_style}, tone ${persona.tone}, vocabulary ${persona.vocabulary_level}, emoji ${persona.emoji_usage}`,
    `Traits: ${persona.personality_traits.join(", ") || "—"}`,
    `Expertise: ${persona.topics_expertise.join(", ") || "—"}`,
    `Avoids: ${persona.topics_avoid.join(", ") || "—"}`,
    ``,
    `ARMY OBJECTIVES (${objectives.length})`,
    ...(objectives.length === 0
      ? ["(none — the brief is the persona alone)"]
      : objectives.map((o) => `- ${o.name}: ${o.objective || "(no objective written)"}${o.cluster_keywords.length ? ` — clusters: ${o.cluster_keywords.join(", ")}` : ""}`)),
  ].join("\n");

  return { system, user };
}

/** Compile and persist the effective brief of one avatar. Returns the stored row. */
export async function compileAvatarBrief(supabase: AdminClient, avatarId: string, compiledBy: string | null): Promise<AvatarBrief> {
  const { data: persona, error } = await supabase
    .from("avatars")
    .select(
      "id, account_id, first_name, last_name, country_code, language_code, writing_style, tone, vocabulary_level, emoji_usage, personality_traits, topics_expertise, topics_avoid",
    )
    .eq("id", avatarId)
    .single();
  if (error || !persona) throw new Error(`avatar ${avatarId}: ${error?.message ?? "not found"}`);

  const { data: memberships } = await supabase
    .from("avatar_armies")
    .select("army:armies(id, name, brief:army_briefs(objective, cluster_keywords))")
    .eq("avatar_id", avatarId);

  const objectives: ArmyObjective[] = [];
  for (const row of (memberships ?? []) as unknown as Array<{ army: { id: string; name: string; brief: { objective: string; cluster_keywords: string[] } | { objective: string; cluster_keywords: string[] }[] | null } | null }>) {
    if (!row.army) continue;
    const brief = Array.isArray(row.army.brief) ? row.army.brief[0] : row.army.brief;
    objectives.push({
      army_id: row.army.id,
      name: row.army.name,
      objective: brief?.objective ?? "",
      cluster_keywords: brief?.cluster_keywords ?? [],
    });
  }

  const compiled = await compileWithModel(persona as PersonaRow, objectives);
  const { data: stored, error: upsertError } = await supabase
    .from("avatar_briefs")
    .upsert(
      {
        avatar_id: avatarId,
        effective_brief: compiled.brief,
        contradictions: compiled.contradictions,
        sources: compiled.sources,
        compiled_at: new Date().toISOString(),
        compiled_by: compiledBy,
      },
      { onConflict: "avatar_id" },
    )
    .select("*")
    .single();
  if (upsertError || !stored) throw new Error(`avatar_briefs upsert: ${upsertError?.message ?? "no row"}`);
  return stored as AvatarBrief;
}

async function compileWithModel(persona: PersonaRow, objectives: ArmyObjective[]): Promise<CompiledBrief> {
  const { system, user } = buildBriefPrompt(persona, objectives);
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Brief compilation timed out")), BRIEF_TIMEOUT_MS),
  );
  const { text } = await Promise.race([
    generateText({ model: getAleriaModel("aleria"), system, prompt: user, maxOutputTokens: BRIEF_MAX_TOKENS }),
    timeout,
  ]);
  const parsed = parseAleriaJSONWithSchema(text, briefSchema);
  return {
    brief: parsed.brief.trim(),
    contradictions: parsed.contradictions,
    sources: { armies: objectives.map((o) => o.army_id), persona_version: `${persona.id}` },
  };
}
