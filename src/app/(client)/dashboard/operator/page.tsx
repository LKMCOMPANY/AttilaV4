import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAvatars } from "@/app/actions/avatars";
import { accountDeviceScopeFilter } from "@/lib/devices/access";
import { OperatorLayout } from "@/components/operator/operator-layout";

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;

  const accountId =
    session.profile.role === "admin"
      ? params.account ?? null
      : session.profile.account_id;

  if (!accountId) redirect("/admin/accounts");

  const supabase = await createClient();

  const [avatars, filter] = await Promise.all([
    getAvatars(accountId),
    accountDeviceScopeFilter(supabase, accountId),
  ]);

  const { count: deviceCount } = await supabase
    .from("devices")
    .select("*", { count: "exact", head: true })
    .or(filter);

  return (
    <OperatorLayout
      accountId={accountId}
      avatars={avatars}
      deviceCount={deviceCount ?? 0}
      displayName={session.profile.display_name ?? session.profile.email}
    />
  );
}
