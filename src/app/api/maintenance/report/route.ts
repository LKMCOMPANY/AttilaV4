import { nativeRoute } from "@/lib/api/native-route";
import { getMaintenanceReportCore } from "@/lib/operator/maintenance";

/** GET /api/maintenance/report?accountId=…&days=7 — the maintainer's weekly report of an account. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId") ?? "";
  const days = Number(url.searchParams.get("days") ?? "7");
  return nativeRoute(request, (ctx) => getMaintenanceReportCore(ctx, accountId, days));
}
