"use client";

import { useState, useCallback } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { Smartphone, X, Maximize2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeviceScreenshotProps {
  url: string | null | undefined;
  alt: string;
  /** Short label rendered under the tile (e.g. "Target loaded"). */
  caption?: string;
  className?: string;
}

/**
 * Device screenshot tile: a bounded 9:16 thumbnail with a lightbox for the
 * full frame. Phone captures rendered full-width dwarfed the panel and pushed
 * every other signal off screen — evidence is always a small labeled tile,
 * and inspection happens in the lightbox.
 *
 * The lightbox goes through Base UI's Dialog (same primitive the design
 * system's Dialog is built on) so it PORTALS to the document body. A plain
 * `position: fixed` overlay rendered inline here was trapped: the detail
 * overlay sits inside a Base UI ScrollArea viewport, which establishes a
 * containing block, so `fixed` clipped to the panel instead of the viewport
 * and the "open big" click appeared to do nothing.
 */
export function DeviceScreenshot({
  url,
  alt,
  caption,
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

  const tile = (
    <div
      className={cn(
        "group relative h-44 w-[99px] shrink-0 overflow-hidden rounded-md border",
        hasImage
          ? "cursor-zoom-in border-border/60 bg-muted/10"
          : "border-dashed border-border/40 bg-muted/20",
        className,
      )}
      onClick={() => hasImage && setLightbox(true)}
    >
      {hasImage ? (
        <>
          <img
            src={url}
            alt={alt}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover object-top"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
            <Maximize2 className="h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
          </div>
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 py-6">
          <Smartphone className="h-5 w-5 text-muted-foreground/25" />
          <span className="text-[11px] text-muted-foreground/50">No capture</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      {caption ? (
        <figure className="flex w-fit flex-col gap-1">
          {tile}
          <figcaption className="max-w-[99px] text-center text-[11px] leading-tight text-muted-foreground">
            {caption}
          </figcaption>
        </figure>
      ) : (
        tile
      )}

      {hasImage && (
        <DialogPrimitive.Root open={lightbox} onOpenChange={setLightbox}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop
              className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/85 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            />
            {/* Click-through wrapper so presses on the dark area reach the
                backdrop (dismiss); the popup itself captures pointer events. */}
            <div className="pointer-events-none fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-8">
              <DialogPrimitive.Popup
                className="pointer-events-auto relative outline-none duration-100 data-open:animate-in data-open:zoom-in-95 data-closed:animate-out data-closed:zoom-out-95"
              >
                <img
                  src={url}
                  alt={alt}
                  className="max-h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] rounded-lg object-contain shadow-2xl"
                />
                <div className="absolute right-2 top-2 flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
                    onClick={handleDownload}
                  >
                    <Download className="h-4 w-4" />
                    <span className="sr-only">Download</span>
                  </Button>
                  <DialogPrimitive.Close
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
                      />
                    }
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                </div>
              </DialogPrimitive.Popup>
            </div>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </>
  );
}
