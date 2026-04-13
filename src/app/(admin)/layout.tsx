import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AdminShell } from "./admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) redirect("/");
  if (session.profile.role !== "admin") redirect("/dashboard");

  return <AdminShell profile={session.profile}>{children}</AdminShell>;
}
