import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getCampaigns } from "@/app/actions/campaigns";
import { AutomatorLayout } from "@/components/automator/automator-layout";

export default async function AutomatorPage({
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

  const campaigns = await getCampaigns(accountId);

  return <AutomatorLayout accountId={accountId} campaigns={campaigns} />;
}
