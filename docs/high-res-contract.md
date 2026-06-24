# High-res still — API contract

## POST /api/capture-high-res

Gated (X-FacePod-Tester header + `application/json`). Body: `{ minimalQuality: number, maximalSpoofScore?: number, timeoutMs?: number }`.

Response `200`: `{ "result": HighResMeta }` where

```
HighResMeta = { hasImage: true, id: string, width?: number, height?: number, encoding: "png" | "jpg" | "jpeg", byteLength: number }
```

or, when no face was captured, `{ "result": { hasImage: false } }` (no `id`).

## GET /api/high-res-image/:id

Gated (X-FacePod-Tester header). **One-shot**: the buffered image is evicted on first fetch.

- On hit: binary body, `Content-Type` = `image/png` or `image/jpeg` (derived from the capture `encoding`).
- On miss (unknown / already-fetched id, or not connected): `404` with `{ "error": { name, message, httpStatus } }`.

## Client (`src/api.ts`)

- `api.captureHighRes(req)` → `{ result: HighResMeta }`.
- `api.downloadHighResImage(id): Promise<Blob>` — sends the gate header; returns a `Blob` on an image response; throws `ApiError` on the JSON error envelope. The UI creates an object URL from the Blob (`URL.createObjectURL(blob)`) and revokes it when done.

## Notes

- The 4K still (~7.5 MB) is never base64-inlined; it streams as binary.
- `encoding` follows the device `CAPTURE_IMAGE_ENCODING` (PNG by default).
- The buffer is in-memory only (PII), evicted on fetch, and cleared on disconnect / teardown.
- A face-present capture that yields no high-res image is reported as `hasImage: false` with `numberOfFaces: 1` at the lib seam (distinguishable from a faceless `numberOfFaces: 0`); the tester contract surfaces only `hasImage: false` either way. Reachability of that branch is to be confirmed on-device (Task 14).
