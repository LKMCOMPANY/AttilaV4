/**
 * Network Graph Types
 *
 * Data structures for the 3D campaign cartography.
 * Concentric layout:
 *   CENTER — Zone target (Gorgone zone)
 *   MIDDLE — Source posts (campaign_posts)
 *   OUTER  — Avatars (from campaign_jobs)
 */

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

type NetworkNodeType = "zone_target" | "source_post" | "avatar";

// ---------------------------------------------------------------------------
// Link types
// ---------------------------------------------------------------------------

type NetworkLinkType = "mentions" | "reply_to";

// ---------------------------------------------------------------------------
// Job status subset used for link coloring
// ---------------------------------------------------------------------------

export type NetworkJobStatus = "done" | "failed" | "pending";

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

interface NetworkNodeMetadata {
  zoneName?: string;
  zoneId?: string;
  authorUsername?: string;
  postUrl?: string;
  postText?: string;
  engagementCount?: number;
  responseCount?: number;
  campaignName?: string;
  avatarName?: string;
  twitterHandle?: string;
  profileImageUrl?: string | null;
  platform?: string;
  status?: string;
}

export interface NetworkNode {
  id: string;
  label: string;
  type: NetworkNodeType;
  value: number;
  metadata?: NetworkNodeMetadata;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export interface NetworkLink {
  source: string;
  target: string;
  type: NetworkLinkType;
  value: number;
  status?: NetworkJobStatus;
  jobId?: string;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface NetworkStats {
  totalPosts: number;
  totalAvatars: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
  stats: NetworkStats;
}

// ---------------------------------------------------------------------------
// Client-side filter state
// ---------------------------------------------------------------------------

export interface NetworkNodeFilters {
  zoneTargets: boolean;
  sourcePosts: boolean;
  avatars: boolean;
}

export interface NetworkStatusFilters {
  done: boolean;
  failed: boolean;
  pending: boolean;
}
