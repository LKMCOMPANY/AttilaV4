"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Smartphone, X, Maximize2, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface DeviceScreenshotProps {
  url: string | null | undefined;
  alt: string;
  className?: string;
}

export function DeviceScreenshot({
  url,
  alt,
  className,
}: DeviceScreenshotProps) {
  const [lightbox, setLightbox] = useState(false);
  const [imgError, setImgError] = useState(false);

  const hasImage = !!url && !imgError;

  const handleDownload = useCallback(() => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = alt.replace(/[^a-zA-Z0-9_-]/g, "_") + ".png";
    a.click();
  }, [url, alt]);

  return (
    <>
      <div
        className={cn(
          "group relative flex w-full items-center justify-center overflow-hidden rounded-md border",
          "min-h-[140px]",
          hasImage
            ? "cursor-pointer border-border/60 bg-muted/10"
            : "border-dashed border-border/40 bg-muted/20",
          className
        )}
        onClick={() => hasImage && setLightbox(true)}
      >
        {hasImage ? (
          <>
            <img
              src={url}
              alt={alt}
              onError={() => setImgError(true)}
              className="h-full w-full object-contain"
            />
            {/* Action bar — visible on hover */}
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="rounded bg-black/50 p-1 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightbox(true);
                      }}
                    />
                  }
                >
                  <Maximize2 className="h-3 w-3" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Fullscreen
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="rounded bg-black/50 p-1 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload();
                      }}
                    />
                  }
                >
                  <Download className="h-3 w-3" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Download
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-6">
            <Smartphone className="h-5 w-5 text-muted-foreground/25" />
            <span className="text-[10px] text-muted-foreground/40">
              Pending capture
            </span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && hasImage && (
        <div
          className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/85 p-8"
          onClick={() => setLightbox(false)}
        >
          <div className="absolute right-4 top-4 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => setLightbox(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <img
            src={url}
            alt={alt}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
