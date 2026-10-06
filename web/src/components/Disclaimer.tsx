import { useEffect, useRef, useState } from "react";

export const DISCLAIMER =
  "For decision support and educational purposes only. Not a substitute for formal diagnostic imaging or clinical judgment.";
export const SHORT_DISCLAIMER = "Estimate only, not a diagnosis.";

const ACK_KEY = "coronarytwin.ack.v1";

export const BANNER = "Decision support and educational use only. Not a diagnosis and not a substitute for formal diagnostic imaging.";

/** Persistent safety banner (md/10.md 5.2): sticky under the header, never dismissible, also in exports. */
export function DisclaimerBanner() {
  return (
    <div className="disclaimer-banner" role="note">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
        <path d="M12 8v4.5M12 15.8v.2" strokeLinecap="round" />
      </svg>
      <span>{BANNER}</span>
    </div>
  );
}

function readAck(): boolean {
  try {
    return window.localStorage.getItem(ACK_KEY) === "1";
  } catch {
    return false;
  }
}

/** First-use modal the user must acknowledge before using the tool. */
export function FirstUseModal() {
  const [open, setOpen] = useState(() => !readAck() && !new URLSearchParams(window.location.search).has("noack"));
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  const accept = () => {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch { /* private mode: ask again next time */ }
    dialog.current?.close();
    setOpen(false);
  };

  if (!open) return null;
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="ack-title" onCancel={(e) => e.preventDefault()}>
      <p className="kicker">CoronaryTwin · research prototype</p>
      <h2 id="ack-title">Before you start</h2>
      <p>CoronaryTwin estimates coronary artery disease risk from routine clinical data. It is a research and teaching prototype.</p>
      <ul>
        <li><strong>Not a diagnosis.</strong> It does not replace angiography, CT, or clinical judgment.</li>
        <li><strong>Schematic anatomy.</strong> The 3D arteries are colored from vessel-level estimates. They do not show where a narrowing is.</li>
        <li><strong>Associations, not causes.</strong> Explanations and what-if results describe how the model behaves. They are not treatment advice.</li>
        <li><strong>Small, single-source data.</strong> The models were trained on 303 patients from one center, without external validation.</li>
      </ul>
      <button type="button" className="btn primary" onClick={accept} autoFocus>
        I understand. Continue
      </button>
    </dialog>
  );
}
