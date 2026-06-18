interface Props { brightness: number | null; distance: "near" | "ok" | "far" | null }

/** Visually distinct from the measured bars — these are inferred in-UI. */
export function DerivedHints({ brightness, distance }: Props) {
  if (brightness == null && distance == null) return null;
  return (
    <div className="derived">
      <span className="derived-tag">Derived · not HID-measured</span>
      {brightness != null && <span className="derived-item">Brightness {Math.round(brightness * 100)}%</span>}
      {distance != null && <span className="derived-item">Distance: {distance}</span>}
    </div>
  );
}
