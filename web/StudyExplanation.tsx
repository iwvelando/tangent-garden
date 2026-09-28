import type { ReactNode } from "react";

export function StudyExplanation({
  label = "BEHIND THE LINES",
  title,
  children,
  formula,
  diagnostics,
  note,
}: {
  label?: string;
  title: string;
  children: ReactNode;
  formula: ReactNode;
  diagnostics?: ReactNode;
  note: string;
}) {
  return (
    <>
      <div className="explanation">
        <div>
          <span className="section-label">{label}</span>
          <h2>{title}</h2>
        </div>
        <div className="explanation-body">
          {children}
          <div className="formula">{formula}</div>
        </div>
      </div>
      {diagnostics}
      <p className="bottom-note">
        {note} Finite sampling can miss fine detail; compare resolutions near
        singularities.
      </p>
      <p className="closing">An open notebook for mathematical beauty.</p>
    </>
  );
}
