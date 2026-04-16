import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getCartographyData } from "@/app/actions/cartography";
import { CartographyLayout } from "@/components/cartography";

export default async function CartographyPage({
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

  const { data, error } = await getCartographyData(accountId);

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-body-sm text-muted-foreground">
          {error ?? "Failed to load cartography data"}
        </p>
      </div>
    );
  }

  return <CartographyLayout data={data} />;
}
