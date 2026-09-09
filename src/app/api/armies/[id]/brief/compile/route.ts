import { nativeRoute } from "@/lib/api/native-route";
import { compileArmyBriefCore } from "@/lib/operator/briefs";

/** POST /api/armies/[id]/brief/compile — recompile the effective brief of every avatar of the army. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => compileArmyBriefCore(ctx, id));
}
