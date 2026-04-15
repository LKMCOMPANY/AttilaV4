"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Smartphone, X } from "lucide-react";

interface DeviceScreenshotProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

export function DeviceScreenshot({ url, alt, className }: DeviceScreenshotProps) {
  const [lightbox, setLightbox] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasImage = !!url && !imgError;

  return (
    <>
      <button
        type="button"
        disabled={!hasImage}
        onClick={() => hasImage && setLightbox(true)}
        className={cn(
          "group relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border",
          "aspect-[9/16] w-16",
          hasImage
            ? "cursor-pointer border-border/60 transition-all hover:border-primary/40 hover:shadow-md"
            : "cursor-default border-dashed border-border/40 bg-muted/30",
          className
        )}
      >
        {hasImage ? (
          <>
            <img
              src={url}
              alt={alt}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          </>
        ) : (
          <Smartphone className="h-4 w-4 text-muted-foreground/30" />
        )}
      </button>

      {/* Lightbox overlay */}
      {lightbox && hasImage && (
        <div
          className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={url}
            alt={alt}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
