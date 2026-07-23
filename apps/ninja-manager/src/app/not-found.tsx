import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center p-6 text-center"><div><p className="font-mono text-sm text-primary">404</p><h1 className="mt-2 text-3xl font-semibold">That workspace was not found</h1><p className="mt-3 text-muted-foreground">The record may have moved or you may not have access.</p><Button asChild className="mt-6"><Link href="/">Return to Ninja Manager</Link></Button></div></main>;
}
