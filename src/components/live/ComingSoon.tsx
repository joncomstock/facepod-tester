import type { ReactNode } from "react";

interface Props {
  slice: number;
  children?: ReactNode;
}

/** A prominent "not built yet" banner for deferred capability regions. */
export function ComingSoon({ slice, children }: Props) {
  return (
    <div className="coming-soon" role="note">
      <span className="cs-badge">Coming soon — Slice {slice}</span>
      {children ? <div className="cs-copy">{children}</div> : null}
    </div>
  );
}
