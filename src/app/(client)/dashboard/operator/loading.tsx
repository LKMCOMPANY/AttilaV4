import { Skeleton } from "@/components/ui/skeleton";

function AvatarItemSkeleton() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2.5">
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-1 h-2.5 w-20" />
        <div className="mt-1.5 flex gap-0.5">
          <Skeleton className="h-[18px] w-[18px] rounded" />
          <Skeleton className="h-[18px] w-[18px] rounded" />
        </div>
      </div>
    </div>
  );
}

export default function OperatorLoading() {
  return (
    <div className="flex h-full">
      {/* Avatar list */}
      <div className="flex w-[33%] flex-col border-r bg-background">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <div className="flex gap-0.5 border-b px-1.5 py-1.5">
          {["w-14", "w-10", "w-10", "w-11", "w-11"].map((w, i) => (
            <Skeleton key={i} className={`h-6 ${w} rounded-md`} />
          ))}
        </div>
        <div className="space-y-px p-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AvatarItemSkeleton key={i} />
          ))}
        </div>
      </div>

      {/* Device stream */}
      <div className="flex w-[34%] flex-col border-r bg-background">
        <div className="flex h-10 items-center justify-between border-b px-2">
          <div className="flex gap-1">
            <Skeleton className="h-7 w-16 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <Skeleton className="aspect-[9/19] w-full max-w-[320px] rounded-[2rem]" />
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex w-[33%] flex-col bg-background">
        <div className="flex h-10 items-center gap-1 border-b px-3">
          {["w-16", "w-14", "w-18", "w-14", "w-16"].map((w, i) => (
            <Skeleton key={i} className={`h-7 ${w} rounded-md`} />
          ))}
        </div>
        <div className="space-y-5 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
