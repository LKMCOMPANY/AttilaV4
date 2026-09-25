import type { SlotRefusal } from "@/lib/engine/box-slots";
import { humaniseWireValue } from "./humanise";

// ---------------------------------------------------------------------------
// Slot arbiter refusals — presentation vocabulary shared by both clients.
//
// `POST /api/devices/{id}/start` answers `{ refused, refusedDetail }` when the
// arbiter (`decideSlot`) says no for a reason the operator cannot fix by
// closing a device: maintenance window, overloaded host, boot storm, box
// unreachable. One label and one tone per wire value; the Swift mirror is
// `SlotRefusalPresentation.swift`; both are pinned to
// `__fixtures__/slot-refusal-vocabulary.json`. `refusedDetail` (e.g.
// `swap 74% > 60%`) is shown verbatim as the description. Framework-free.
// ---------------------------------------------------------------------------

export type SlotRefusalTone = "critical" | "watch" | "info" | "muted";

export interface SlotRefusalMeta {
  label: string;
  tone: SlotRefusalTone;
}

export const SLOT_REFUSAL_META: Record<SlotRefusal, SlotRefusalMeta> = {
  box_unreachable: { label: "Box unreachable", tone: "critical" },
  box_full: { label: "Box full", tone: "watch" },
  operator_reserve: { label: "Slot kept for operators", tone: "info" },
  campaign_priority: { label: "Campaign has priority", tone: "info" },
  starts_in_flight: { label: "Boots in progress — retry shortly", tone: "watch" },
  box_maintenance: { label: "Box under maintenance", tone: "info" },
  box_unhealthy: { label: "Box overloaded", tone: "critical" },
  box_settling: { label: "Box settling after a restart", tone: "watch" },
};

/** Tone of a refusal this build does not know — the server may add reasons first. */
export const UNKNOWN_REFUSAL_TONE: SlotRefusalTone = "muted";

function isKnownRefusal(reason: string): reason is SlotRefusal {
  return reason in SLOT_REFUSAL_META;
}

/** Presentation of a refusal, tolerant of values newer than this build. */
export function slotRefusalMeta(reason: string): SlotRefusalMeta {
  if (isKnownRefusal(reason)) return SLOT_REFUSAL_META[reason];
  return { label: humaniseWireValue(reason, "Start refused"), tone: UNKNOWN_REFUSAL_TONE };
}
