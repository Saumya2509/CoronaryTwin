// Fetch something derived from the current patient whenever a new baseline prediction lands.
// Keyed on `base` (not `inputs`) so it only runs for values the API has already accepted,
// and it never runs for what-if overrides. Older requests are aborted.
import { useEffect, useState } from "react";
import type { PatientRecord, PredictResponse } from "./api/types";
import { useRisk } from "./store/risk";

export function useLive<T>(
  fetcher: (inputs: PatientRecord, signal: AbortSignal) => Promise<T>,
  enabled: (base: PredictResponse) => boolean = () => true,
  delayMs = 300,
): { data: T | null; loading: boolean; error: string | null } {
  const base = useRisk((s) => s.base);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!base || !enabled(base)) {
      setData(null);
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        setData(await fetcher(useRisk.getState().inputs, ctl.signal));
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, delayMs);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
    // fetcher / enabled are module-level functions at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  return { data, loading, error };
}
