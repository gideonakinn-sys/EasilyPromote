const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export type UploadType = "image" | "video" | "document";

interface UploadResponse {
  url: string;
  publicId?: string;
}

/**
 * Uploads a file to Cloudinary via the backend and returns the stable URL.
 * Flow: POST the file as multipart/form-data to /api/upload/{type}.
 */
export async function uploadFile(
  file: File,
  type: UploadType,
  options: { token?: string | null; path?: string; onProgress?: (percent: number) => void } = {}
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  if (options.path) form.append("path", options.path);

  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${API_URL}/upload/${type}`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    let msg = "Upload failed";
    try {
      const parsed = await res.json();
      if (parsed?.error) msg = parsed.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as UploadResponse;
  return data.url;
}