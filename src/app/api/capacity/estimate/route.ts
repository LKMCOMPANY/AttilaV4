import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { getCapacityEstimateCore, type CapacityEstimateInput } from "@/lib/automator/capacity";
import { capacityEstimateBodySchema } from "@/lib/validation/automator";

/**
 * POST /api/capacity/estimate — zone volume × real pipeline filters ×
 * army capacity (native transport of the `getCapacityEstimate` server
 * action; Gorgone volume queries are server-side only). Answers
 * `{ data: CapacityEstimateResult | null, error: string | null }`.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  return nativeRoute(request, async (ctx) => {
    const parsed = capacityEstimateBodySchema.safeParse(body);
    if (!parsed.success) {
      return { data: null, error: parsed.error.issues[0].message };
    }
    return getCapacityEstimateCore(ctx, parsed.data as CapacityEstimateInput);
  });
}
