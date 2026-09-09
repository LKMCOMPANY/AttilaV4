import { nativeRoute } from "@/lib/api/native-route";
import { signMaintenanceProofCore } from "@/lib/operator/maintenance";

/** GET /api/maintenance/proofs?path=… — a ten-minute signed URL for one proof the caller may see. */
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  return nativeRoute(request, (ctx) => signMaintenanceProofCore(ctx, path));
}
