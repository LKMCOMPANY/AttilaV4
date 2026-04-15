import { Skeleton } from "@/components/ui/skeleton";

function CampaignItemSkeleton() {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2.5">
      <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-1.5 h-2.5 w-20" />
      </div>
    </div>
  );
}

export default function AutomatorLoading() {
  return (
    <div className="flex h-full">
      {/* Left — Campaign list */}
      <div className="flex w-[33%] flex-col border-r bg-background">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <div className="flex gap-0.5 border-b px-1.5 py-1.5">
          {["w-10", "w-8", "w-10"].map((w, i) => (
            <Skeleton key={i} className={`h-6 ${w} rounded-md`} />
          ))}
        </div>
        <div className="space-y-px p-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <CampaignItemSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Center — Cartography + Guidelines */}
      <div className="flex w-[34%] flex-col border-r bg-background">
        {/* Cartography placeholder */}
        <div className="flex flex-1 items-center justify-center border-b">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        </div>
        {/* Guidelines tabs */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-1 border-b px-3 py-2">
            {["w-16", "w-16", "w-18"].map((w, i) => (
              <Skeleton key={i} className={`h-5 ${w} rounded-md`} />
            ))}
          </div>
          <div className="flex-1 p-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className="mt-2 h-3 w-5/6" />
          </div>
        </div>
      </div>

      {/* Right — Pipeline stats + Activity */}
      <div className="flex w-[33%] flex-col bg-background">
        {/* Stats header */}
        <div className="grid grid-cols-4 border-b">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center px-2 py-2.5">
              <Skeleton className="h-4 w-6" />
              <Skeleton className="mt-1 h-2 w-10" />
            </div>
          ))}
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b px-3 py-2">
          {["w-14", "w-12", "w-16"].map((w, i) => (
            <Skeleton key={i} className={`h-5 ${w} rounded-md`} />
          ))}
        </div>
        {/* Post rows */}
        <div className="space-y-px p-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2 px-2.5 py-2">
              <Skeleton className="mt-0.5 h-3 w-3 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="mt-1.5 h-3 w-3/4" />
                <Skeleton className="mt-1.5 h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
