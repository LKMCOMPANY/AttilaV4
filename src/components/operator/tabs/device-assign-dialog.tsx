"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DevicePickerList } from "@/components/avatars/device-picker";
import { setAvatarDevice } from "@/app/actions/avatars";
import type { Device } from "@/types";

interface DeviceAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  avatarId: string;
  accountId: string;
  /** Currently attached device id, preselected in the picker (null = none). */
  currentDeviceId: string | null;
  /** Called with the redacted device (or null) once the change is persisted. */
  onAssigned: (deviceId: string | null, device: Device | null) => void;
}

export function DeviceAssignDialog({
  open,
  onOpenChange,
  avatarId,
  accountId,
  currentDeviceId,
  onAssigned,
}: DeviceAssignDialogProps) {
  const [selected, setSelected] = useState<string | null>(currentDeviceId);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const result = await setAvatarDevice(avatarId, selected);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onAssigned(selected, result.device);
      onOpenChange(false);
      toast.success(selected ? "Device attached" : "Device detached");
    } catch {
      toast.error("Failed to update device");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign device</DialogTitle>
          <DialogDescription>
            Pick a device from this account to attach to the avatar. Only devices not already
            attached to another avatar are shown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <DevicePickerList accountId={accountId} value={selected} onChange={setSelected} />
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || selected === currentDeviceId}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {selected ? "Attach" : "Detach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
