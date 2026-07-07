"use client";

import { DevicePickerList } from "../device-picker";
import type { StepProps } from "../types";

interface StepDeviceProps extends StepProps {
  accountId: string;
}

export function StepDevice({ data, onChange, accountId }: StepDeviceProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h3 className="text-heading-3">Device Assignment</h3>
        <p className="text-body-sm text-muted-foreground">
          Assign a device to this avatar. You can skip and assign one later.
        </p>
      </div>

      <DevicePickerList
        accountId={accountId}
        value={data.device_id}
        onChange={(device_id) => onChange({ device_id })}
      />
    </div>
  );
}
