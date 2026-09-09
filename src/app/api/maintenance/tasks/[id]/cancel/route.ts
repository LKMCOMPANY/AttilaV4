import { nativeRoute } from "@/lib/api/native-route";
import { cancelMaintenanceTaskCore } from "@/lib/operator/maintenance";

/** POST /api/maintenance/tasks/[id]/cancel — the runner stops at its next step. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => cancelMaintenanceTaskCore(ctx, id));
}
