import { redirect } from "next/navigation";

export default async function ClientDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = params.account ? `?account=${params.account}` : "";
  redirect(`/dashboard/operator${query}`);
}
