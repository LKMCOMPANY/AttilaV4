import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DetachedStream } from "@/components/operator/detached-stream";

export default async function StreamPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const { deviceId } = await params;

  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices")
    .select("id, db_id, box_id, account_id, user_name")
    .eq("id", deviceId)
    .single();

  if (!device) redirect("/dashboard");

  if (
    session.profile.role !== "admin" &&
    device.account_id !== session.profile.account_id
  ) {
    redirect("/dashboard");
  }

  return (
    <DetachedStream
      boxId={device.box_id}
      dbId={device.db_id}
      deviceName={device.user_name || device.db_id}
      deviceId={device.id}
    />
  );
}
