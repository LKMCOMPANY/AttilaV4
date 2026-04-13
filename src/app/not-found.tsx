import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="text-display">404</h1>
      <p className="max-w-md text-muted-foreground">
        The page you are looking for does not exist or has been moved.
      </p>
      <Button variant="outline" render={<Link href="/" />}>
        Back to Home
      </Button>
    </div>
  );
}
