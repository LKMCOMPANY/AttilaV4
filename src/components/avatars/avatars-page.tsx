"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { CreateAvatarDialog } from "./create-avatar-dialog";

interface AvatarsPageClientProps {
  accountId: string;
}

export function AvatarsPageClient({ accountId }: AvatarsPageClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-2">Avatars</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Manage your social media avatars.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Create Avatar
        </Button>
      </div>

      <CreateAvatarDialog
        accountId={accountId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
