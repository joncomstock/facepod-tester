# FacePod Tester — Single-Screen UI · Design Prompt

> Paste everything below the line into Claude Design (or any UI-generation tool).
> It is self-contained — it assumes no access to the codebase.

---

## What you're designing

Design a **single-screen operator UI for the "FacePod Tester"** — a local hardware
test/demo utility for a **biometric face module** (the "FacePod"). An operator stands a
person in front of a camera; the app watches a continuous live feed and shows, at a
glance, every biometric stat the device and API expose, plus an ACCEPT / REJECT verdict.
A secondary "match against a reference photo" action lives inline. There is **no login,
no database, no multi-page flow** — it is one screen running on a fixed kiosk.

**The single overriding goal:** a user must be able to operate the *entire* workflow —
go live, watch the feed, read all telemetry, manage a reference image, run a match, read
the verdict, and reach settings — **on one screen, with no page scrolling** on the target
kiosk. Collapse everything into one view. Do not design tabs, wizards, or stepped panels.

This is a dense, technical, "mission-control" instrument panel for a trained operator —
not a consumer onboarding flow. Favor information density and legibility over whitespace
and marketing polish, but keep it sharp and premium.

---

## Hard constraints (do not violate)

1. **Target device: an 800 × 1280 px portrait, touch kiosk.** This is the primary and
   governing canvas. Design the main composition at **800 × 1280 portrait**. Everything
   the operator needs must fit within that viewport at once.
2. **No page scroll on the kiosk.** The page itself never scrolls. Exactly **one region —
   the "Frame Data" pane — is allowed to scroll internally** (it can hold a long payload
   like many landmark points). Nothing else scrolls; nothing critical is below a fold.
3. **Touch-first.** Big tap targets — primary action buttons ≥ 64 px tall; any control
   ≥ 44 px tall. No hover-only affordances; assume a finger, not a mouse.
4. **Live-data honesty (reflect this in the visual logic):**
   - **Liveness fails closed** — never render a "live/pass" state the device didn't
     actually measure. When unknown, show neutral/fail, never green.
   - **Match requires a reference** — with no reference loaded, the Match gauge reads
     **"No reference"** (not 0%, not an empty bar).
   - Some values are **derived in-UI, not measured by the device** (e.g. brightness,
     distance). Label those explicitly as **"derived, not HID-measured."**
5. **No biometric data-at-rest.** A reference image/template is **session-only, held in
   memory**. There is **no enrollment, no gallery, no saved records** — so design no
   "saved faces" list, history, or persistence UI.

Also design a **responsive narrow fallback (≤ 560 px wide):** single column, stacked in
this order — **Feed → gauges → reference/dock → Frame Data**. On narrow widths the page
*may* scroll (Frame Data last), and Settings opens as a **bottom sheet** instead of a
centered modal. "Single screen" means *one unified workflow*, not literally zero scroll on
phone widths — but on the 800 × 1280 kiosk it must be no-scroll.

---

## Screen layout (the live, connected state — the main view)

Two columns above a full-width action dock. **The feed has visual priority.**

```
┌──────────────────────────────────────────────┐  800 px wide
│ ▪ FacePod Tester      ● CAMERA OPEN        ⚙  │  header: title · state pill (·mock) · gear
├───────────────────────────┬──────────────────┤
│  FEED (9:16 viewfinder)   │  FRAME DATA        │  right pane scrolls internally
│   · verdict chip (top)    │  ▸ Face            │  (overflow-y:auto), top-aligned
│   · corner brackets       │  ▸ Capture         │
│   · bbox + landmark dots  │  ▸ Liveness        │
│   · guidance caption      │  ▸ Match           │
├───────────────────────────┤  ▸ Stream         │
│  QUALITY   ▓▓▓▓░░  83%     │                    │
│  LIVENESS  ▓▓▓▓▓▓ 100%     │                    │
│  MATCH     ░░░░░░  No ref  │                    │
│  guidance footnote        │                    │
├───────────────────────────┴──────────────────┤
│  Start/Stop watching │ End session │ Reference │  dock: full width, big touch buttons
└──────────────────────────────────────────────┘
```

- **Left column (≈ 60% width, the priority):** the Feed (hero viewfinder) on top, then
  the three telemetry gauges (Quality / Liveness / Match) stacked beneath it, then a small
  guidance footnote.
- **Right column (≈ 40% width):** the "Frame Data" pane, top-aligned, **its own internal
  scroll**, capped to the height of the left column so it never pushes the page taller.
- **Feed sizing:** keep the feed's native **9:16 portrait aspect ratio**, but **height-cap
  it** so Feed + gauges + dock all fit the kiosk viewport without page scroll. On the
  800 × 1280 kiosk the height cap is what binds (≈ 40% of viewport height, capped). So
  "60% width" is a ceiling, not a fixed width — the feed is centered in its column.
- **Dock (full width, spanning both columns):** the watch toggle, End session, and the
  reference/match controls. Big rounded touch buttons (~64 px tall).

---

## Components (full functionality — design every one)

