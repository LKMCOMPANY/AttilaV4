/**
 * Cartography Types
 *
 * Data structures for the packed bubble chart that visualises
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
// Avatar node (one per avatar, used across all dimensions)
// ---------------------------------------------------------------------------

export interface ConstellationNode {
  id: string;
  label: string;
  profileImageUrl: string | null;

  clusters: Record<ClusterDimension, string>;

  automatorJobs: number;
  automatorSuccessRate: number;
  operatorCount: number;
  contentItemCount: number;
  platformCount: number;
  armyCount: number;

  avatar: ConstellationAvatarSnapshot;
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
}

// ---------------------------------------------------------------------------
// Packed bubble hierarchy types
// ---------------------------------------------------------------------------

export interface BubbleHierarchyNode {
  id: string;
  type: "root" | "cluster" | "avatar";
  label: string;
  color: string;
  value: number;
  node?: ConstellationNode;
  children?: BubbleHierarchyNode[];
}

export interface PackedBubble {
  id: string;
  type: "cluster" | "avatar";
  label: string;
  color: string;
  x: number;
  y: number;
  r: number;
  node?: ConstellationNode;
  clusterKey: string;
}

// ---------------------------------------------------------------------------
// Aggregate payload from server action
// ---------------------------------------------------------------------------

export interface CartographyData {
  nodes: ConstellationNode[];
  availableDimensions: ClusterDimension[];
  totalAvatars: number;
  totalArmies: number;
  totalCampaigns: number;
}
