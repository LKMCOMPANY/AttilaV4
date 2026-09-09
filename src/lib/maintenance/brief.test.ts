import { describe, expect, it } from "vitest";
import { buildBriefPrompt } from "./brief";

const persona = {
  id: "a1",
  account_id: "acc",
  first_name: "Lena",
  last_name: "Marchal",
  country_code: "FR",
  language_code: "fr",
  writing_style: "casual",
  tone: "neutral",
  vocabulary_level: "standard",
  emoji_usage: "sparse",
  personality_traits: ["curieuse", "directe"],
  topics_expertise: ["cinéma", "cuisine"],
  topics_avoid: ["politique", "football"],
} as const;

/**
 * The prompt is the whole contract with the model: it must carry every
 * persona field and every army objective verbatim, ask for the contradictions
 * rather than their resolution, and never leak an objective that was not
 * written.
 */
describe("effective brief prompt", () => {
  it("carries the persona and the objectives, and asks for contradictions only", () => {
    const { system, user } = buildBriefPrompt({ ...persona, personality_traits: [...persona.personality_traits], topics_expertise: [...persona.topics_expertise], topics_avoid: [...persona.topics_avoid] } as never, [
      { army_id: "army-1", name: "Foot FR", objective: "Se clusteriser dans le football français, soutenir Mbappé", cluster_keywords: ["Ligue 1", "PSG"] },
    ]);
    expect(user).toContain("Lena Marchal");
    expect(user).toContain("Avoids: politique, football");
    expect(user).toContain("Foot FR: Se clusteriser dans le football français, soutenir Mbappé — clusters: Ligue 1, PSG");
    expect(system).toContain("Never resolve a contradiction yourself");
    expect(system).toContain('"contradictions"');
  });

  it("says so when the avatar belongs to no army", () => {
    const { user } = buildBriefPrompt({ ...persona, personality_traits: [], topics_expertise: [], topics_avoid: [] } as never, []);
    expect(user).toContain("ARMY OBJECTIVES (0)");
    expect(user).toContain("(none — the brief is the persona alone)");
    expect(user).toContain("Traits: —");
  });
});
