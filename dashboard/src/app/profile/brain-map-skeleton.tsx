export default function BrainMapSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950/70">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-3">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-8 w-28 animate-pulse rounded-lg bg-gray-900" />
        <div className="ml-auto h-8 w-32 animate-pulse rounded-lg bg-gray-900" />
      </div>
      <div className="relative h-[72vh] min-h-[31rem] bg-[radial-gradient(circle_at_center,rgba(51,65,85,0.18),transparent_58%)]">
        <div className="absolute left-[18%] top-[22%] h-3 w-3 animate-pulse rounded-full bg-cyan-300/50" />
        <div className="absolute left-[48%] top-[46%] h-5 w-5 animate-pulse rounded-full bg-blue-300/50" />
        <div className="absolute right-[22%] top-[30%] h-4 w-4 animate-pulse rounded-full bg-violet-300/40" />
        <div className="absolute bottom-[24%] left-[34%] h-3 w-3 animate-pulse rounded-full bg-amber-200/40" />
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-gray-600">
          Building your private map…
        </p>
      </div>
    </div>
  );
}
