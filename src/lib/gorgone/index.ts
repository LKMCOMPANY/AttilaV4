// Client (Supabase service-role client to the Gorgone V4 project)
export { createGorgoneClient } from "./client";

// Directory queries (accounts + zones + active rule networks per zone)
// `GorgoneNetwork` is intentionally NOT re-exported here — it's a domain
// type that lives in `@/types` (single source of truth).
export {
  fetchGorgoneAccounts,
  fetchGorgoneZoneDirectory,
  type GorgoneAccount,
  type GorgoneZoneDirectoryRow,
} from "./directory";

// Webhook payload contract (shared with the API route + trigger)
export {
  webhookPayloadSchema,
  networkEnum,
  postKindEnum,
  type WebhookPayload,
  type PostCreatedData,
  type GorgoneWebhookNetwork,
  type GorgonePostKind,
} from "./webhook-payload";

// Ingestion (used by both the webhook route and the sweep)
export {
  enqueueGorgoneJob,
  type IngestSource,
  type IngestOutcome,
} from "./ingest";

// Full payload re-fetch (called by the pipeline when claiming a job)
export {
  fetchFullGorgonePost,
  type FullGorgonePost,
} from "./post-fetcher";

// Sweep reconciler (called from the long-running worker in server.mjs)
export { runSweepCycle, type SweepReport } from "./sweep";

// Admin operations against Gorgone (config + zone subscriptions)
export {
  getAttilaWebhookConfig,
  syncWebhookConfigToGorgone,
  upsertZoneSubscription,
  ensureZoneSubscriptions,
  deleteZoneSubscriptionsForAccount,
  type AttilaWebhookConfig,
  type ZoneSubscription,
} from "./admin-config";

// Capacity estimator
export {
  estimateZoneVolume,
  applyCampaignFilters,
  estimateCapacity,
  type ZoneVolumeWithSample,
} from "./capacity-estimator";
export type {
  EstimationWindow,
  ZoneVolumeEstimate,
  TwitterBreakdown,
  TiktokBreakdown,
  AppliedFilterRate,
  FilteredVolume,
  AvatarCapacityInput,
  CapacityEstimate,
  CampaignCapacityResult,
} from "./types";

// Tenant guard for client-supplied zone ids
export { verifyZoneAccess } from "./zone-access";
