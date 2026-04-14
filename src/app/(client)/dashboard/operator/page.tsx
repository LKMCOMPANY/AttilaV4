import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { AvatarsPageClient } from "@/components/avatars/avatars-page";

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

  if (!accountId) redirect("/admin");

  return <AvatarsPageClient accountId={accountId} />;
}
