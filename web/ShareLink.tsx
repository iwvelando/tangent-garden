import { useEffect, useRef, useState } from "react";
import {
  LinkError,
  studyHref,
  writeStudyLink,
  type Notebook,
} from "./study-link";

type Notice =
  | { kind: "copied" }
  | { kind: "manual"; href: string }
  | { kind: "error"; text: string };

// Copies a link that reopens the current study (see study-link.ts). Where
// the clipboard is refused, the link is shown selected for copying by hand.
// Notices float below the button, so nothing beside it moves.
export function ShareLink({
  notebook,
  study,
  disabled,
}: {
  notebook: Notebook;
  // Read when clicked, so the link reflects the study at that moment.
  study: () => unknown;
  disabled: boolean;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!notice) return;
    if (notice.kind === "manual") field.current?.select();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setNotice(null);
    };
    document.addEventListener("pointerdown", outside);
    const timer =
      notice.kind === "copied" ? setTimeout(() => setNotice(null), 2500) : 0;
    return () => {
      document.removeEventListener("pointerdown", outside);
      clearTimeout(timer);
    };
  }, [notice]);
  async function copy() {
    setNotice(null);
    let href: string;
    try {
      href = studyHref(
        location.href,
        notebook,
        await writeStudyLink(notebook, study()),
      );
    } catch (e) {
      setNotice({
        kind: "error",
        text:
          e instanceof LinkError
            ? e.message
            : "This study could not be linked.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(href);
      setNotice({ kind: "copied" });
    } catch {
      setNotice({ kind: "manual", href });
    }
  }
  return (
    <div
      className="export-menu share-link"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" && notice) {
          e.preventDefault();
          setNotice(null);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        disabled={disabled}
        title="Copy a link that opens this study, its layers, view, and animation"
        aria-label="Copy link"
        onClick={() => void copy()}
      >
        {/* Narrow headers show only the chain, beside the other actions. */}
        <svg className="share-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
          <path d="M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
        </svg>
        <span className="share-label">Copy link</span>
      </button>
      {notice?.kind === "copied" && (
        <span className="share-popup" role="status">
          Link copied
        </span>
      )}
      {notice?.kind === "manual" && (
        <label className="share-popup share-manual">
          Copy this link
          <input ref={field} readOnly value={notice.href} />
        </label>
      )}
      {notice?.kind === "error" && (
        <p className="export-menu-error" role="alert">
          {notice.text}
        </p>
      )}
    </div>
  );
}

// Why an opened link left the study unchanged, until dismissed.
export function LinkNotice({
  text,
  onDismiss,
}: {
  text: string;
  onDismiss: () => void;
}) {
  return (
    <div className="link-notice" role="alert">
      <p>
        <strong>This link couldn’t be opened.</strong> {text}
      </p>
      <button onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