### 1. Header
- Left: **`▪ FacePod Tester`** wordmark (a small glowing cyan square mark precedes it).
- Center: a **state pill** — one of `DISCONNECTED` (muted grey), `CONNECTED` (green),
  `CAMERA OPEN` (cyan), `ERROR` (red). When mock mode is on, append a small **`MOCK`** tag
  pill beside it. The pill reflects *connection/camera* status — keep it visually distinct
  from *watching* status (which lives on the dock button + the feed verdict chip).
- Right: a **⚙ gear icon button** that opens Settings.
- No "Busy" indicator (the continuous watch loop would keep it lit permanently and
  meaningless). No Live/Manual toggle — there is only one screen.

### 2. Feed (hero viewfinder)
The centerpiece. A 9:16 portrait viewfinder showing the live camera frame, with overlays:
- **Corner brackets** (glowing cyan L-shaped framing brackets in all four corners) — a
  targeting-reticle feel.
- **Bounding box** around the detected face (glowing green rounded rectangle) and **5
  landmark dots** (small glowing green dots: eyes, nose, mouth corners), positioned over
  the face.
- A subtle **scan-line sweep** and faint **film grain** for a "live sensor" texture.
- **Verdict chip** — a pill overlaid at the **top-center** of the feed, color-coded and
  stateful:
  - `Searching…` (muted, uppercase, small) when no face,
  - `Acquiring…` (cyan) when a face is detected but not yet finalized,
  - `✓ ACCEPT` (green, glowing, with a small pop animation) when all gates pass,
  - `✗ REJECT` (red, glowing) with a short reason (e.g. "low quality", "spoof").
- **Feed status badge** — a small pill at the **top-right** of the feed for the video lane:
  `PAUSED` (muted) when watching is stopped, or `NO SIGNAL` (amber) when frames have gone
  stale while watching is on.
