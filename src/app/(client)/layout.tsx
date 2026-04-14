import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ClientShell } from "./client-shell";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect("/");

  // Admins are allowed through for impersonation (via ?account=xxx).
  // The ClientShell handles redirect if the param is missing.

  return <ClientShell profile={session.profile}>{children}</ClientShell>;
}
