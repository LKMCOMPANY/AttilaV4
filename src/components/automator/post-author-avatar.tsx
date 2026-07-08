import {
  Avatar as UiAvatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Source post author avatar. Uses the shadcn Avatar so a missing/expired image
// (TikTok CDN URLs are signed and expire) degrades cleanly to the author's
// initials instead of a broken image.
// ---------------------------------------------------------------------------

function initials(handle: string | null): string {
  const clean = (handle ?? "").replace(/^@/, "").trim();
  if (!clean) return "?";
  return clean.slice(0, 2).toUpperCase();
}

export function PostAuthorAvatar({
  handle,
  imageUrl,
  className,
}: {
  handle: string | null;
  imageUrl: string | null;
  className?: string;
}) {
  return (
    <UiAvatar className={cn("h-5 w-5 rounded-full", className)}>
      {imageUrl && <AvatarImage src={imageUrl} alt={handle ?? "author"} />}
      <AvatarFallback className="rounded-full bg-muted text-[8px] font-semibold text-muted-foreground">
        {initials(handle)}
      </AvatarFallback>
    </UiAvatar>
  );
}
