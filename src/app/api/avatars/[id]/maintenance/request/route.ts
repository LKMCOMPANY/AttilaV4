import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { requestMaintenanceTaskNowCore } from "@/lib/operator/maintenance";
import { requestTaskSchema } from "@/lib/validation/maintenance";

/** POST /api/avatars/[id]/maintenance/request — `{ kind, platform }`: queue a probe or a check now. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = requestTaskSchema.safeParse(await readJsonBody(request));
  return nativeRoute(request, (ctx) =>
    body.success
      ? requestMaintenanceTaskNowCore(ctx, id, body.data.kind, body.data.platform)
      : Promise.resolve({ error: "Paramètres invalides" }),
  );
}
