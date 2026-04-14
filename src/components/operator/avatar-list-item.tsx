import {
  Avatar as UiAvatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn, countryCodeToFlag } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { PLATFORM_LIST, STATUS_CONFIG } from "@/lib/constants/avatar";
import { SocialIcon } from "@/components/icons/social-icons";
import type { AvatarWithRelations } from "@/types";

interface AvatarListItemProps {
  avatar: AvatarWithRelations;
  isSelected: boolean;
  onSelect: () => void;
}

export function AvatarListItem({
  avatar,
  isSelected,
  onSelect,
}: AvatarListItemProps) {
  const fullName = `${avatar.first_name} ${avatar.last_name}`;
  const flag = countryCodeToFlag(avatar.country_code);
  const enabledPlatforms = PLATFORM_LIST.filter(
    (p) => avatar[p.enabledKey]
  );

  return (
    <button
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={cn(
        "group relative w-full rounded-lg px-2.5 py-2.5 text-left transition-all duration-150",
        isSelected
          ? "bg-primary/6 shadow-sm ring-1 ring-primary/20"
          : "hover:bg-muted/50 active:bg-muted/70"
      )}
    >
      {/* Active indicator */}
      {isSelected && (
        <div className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}

      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <UiAvatar className="h-8 w-8 rounded-lg">
            {avatar.profile_image_url && (
              <AvatarImage src={avatar.profile_image_url} alt={fullName} />
            )}
            <AvatarFallback className="rounded-lg text-[10px] font-medium">
              {avatar.first_name[0]}
              {avatar.last_name[0]}
            </AvatarFallback>
          </UiAvatar>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
              STATUS_CONFIG[avatar.status].dot
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium leading-tight">
              {fullName}
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            {flag && <span className="leading-none">{flag}</span>}
            <span>{avatar.language_code.toUpperCase()}</span>
            <span className="text-border">·</span>
            <span className="truncate">
              {formatDistanceToNow(new Date(avatar.updated_at), {
                addSuffix: true,
              })}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            {enabledPlatforms.length > 0 && (
              <div className="flex gap-0.5">
                {enabledPlatforms.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "inline-flex h-[18px] items-center justify-center rounded px-1",
                      p.bgColor, p.color
                    )}
                  >
                    <SocialIcon platform={p.id} className="h-2.5 w-2.5" />
                  </span>
                ))}
              </div>
            )}

            {avatar.tags.length > 0 && enabledPlatforms.length > 0 && (
              <span className="text-border">·</span>
            )}

            {avatar.tags.length > 0 && (
              <div className="flex min-w-0 gap-0.5 overflow-hidden">
                {avatar.tags.slice(0, 2).map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="h-[18px] max-w-[72px] truncate border-border/50 px-1.5 text-[9px]"
                  >
                    {tag}
                  </Badge>
                ))}
                {avatar.tags.length > 2 && (
                  <span className="flex h-[18px] items-center text-[9px] text-muted-foreground">
                    +{avatar.tags.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
