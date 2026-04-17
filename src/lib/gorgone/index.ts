// Client
export { createGorgoneClient } from "./client";

// Directory queries
export { fetchGorgoneClients, fetchGorgoneZones } from "./zones";
export type { GorgoneClient, GorgoneZone } from "./zones";

// Webhook payload contract (shared with the API route)
export {
  webhookPayloadSchema,
  type WebhookPayload,
  type TweetPayloadData,
  type TiktokPayloadData,
} from "./webhook-payload";

// Ingestion (used by both the webhook route and the sweep)
export {
  ingestTweet,
  ingestTiktok,
  type IngestSource,
  type IngestOutcome,
} from "./ingest";

// Sweep reconciler (called from the long-running worker in server.mjs)
export { runSweepCycle, type SweepReport } from "./sweep";

// Admin operations against Gorgone (zones flag + integration_config)
export {
  getAttilaWebhookConfig,
  syncWebhookConfigToGorgone,
  setZonePushToAttila,
  getZonePushStates,
  type AttilaWebhookConfig,
} from "./admin-config";

// Capacity estimator (unchanged)
export {
  estimateZoneVolume,
  applyFilters,
  estimateCapacity,
} from "./capacity-estimator";
export type {
  ZoneVolumeEstimate,
  TwitterBreakdown,
  TiktokBreakdown,
  EstimatorFilters,
  FilteredVolume,
  AvatarCapacityInput,
  CapacityEstimate,
  CampaignCapacityResult,
} from "./types";
