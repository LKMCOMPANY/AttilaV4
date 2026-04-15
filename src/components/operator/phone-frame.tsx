import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type DeviceStatus = "active" | "inactive" | "empty";

interface PhoneFrameProps {
  status: DeviceStatus;
  children: ReactNode;
  navBar?: ReactNode;
  className?: string;
}

const BEZEL_RADIUS = "2.75rem";
const SCREEN_RADIUS = "2.25rem";

export function PhoneFrame({
  status,
  children,
  navBar,
  className,
}: PhoneFrameProps) {
  return (
    <div className={cn("relative w-full max-w-[320px]", className)}>
      <SideButtons status={status} />

      {/* Phone body — the bezel IS the background, no border needed */}
      <div
        className={cn(
          "phone-body relative flex w-full flex-col overflow-hidden p-[5px]",
          "transition-[box-shadow] duration-500 ease-out",
          status === "active" && "phone-body--active",
          status === "inactive" && "phone-body--inactive",
          status === "empty" && "phone-body--empty",
        )}
        style={{ aspectRatio: "9 / 19.5", borderRadius: BEZEL_RADIUS }}
      >
        {/* Bezel edge highlight — subtle top shine */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            borderRadius: BEZEL_RADIUS,
            boxShadow: "inset 0 0.5px 0 0 rgba(255,255,255,0.06)",
          }}
          aria-hidden="true"
        />

        {/* Screen — single continuous surface containing content + navbar */}
        <div
          className="relative flex flex-1 flex-col overflow-hidden bg-black"
          style={{ borderRadius: SCREEN_RADIUS }}
        >
          {/* Dynamic Island */}
          <div className="absolute left-1/2 top-[8px] z-10 -translate-x-1/2">
            <div className="relative flex h-[16px] w-[62px] items-center rounded-full bg-[oklch(0.06_0_0)]">
              <div className="absolute right-[12px] h-[4px] w-[4px] rounded-full bg-[oklch(0.12_0_0)]" />
            </div>
          </div>

          {/* Stream / screenshot content */}
          <div className="flex flex-1 flex-col overflow-hidden pt-6">
            {children}
          </div>

          {/* Android nav bar — inside the screen surface */}
          {navBar}
        </div>
      </div>
    </div>
  );
}

function SideButtons({ status }: { status: DeviceStatus }) {
  const base = "absolute z-0 rounded-sm transition-colors duration-300";
  const color =
    status === "empty"
      ? "bg-[oklch(0.35_0_0)] dark:bg-[oklch(0.22_0_0)]"
      : "bg-[oklch(0.18_0_0)] dark:bg-[oklch(0.28_0_0)]";

  return (
    <>
      <div
        className={cn(base, color, "right-[-4px] top-[28%] h-[36px] w-[2.5px]")}
        aria-hidden="true"
      />
      <div
        className={cn(base, color, "left-[-4px] top-[17%] h-[12px] w-[2.5px]")}
        aria-hidden="true"
      />
      <div
        className={cn(base, color, "left-[-4px] top-[22%] h-[22px] w-[2.5px]")}
        aria-hidden="true"
      />
      <div
        className={cn(base, color, "left-[-4px] top-[30%] h-[22px] w-[2.5px]")}
        aria-hidden="true"
      />
    </>
  );
}
