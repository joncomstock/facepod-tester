import type { ImageDatatype } from "../api.ts";

export interface ReadImageOk {
  data: string;
  datatype: ImageDatatype;
  previewUrl: string;
  fileName: string;
}

function detectDatatype(mime: string, fileName: string): ImageDatatype | null {
  if (mime === "image/png" || fileName.toLowerCase().endsWith(".png")) return "png";
  if (mime === "image/jpeg" || /\.jpe?g$/i.test(fileName)) return "jpeg";
  return null;
}

export function readImageFile(file: File): Promise<ReadImageOk | { error: string }> {
  return new Promise((resolve) => {
    const datatype = detectDatatype(file.type, file.name);
    if (!datatype) {
      resolve({ error: `Unsupported file type "${file.type || file.name}". Use PNG or JPEG.` });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const base64 = url.split(",")[1] ?? "";
      resolve({ data: base64, datatype, previewUrl: url, fileName: file.name });
    };
    reader.onerror = () => resolve({ error: "Could not read file." });
    reader.readAsDataURL(file);
  });
}
