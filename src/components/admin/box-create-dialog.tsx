"use client";

import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Loader2 } from "lucide-react";
import { createBox } from "@/app/actions/boxes";
import { toast } from "sonner";

interface BoxCreateDialogProps {
  onCreated: (id: string) => void;
}

export function BoxCreateDialog({ onCreated }: BoxCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState("");
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hostname.trim()) return;

    startTransition(async () => {
      const result = await createBox({
        tunnel_hostname: hostname.trim(),
        name: name.trim() || undefined,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Box registered and devices discovered");
      setOpen(false);
      setHostname("");
      setName("");
      if (result.data) onCreated(result.data.id);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="w-full">
            <Plus data-icon="inline-start" className="h-4 w-4" />
            Add Box
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Register Box</DialogTitle>
            <DialogDescription>
              Connect a Magic Box by entering its tunnel hostname. The system
              will verify connectivity and discover all devices.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="box-hostname">Tunnel Hostname</Label>
              <Input
                id="box-hostname"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="box-1.attila.army"
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Convention: box-N.attila.army
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="box-name">Display Name</Label>
              <Input
                id="box-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Box Paris 1 (optional)"
                maxLength={100}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending || !hostname.trim()}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
