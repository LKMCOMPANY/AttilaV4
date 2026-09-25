import { nativeRoute } from "@/lib/api/native-route";
import { startContainerCore } from "@/lib/operator/device-control";

/**
 * POST /api/devices/[id]/start — start the container through the slot arbiter.
 * Answers `{ atCapacity: true, max, running }` when the box is full and no
 * idle device could be auto-closed, or `{ refused, refusedDetail, max }` for
 * an arbiter refusal closing a device cannot fix (`OPERATOR_HARD_REFUSALS`);
 * both cockpits label `refused` through the shared slot-refusal vocabulary.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => startContainerCore(ctx, id));
}
