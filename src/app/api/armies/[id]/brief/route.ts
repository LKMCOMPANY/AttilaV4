import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { getArmyBriefCore, setArmyBriefCore } from "@/lib/operator/briefs";
import { armyBriefSchema } from "@/lib/validation/maintenance";

/** GET /api/armies/[id]/brief — the army's cluster objective and keywords. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => getArmyBriefCore(ctx, id));
}

/** POST /api/armies/[id]/brief — `{ objective, clusterKeywords }` (managers and admins). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = armyBriefSchema.safeParse(await readJsonBody(request));
  return nativeRoute(request, (ctx) =>
    body.success ? setArmyBriefCore(ctx, id, body.data) : Promise.resolve({ error: "Paramètres invalides" }),
  );
}
