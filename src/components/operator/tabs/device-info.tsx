import type * as React from "react";

/** Card wrapper used by the device tab sections (Hardware, Network, Proxy…). */
export function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground/60" />
        <h4 className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
          {title}
        </h4>
        {action && <div className="ml-auto flex items-center gap-1">{action}</div>}
      </div>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  );
}

/** Single read-only label/value row. Renders nothing when the value is empty. */
export function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number | null | undefined;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 opacity-60" />
        <span>{label}</span>
      </div>
      <span className="truncate text-right text-[11px] font-medium">{value}</span>
    </div>
  );
}
