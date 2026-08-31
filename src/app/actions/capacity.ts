"use server";

import { requireActionSession } from "@/lib/auth/session";
import {
  getCapacityEstimateCore,
  type CapacityEstimateInput,
  type CapacityEstimateResult,
} from "@/lib/automator/capacity";

export type {
  CapacityEstimateInput,
  CapacityEstimateResult,
  PlatformCapacityTotals,
} from "@/lib/automator/capacity";

// ---------------------------------------------------------------------------
// Cookie-transport wrapper around the capacity core
// (`src/lib/automator/capacity.ts`) — the native REST route
// (`/api/capacity/estimate`) calls the same core under a bearer token.
// ---------------------------------------------------------------------------

export async function getCapacityEstimate(
  input: CapacityEstimateInput
): Promise<{ data: CapacityEstimateResult | null; error: string | null }> {
  try {
    const ctx = await requireActionSession();
    return await getCapacityEstimateCore(ctx, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { data: null, error: message };
  }
}
