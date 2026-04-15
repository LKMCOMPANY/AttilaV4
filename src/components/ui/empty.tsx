import type { LucideIcon } from "lucide-react";

interface EmptyPanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
}

export function EmptyPanel({ icon: Icon, title, description }: EmptyPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background">
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-5 w-5 text-muted-foreground/40" />
      </div>
      <p className="mt-3 text-sm font-medium text-muted-foreground">
        {title}
      </p>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground/60">
          {description}
        </p>
      )}
    </div>
  );
}
