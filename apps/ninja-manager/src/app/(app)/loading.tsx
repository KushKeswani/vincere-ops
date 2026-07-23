import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-6" aria-label="Loading dashboard"><Skeleton className="h-10 w-64" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div><Skeleton className="h-72" /></div>;
}
