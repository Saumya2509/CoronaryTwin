// Short status messages (a demo file that failed to load, a failed PDF export). Auto-dismisses.
import { useEffect } from "react";
import { useRisk } from "../store/risk";

export function Toast() {
  const toast = useRisk((s) => s.toast);
  const setToast = useRisk((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    // Long enough to read: about 60 ms per character, at least 8 s.
    const t = window.setTimeout(() => setToast(null), Math.max(8000, toast.length * 60));
    return () => window.clearTimeout(t);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast}</span>
      <button type="button" className="icon-btn" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
    </div>
  );
}
