# Device parameters — write API contract

Slice 3 makes the read-only parameters (see `GET /api/parameters`) **writable** for a
safe, reversible allowlist. Reads are unchanged.

## POST /api/parameters

Gated (X-FacePod-Tester header + `application/json`). Body: a partial `DeviceParametersPatch`
— any subset of the writable keys, each a `number`:

```
DeviceParametersPatch = Partial<{
  streamMode,                                  // RGB/IR: 0=AUTO, 1=RGB, 2=IR
  minDistance, maxDistance,                    // distance limits
  minRoll, maxRoll, minPitch, maxPitch, minYaw, maxYaw,   // pose limits
  recMinMatchScoreL1, recMinMatchScoreL2, recMinMatchScoreL3,  // match thresholds
}>
```

Response `200`: `{ "results": { <key>: { requested, effective, status } } }` where
`status` is:

- `"applied"`  — the device accepted the value (`effective == requested`).
- `"clamped"`  — the device clamped to a factory-envelope boundary (`effective` moved, ≠ requested).
- `"rejected"` — the device refused (rc=8); the value is unchanged (`effective == original`).

Errors (standard `{ "error": { name, message, httpStatus } }` envelope):

- `422 UnsupportedParameterError` — the body contained a non-allowlisted key (camera/power,
  private, day/night, etc.). **Refused before the device is touched** — nothing was written.
- `409 NotConnectedError` — no open camera context.
- `409 BusyError` — another device operation is in flight.

## Client (`src/api.ts`)

- `api.setParameters(patch)` → `{ results: { … } }`.
- `api.getParameters()` reflects the post-write read-back (re-read after a write to refresh the drawer).

## Notes

- **Writes are context-scoped and NOT persisted** (ground truth §5): every value resets to the
  device default on context close/reopen (disconnect/reconnect, or close-camera/open-camera).
  The kiosk is unaffected by a tester tweak.
- **`CAMERA_ENABLE_HIGH_RES` (11001) is NOT writable here** — it is a camera-class key, hard-blocked
  on the operator surface. (Slice 1 toggles it internally for high-res capture only.)
- The allowlist is enforced at the lib `FaceModule` seam (the single point both the real client and
  the mock flow through), so the refusal behaviour is identical on hardware and in mock mode.
- Mock mode emulates the envelope: widening a pose/distance limit past its default → `rejected`;
  a match threshold outside [0,1] → `clamped`; valid writes → `applied`.
