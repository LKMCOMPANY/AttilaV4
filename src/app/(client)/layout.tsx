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
  if (session.profile.role === "admin") redirect("/admin");

  return <ClientShell profile={session.profile}>{children}</ClientShell>;
}
