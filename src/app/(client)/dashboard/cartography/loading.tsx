import { Loader2 } from "lucide-react";

export default function CartographyLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-caption normal-case">Loading cartography…</p>
      </div>
    </div>
  );
}
