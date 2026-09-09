"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signMaintenanceProof } from "@/app/actions/maintenance";

/**
 * A maintenance proof (a screenshot of a third party's content) lives in a
 * private bucket: the dialog asks the server for a ten-minute signed URL and
 * shows the image, nothing is ever embedded by public URL.
 */
export function ProofDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    signMaintenanceProof(path).then((result) => {
      if (cancelled) return;
      if ("error" in result) setError(result.error);
      else setUrl(result.url);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const close = () => {
    setUrl(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={path !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Proof</DialogTitle>
          <DialogDescription className="truncate font-mono text-[10px]">{path?.split("/").slice(-1)[0]}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!error && !url && (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL from a private bucket
          <img src={url} alt="Screen of the device at this step" className="max-h-[70vh] w-full rounded-md border object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}
