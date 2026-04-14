import { ImagePlus, Upload } from "lucide-react";
import type { AvatarWithRelations } from "@/types";

interface ContentTabProps {
  avatar: AvatarWithRelations;
}

export function ContentTab({ avatar: _avatar }: ContentTabProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-[13px] font-semibold">Content Library</h3>

      {/* Drop zone */}
      <div className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/15 bg-muted/10 py-16 transition-colors hover:border-primary/30 hover:bg-primary/3">
        <div className="rounded-full bg-muted p-3 transition-colors group-hover:bg-primary/10">
          <Upload className="h-6 w-6 text-muted-foreground/40 transition-colors group-hover:text-primary/60" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium text-muted-foreground">
            Drag & drop images here
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/50">
            or click to browse files
          </p>
        </div>
        <p className="text-[10px] text-muted-foreground/40">
          Available in a future update
        </p>
      </div>

      {/* Gallery grid placeholder */}
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-muted-foreground/8 bg-muted/15"
          >
            <ImagePlus className="h-4 w-4 text-muted-foreground/15" />
          </div>
        ))}
      </div>
    </div>
  );
}
