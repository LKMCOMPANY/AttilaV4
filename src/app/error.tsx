"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ATTILA] Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <h1 className="text-heading-2">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        An unexpected error occurred. Please try again or contact support if the
        problem persists.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}
      <Button onClick={reset} variant="outline">
        Try Again
      </Button>
    </div>
  );
}
