"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardFooter } from "@/components/layout/dashboard-footer";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { UserProfile } from "@/types";
import { createClient } from "@/lib/supabase/client";

const CLIENT_NAV = [
  { label: "Overview", href: "/dashboard" },
  { label: "Avatars", href: "/dashboard/avatars" },
  { label: "Devices", href: "/dashboard/devices" },
  { label: "Campaigns", href: "/dashboard/campaigns" },
];

interface ClientShellProps {
  profile: UserProfile;
  children: React.ReactNode;
}

export function ClientShell({ profile, children }: ClientShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = profile.role === "admin";
  const impersonatedAccountId = searchParams.get("account");
  const [accountName, setAccountName] = useState<string | null>(null);

  // Admin without ?account param → redirect back to admin dashboard
  useEffect(() => {
    if (isAdmin && !impersonatedAccountId) {
      router.replace("/admin");
    }
  }, [isAdmin, impersonatedAccountId, router]);

  // Fetch impersonated account name for the banner
  useEffect(() => {
    if (!isAdmin || !impersonatedAccountId) return;

    const supabase = createClient();
    supabase
      .from("accounts")
      .select("name")
      .eq("id", impersonatedAccountId)
      .single()
      .then(({ data }) => {
        setAccountName(data?.name ?? null);
      });
  }, [isAdmin, impersonatedAccountId]);

  // Preserve ?account param on client nav links for admin impersonation
  const navigation = isAdmin && impersonatedAccountId
    ? CLIENT_NAV.map((item) => ({
        ...item,
        href: `${item.href}?account=${impersonatedAccountId}`,
      }))
    : CLIENT_NAV;

  if (isAdmin && !impersonatedAccountId) return null;

  return (
    <div className="flex min-h-screen flex-col">
      {isAdmin && impersonatedAccountId && (
        <div className="border-b bg-primary/5 px-4 py-1.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Viewing as{" "}
              <span className="font-medium text-foreground">
                {accountName ?? "..."}
              </span>
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => router.push("/admin/accounts")}
            >
              <ArrowLeft data-icon="inline-start" className="h-3 w-3" />
              Back to Admin
            </Button>
          </div>
        </div>
      )}
      <DashboardHeader profile={profile} navigation={navigation} />
      <main className="flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <DashboardFooter />
    </div>
  );
}
