"use client";

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardFooter } from "@/components/layout/dashboard-footer";
import type { UserProfile } from "@/types";

const CLIENT_NAV = [
  { label: "Overview", href: "/dashboard" },
  { label: "Avatars", href: "/dashboard/avatars" },
  { label: "Devices", href: "/dashboard/devices" },
  { label: "Campaigns", href: "/dashboard/campaigns" },
];

export function ClientShell({
  profile,
  children,
}: {
  profile: UserProfile;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader profile={profile} navigation={CLIENT_NAV} />
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <DashboardFooter />
    </div>
  );
}
