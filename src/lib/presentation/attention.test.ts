import { describe, expect, it } from "vitest";
import vocabulary from "./__fixtures__/attention-vocabulary.json";
import {
  ATTENTION_REASON_META,
  ATTENTION_SCOPE_LABEL,
  ATTENTION_SEVERITY_META,
  ATTENTION_SOURCE_LABEL,
  ATTENTION_STATUS_META,
  UNKNOWN_REASON_TONE,
  attentionReasonMeta,
} from "./attention";
import {
  ATTENTION_REASONS,
  ATTENTION_SCOPES,
  ATTENTION_SEVERITIES,
  ATTENTION_SOURCES,
  ATTENTION_STATUSES,
} from "@/types";

/**
 * The vocabulary is shared with the macOS client through the JSON fixture:
 * `AttentionPresentationTests` on the Swift side asserts the same file. A
 * label or tone changed here without touching the fixture fails this test;
 * changed in the fixture without touching Swift fails theirs.
 */
describe("attention presentation vocabulary", () => {
  it("covers every wire reason, and nothing else", () => {
    expect(Object.keys(ATTENTION_REASON_META).sort()).toEqual([...ATTENTION_REASONS].sort());
    expect(Object.keys(vocabulary.reasons).sort()).toEqual([...ATTENTION_REASONS].sort());
  });

  it("matches the shared fixture for reasons", () => {
    expect(ATTENTION_REASON_META).toEqual(vocabulary.reasons);
  });

  it("matches the shared fixture for severities and statuses", () => {
    expect(Object.keys(ATTENTION_SEVERITY_META).sort()).toEqual([...ATTENTION_SEVERITIES].sort());
    expect(ATTENTION_SEVERITY_META).toEqual(vocabulary.severities);
    expect(Object.keys(ATTENTION_STATUS_META).sort()).toEqual([...ATTENTION_STATUSES].sort());
    expect(ATTENTION_STATUS_META).toEqual(vocabulary.statuses);
  });

  it("matches the shared fixture for scopes and sources", () => {
    expect(Object.keys(ATTENTION_SCOPE_LABEL).sort()).toEqual([...ATTENTION_SCOPES].sort());
    for (const scope of ATTENTION_SCOPES) {
      expect(ATTENTION_SCOPE_LABEL[scope]).toBe(vocabulary.scopes[scope].label);
    }
    expect(Object.keys(ATTENTION_SOURCE_LABEL).sort()).toEqual([...ATTENTION_SOURCES].sort());
    for (const source of ATTENTION_SOURCES) {
      expect(ATTENTION_SOURCE_LABEL[source]).toBe(vocabulary.sources[source].label);
    }
  });

  it("degrades an unknown reason to a humanised muted label", () => {
    expect(UNKNOWN_REASON_TONE).toBe(vocabulary.unknownReason.tone);
    expect(attentionReasonMeta("some_new_reason")).toEqual({ label: "Some new reason", tone: "muted" });
    expect(attentionReasonMeta("")).toEqual({ label: "Unknown", tone: "muted" });
    expect(attentionReasonMeta("needs_login")).toEqual(ATTENTION_REASON_META.needs_login);
  });
});
