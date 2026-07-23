"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AppError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <Card className="mx-auto max-w-xl"><CardHeader><AlertTriangle className="size-8 text-destructive" /><CardTitle>We could not load this workspace</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">No operation was performed. Retry the request or contact Vincere support if it continues.</p><Button onClick={() => unstable_retry()}>Try again</Button></CardContent></Card>;
}
