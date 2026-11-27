"use client";

import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { logReportAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Print / save-as-PDF button. Logs the report once when it is opened (not on prefetch), with its build time. */
export function ReportActions({ builtMs, query, scope }: { builtMs: number; query: string; scope: string }) {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    logReportAction(builtMs, query, scope).catch(() => {}); // the audit row is nice to have, never block the report
  }, [builtMs, query, scope]);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Use “Save as PDF” in the print dialog for a file.</span>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" /> Print or save PDF
      </Button>
    </div>
  );
}
