import { nativeRoute } from "@/lib/api/native-route";
import { getAccountZonesCore } from "@/lib/automator/campaigns";

/**
 * GET /api/gorgone/zones?account=<uuid> — Gorgone zones available to an
 * account (native transport of the `getAccountZones` server action; the
 * remote Gorgone directory call is server-side only). `account` defaults
 * to the caller's own account; admins must pass it explicitly. Answers
 * `{ zones: AccountZone[] }`.
 */
export async function GET(request: Request) {
  const accountParam = new URL(request.url).searchParams.get("account");
  return nativeRoute(request, async (ctx) => {
    const accountId = accountParam ?? ctx.session.profile.account_id;
    if (!accountId) {
      return { zones: [], error: "account query parameter required" };
    }
    return { zones: await getAccountZonesCore(ctx, accountId) };
  });
}
