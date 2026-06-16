interface Props {
  value: unknown;
  label?: string;
  open?: boolean;
}

/** Collapsible pretty-printed JSON for raw result inspection. */
export function JsonViewer({ value, label = "Raw JSON", open = false }: Props) {
  if (value === undefined || value === null) return null;
  return (
    <details className="json" open={open}>
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
