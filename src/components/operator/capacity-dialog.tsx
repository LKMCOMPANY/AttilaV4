"use client";

import { useState } from "react";
import { Loader2, Power, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface CapacityRunningDevice {
  id: string;
  userName: string | null;
}

interface CapacityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  max: number;
  running: CapacityRunningDevice[];
  /** Stop the given device, then retry the original start. */
  onFreeSlot: (deviceId: string) => Promise<void>;
}

export function CapacityDialog({
  open,
  onOpenChange,
  max,
  running,
  onFreeSlot,
}: CapacityDialogProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleStop = async (id: string) => {
    setBusyId(id);
    try {
      await onFreeSlot(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Box at capacity</DialogTitle>
          <DialogDescription>
            This box is running its maximum of {max} active devices. Close one to
            free a slot for the device you want to open.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {running.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{d.userName ?? "Device"}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[10px] hover:border-destructive/40 hover:text-destructive"
                disabled={busyId !== null}
                onClick={() => handleStop(d.id)}
              >
                {busyId === d.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Power className="h-3 w-3" />
                )}
                Close
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
