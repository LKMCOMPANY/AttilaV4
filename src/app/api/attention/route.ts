import { nativeRoute } from "@/lib/api/native-route";
import { listAttentionCore } from "@/lib/operator/attention";

/** GET /api/attention — open attention items visible to the caller, most urgent first. */
export async function GET(request: Request) {
  return nativeRoute(request, (ctx) => listAttentionCore(ctx));
}
