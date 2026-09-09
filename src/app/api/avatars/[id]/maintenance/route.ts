import { nativeRoute, readJsonBody } from "@/lib/api/native-route";
import { getAvatarMaintenanceCore, setAvatarMaintenanceCore } from "@/lib/operator/maintenance";
import { maintenancePatchSchema } from "@/lib/validation/maintenance";

/** GET /api/avatars/[id]/maintenance — switch, profile, day zero, twin states, recent tasks, brief. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return nativeRoute(request, (ctx) => getAvatarMaintenanceCore(ctx, id));
}

/** POST /api/avatars/[id]/maintenance — `{ enabled?, profile?, dayZero? }` (managers and admins). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = maintenancePatchSchema.safeParse(await readJsonBody(request));
  return nativeRoute(request, (ctx) =>
    body.success ? setAvatarMaintenanceCore(ctx, id, body.data) : Promise.resolve({ error: "Paramètres invalides" }),
  );
}
