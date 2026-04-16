/**
 * Cartography Types
 *
 * Data structures for the 2D constellation map that visualises
 * the avatar fleet across multiple clustering dimensions.
 */

// ---------------------------------------------------------------------------
// Clustering dimensions
// ---------------------------------------------------------------------------

export const CLUSTER_DIMENSIONS = [
  "army",
  "status",
  "identity",
  "personality",
  "operator_usage",
  "automator_usage",
  "platform",
  "device",
] as const;

export type ClusterDimension = (typeof CLUSTER_DIMENSIONS)[number];

export interface ClusterDimensionConfig {
  id: ClusterDimension;
  label: string;
  description: string;
}

export const DIMENSION_CONFIGS: ClusterDimensionConfig[] = [
  { id: "army", label: "Army", description: "Grouped by army membership" },
  { id: "status", label: "Status", description: "Grouped by avatar status" },
  { id: "identity", label: "Identity", description: "Grouped by country & language" },
  { id: "personality", label: "Personality", description: "Grouped by writing style & tone" },
  { id: "operator_usage", label: "Operator", description: "Grouped by assigned operator" },
  { id: "automator_usage", label: "Automator", description: "Grouped by campaign" },
  { id: "platform", label: "Platform", description: "Grouped by active social platforms" },
  { id: "device", label: "Device", description: "Grouped by device assignment status" },
];

// ---------------------------------------------------------------------------
// Constellation node (one per avatar)
// ---------------------------------------------------------------------------

export interface ConstellationNode {
  id: string;
  label: string;
  profileImageUrl: string | null;

  // Cluster keys per dimension (precomputed server-side)
  clusters: Record<ClusterDimension, string>;

  // Metrics for sizing / detail
  automatorJobs: number;
  automatorSuccessRate: number;
  operatorCount: number;
  contentItemCount: number;
  platformCount: number;
  armyCount: number;

  // Avatar snapshot for the detail panel
  avatar: ConstellationAvatarSnapshot;

  // Simulation coordinates (set by d3-force)
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface ConstellationAvatarSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  profileImageUrl: string | null;
  countryCode: string;
  languageCode: string;
  status: string;
  writingStyle: string;
  tone: string;
  vocabularyLevel: string;
  emojiUsage: string;
  personalityTraits: string[];
  topicsExpertise: string[];
  tags: string[];
  twitterEnabled: boolean;
  tiktokEnabled: boolean;
  redditEnabled: boolean;
  instagramEnabled: boolean;
  deviceId: string | null;
  deviceState: string | null;
  armies: { id: string; name: string }[];
  operators: { id: string; name: string }[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Cluster metadata (one per group within a dimension)
// ---------------------------------------------------------------------------

export interface ClusterGroup {
  key: string;
  label: string;
  color: string;
  nodeCount: number;
  centroidX?: number;
  centroidY?: number;
}

// ---------------------------------------------------------------------------
// Aggregate payload from server action
// ---------------------------------------------------------------------------

export interface CartographyData {
  nodes: ConstellationNode[];
  totalAvatars: number;
  totalArmies: number;
  totalCampaigns: number;
}
