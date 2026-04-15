import type { CampaignFilters, CampaignPlatform, CampaignStatus, CapacityParams } from "@/types";
import { DEFAULT_CAPACITY_PARAMS } from "@/types";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUS_CONFIG: Record<
  CampaignStatus,
  { label: string; dot: string }
> = {
  draft: { label: "Draft", dot: "bg-muted-foreground/40" },
  active: { label: "Active", dot: "bg-success" },
  paused: { label: "Paused", dot: "bg-warning" },
  archived: { label: "Archived", dot: "bg-muted-foreground/20" },
};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ArmyOption {
  id: string;
  name: string;
  avatar_count: number;
}

export interface CampaignFormData {
  // Step 1 — Basics
  name: string;
  mode: "sniper";
  platforms: CampaignPlatform[];

  // Step 2 — Gorgone Zone
  gorgone_zone_id: string;
  gorgone_zone_name: string;

  // Step 3 — Configuration
  army_ids: string[];
  filters: CampaignFilters;
  capacity_params: CapacityParams;

  // Step 4 — Guidelines
  operational_context: string;
  strategy: string;
  key_messages: string;
}

export const DEFAULT_FORM_DATA: CampaignFormData = {
  name: "",
  mode: "sniper",
  platforms: [],
  gorgone_zone_id: "",
  gorgone_zone_name: "",
  army_ids: [],
  filters: {},
  capacity_params: {
    twitter: { ...DEFAULT_CAPACITY_PARAMS.twitter },
    tiktok: { ...DEFAULT_CAPACITY_PARAMS.tiktok },
  },
  operational_context: "",
  strategy: "",
  key_messages: "",
};

export interface StepProps {
  data: CampaignFormData;
  onChange: (patch: Partial<CampaignFormData>) => void;
  accountId: string;
}

export const STEPS = [
  { id: "basics", label: "Campaign" },
  { id: "zone", label: "Data Source" },
  { id: "config", label: "Configuration" },
  { id: "guidelines", label: "Guidelines" },
] as const;
