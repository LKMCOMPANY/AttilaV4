"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import { getGorgoneClients, linkGorgoneClient } from "@/app/actions/gorgone";
import { toast } from "sonner";
import type { GorgoneClient } from "@/lib/gorgone";

interface GorgoneLinkDialogProps {
  accountId: string;
  existingClientIds: string[];
  onLinked: () => void;
}

export function GorgoneLinkDialog({
  accountId,
  existingClientIds,
  onLinked,
}: GorgoneLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<GorgoneClient[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getGorgoneClients();
      setClients(data.filter((c) => !existingClientIds.includes(c.id)));
    } catch {
      toast.error("Failed to load Gorgone clients");
    } finally {
      setIsLoading(false);
    }
  }, [existingClientIds]);

  useEffect(() => {
    if (open) {
      setSelectedId("");
      loadClients();
    }
  }, [open, loadClients]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;

    const client = clients.find((c) => c.id === selectedId);
    if (!client) return;

    startTransition(async () => {
      const result = await linkGorgoneClient({
        accountId,
        gorgoneClientId: client.id,
        gorgoneClientName: client.name,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Linked to ${client.name}`);
      setOpen(false);
      onLinked();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus data-icon="inline-start" className="h-3.5 w-3.5" />
            Link Gorgone Client
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Link Gorgone Client</DialogTitle>
            <DialogDescription>
              Select a Gorgone client to sync monitoring data from its zones.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Gorgone Client</Label>
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading clients...
                </div>
              ) : clients.length === 0 ? (
                <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  No available clients to link.
                </div>
              ) : (
                <Select value={selectedId} onValueChange={(v) => { if (v) setSelectedId(v); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a client..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="submit"
              disabled={isPending || !selectedId || isLoading}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Link Client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
