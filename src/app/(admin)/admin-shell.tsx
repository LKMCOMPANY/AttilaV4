"use client";

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardFooter } from "@/components/layout/dashboard-footer";
import type { UserProfile } from "@/types";

const ADMIN_NAV = [
  { label: "Overview", href: "/admin" },
  { label: "Accounts", href: "/admin/accounts" },
  { label: "Infrastructure", href: "/admin/infrastructure" },
];

export function AdminShell({
  profile,
  children,
}: {
  profile: UserProfile;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader profile={profile} navigation={ADMIN_NAV} />
      <main className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <DashboardFooter />
    </div>
  );
}
