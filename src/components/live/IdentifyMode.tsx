import { ComingSoon } from "./ComingSoon.tsx";

export function IdentifyMode() {
  return (
    <div className="mode-pane identify-pane">
      <ComingSoon slice={4}>
        Enrollment and 1:N identify need the on-device template database (Slice 4).
        The gallery, Enroll, and Identify are disabled until that backend lands.
      </ComingSoon>
      <div className="identify-gallery" aria-disabled="true">
        <div className="pane-eyebrow">Enrolled gallery</div>
        <div className="gallery-empty">
          No enrolled templates. Enrollment arrives in Slice 4.
        </div>
      </div>
      <div className="identify-dock" aria-disabled="true">
        <button className="big-btn" disabled>Identify (1:N)</button>
        <button className="enroll-btn" disabled>＋ Enroll current face</button>
      </div>
    </div>
  );
}
