import {
  Shield,
  Activity,
  Globe,
  Brain,
  UserCog,
  Zap,
  Share2,
  Smartphone,
} from "lucide-react";
import type { ClusterDimension } from "@/types/cartography";

export const DIMENSION_ICONS: Record<ClusterDimension, React.ElementType> = {
  army: Shield,
  status: Activity,
  identity: Globe,
  personality: Brain,
  operator_usage: UserCog,
  automator_usage: Zap,
  platform: Share2,
  device: Smartphone,
};
