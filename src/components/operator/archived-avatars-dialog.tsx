"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getArchivedAvatars,
  unarchiveAvatar,
  type ArchivedAvatar,
} from "@/app/actions/avatars";

interface ArchivedAvatarsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
}

export function ArchivedAvatarsDialog({ open, onOpenChange, accountId }: ArchivedAvatarsDialogProps) {
  const router = useRouter();
  const [items, setItems] = useState<ArchivedAvatar[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    getArchivedAvatars(accountId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const restore = async (id: string) => {
    setRestoringId(id);
    try {
      const result = await unarchiveAvatar(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setItems((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      toast.success("Avatar restored");
      router.refresh();
    } catch {
      toast.error("Failed to restore avatar");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Archived avatars</DialogTitle>
          <DialogDescription>
            Restore an avatar to make it active again. Its device is not re-attached automatically —
            reassign one from the Device tab.
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="rounded-full bg-muted p-3">
              <Archive className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No archived avatars</p>
          </div>
        ) : (
          <div className="max-h-[320px] space-y-1 overflow-y-auto scrollbar-thin">
            {items.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.first_name} {a.last_name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Archived {new Date(a.archived_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => restore(a.id)}
                  disabled={restoringId === a.id}
                >
                  {restoringId === a.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