- **Guidance caption** — a translucent blurred bar near the bottom of the feed with a
  positioning instruction + arrow, e.g. "→ Move a little closer", "Turn left", "Lift chin".
  (These come from the device's positioning feedback.)
- Border state: tint the feed border green when a face is locked/accepted, cyan when a face
  is merely present.

### 3. Telemetry gauges (three)
Stacked beneath the feed. **All three are higher-is-better, left-to-right fill, with the
threshold marker = the minimum needed to pass.** Per gauge:
- **Header line:** the gauge `NAME` (uppercase, tracked, left) and its **`value%`** (large,
  bold, tabular-numerals, right). Color the value green when passing, amber near the
  margin, red when failing; muted when N/A.
- **Full-width track** below the header line, with a colored fill (green/amber/red to match
  the value) and **two ticks**:
  - a **solid threshold marker** at the configured minimum (labeled e.g. `min 70`), and
  - a **dashed amber "device" tick** at the device-recommended value (labeled `device`),
    reference-only.
  Position both ticks and their labels within each gauge's own vertical band so adjacent
  gauges never overlap. Generous vertical spacing between the three gauges.

The three gauges:
- **QUALITY** — face image quality, 0–100%, pass if ≥ min quality.
- **LIVENESS** — shown as **confidence = (1 − spoof score)**, 0–100%, pass if confidence
  ≥ the threshold. (Deliberately *not* a downward "spoof" gauge — a raw spoof of 0 = best
  would render as an empty/failing bar.) The raw spoof number stays inspectable in Frame
  Data, not as a gauge.
- **MATCH** — match score vs the loaded reference, 0–100%, pass if ≥ min match. Reads
  **"No reference"** (muted) when no reference is set.

A small **guidance footnote** sits below the gauges. Gauges + Frame Data dim to ~55% and
read **"Paused"** when watching is stopped, or **"No signal"** when frames go stale.

### 4. Frame Data pane (right column — grouped, internally scrollable)
A dense, always-visible readout of raw device + API output, **grouped under labeled
sub-sections** (each with a small cyan left-border label), key on the left / value on the
right (tabular numerals), in its **own independently-scrolling pane**:
- **Face:** Faces (count), Face status, Bounding box, Landmarks, Positioning
- **Capture:** Captured (yes/no), Quality, Template (present/absent chip)
- **Liveness:** Spoof score (raw, labeled "lower is better"), Liveness PASS/FAIL
- **Match:** Match score, Match PASS/FAIL
- **Stream:** Frame size, Frame type, Feed rate (fps), Brightness *(derived)*, Distance
  *(derived)*

Color PASS green / FAIL red. Dim the whole pane (or stale groups) when paused/stale.

### 5. Action dock (full width)
- **Watch button** — a single large stateful toggle: **`Start watching` ⇄ `Stop watching`**.
  Stopping pauses both the video feed and the capture telemetry (feed clears to "Paused",
  gauges + Frame Data read "Paused"); the camera stays open. Starting resumes both.
- **End session** — disconnects and closes the camera, returning to the idle "Go Live"
  scene. Style it as a quieter/danger-tinted button, distinct from the watch toggle.
- **Reference / match (inline — this is the whole match workflow, no separate screen):**
  - **No reference yet:** two controls — **`Set from photo…`** (file upload) and **`Use
    current face`** (capture the current live frame as the reference).
  - **Reference set:** a **thumbnail/source chip** (the uploaded photo thumbnail, or a
    "current face" label if captured live) plus **`Replace`** and **`Clear`**. Both
    reference sources stay reachable.
  - **`Use current face` is gated:** enabled only when the current frame is a fresh,
    finalized capture with exactly one face, a template present, quality ≥ min, and
    liveness measured & passing. When the gate fails, disable it with an inline hint:
    "Hold a single face in view at good quality to use it as the reference."
  - Setting / replacing / clearing the reference updates the Match gauge and the verdict
    continuously.

### 6. Settings (gear → centered modal on the kiosk, bottom sheet on narrow ≤ 560 px)
A single surface containing only:
- **Thresholds:** min Quality, max Spoof, min Match, capture timeout (ms). Threshold
  changes apply immediately to the running watch loop.
- **Mock:** an on/off toggle + a **scenario picker** (`good`, `low-quality`, `spoof`,
  `no-face`, `no-match`, `device-error`, `approach`). Scenario applies immediately while
  connected in mock; the on/off toggle applies on the next session.

---

## Other states to design (besides the main live view)

- **Idle / not connected:** a centered hero scene — a glowing rounded app mark, a large
  title (e.g. "FacePod Tester"), a one-line subtitle, and one big primary **`Go Live`**
  button (~74 px tall). Tapping it connects, opens the camera, and starts watching in one
  action.
- **Connecting:** a centered scene with a spinning cyan ring and "Bringing the camera
  online…".
- **Error:** a red-tinted banner near the top with an uppercase error title, a monospace
  error code, and a human-readable message.
- **No reference:** Match gauge reads "No reference"; dock shows the two "set reference"
  controls.
- **Accept vs Reject:** the feed verdict chip and gauge colors shift together (green vs
  red), with the accept pop animation.

---

## Visual language (match this precisely — it's the "AirOps" dark instrument theme)

**Mood:** near-black canvas, a single bright-cyan accent, hairline flat frames, tinted
pill badges, uppercase tracking-wide eyebrow labels, and a signature **cyan glow on the
live data that matters** (gauges, marks, active states). Dark, premium, high-contrast,
data-forward. Avoid generic SaaS gradients, rounded cartoon illustrations, drop-shadowed
cards, or pastel palettes.

**Color tokens (HSL):**
- Background `hsl(0 0% 5%)` (with a faint cyan radial glow top-right), Foreground
  `hsl(0 0% 98%)`
- Card `hsl(0 0% 10%)`, Muted `hsl(0 0% 14%)`, Muted-foreground `hsl(0 0% 62%)`,
  Accent `hsl(0 0% 16%)`, Border `hsl(0 0% 18%)` (1px hairlines)
- **Primary / accent (cyan):** `hsl(198 100% 64%)` — used for the mark, active state,
  ticks, glow, primary buttons
- Success (green) `hsl(142 69% 58%)`, Warning (amber) `hsl(45 100% 55%)`, Destructive
  (red) `hsl(0 84% 62%)`
- **Signature glow:** `drop-shadow(0 0 3px cyan/0.9) drop-shadow(0 0 6px cyan/0.55)` on the
  data that matters.

**Type:** **Urbanist** (a geometric sans), weights 300–800. Big bold tabular-numeral
values for metrics; uppercase, letter-spaced (~0.08em) small labels for eyebrows/section
titles; a monospace face for codes/JSON/templates.

**Shape:** base radius ~6px for inputs/buttons; larger radii (14–18px) for the feed,
gauges' rounded tracks, dock buttons, and the idle mark. Pills are fully rounded (999px).

**Motion:** subtle staggered fade/translate-in on load; a slow scan-line sweep on the feed;
a small pop when the verdict flips to ACCEPT. Respect `prefers-reduced-motion` (no motion).

---

## Explicitly out of scope (do NOT design these)

- Tabs, a Live/Manual toggle, or any stepped/wizard panels.
- Camera selection, DLL path/dir, or poll-interval inputs (server defaults; not in the UI).
- A separate single-shot "capture" button or a standalone match screen/modal — match is
  inline in the dock.
- Any enrollment, saved-faces gallery, history, or biometric persistence UI.
- A "Busy" status indicator.

---

## What to deliver

1. The **800 × 1280 portrait kiosk** main view (live + watching, with a face detected and
   an ACCEPT verdict) — the hero composition.
2. A couple of key **alternate states** at the same size: the **idle "Go Live"** scene, and
   a **REJECT / no-reference** state (gauge + verdict differences visible).
3. The **Settings** surface (centered modal).
4. The **narrow ≤ 560 px** stacked fallback (Feed → gauges → dock → Frame Data; Settings as
   a bottom sheet).

Prioritize, in order: (1) everything fitting one no-scroll kiosk screen, (2) feed priority +
legible gauges, (3) faithful AirOps dark-instrument styling.
