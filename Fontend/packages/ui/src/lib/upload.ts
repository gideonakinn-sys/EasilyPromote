const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export type UploadType = "image" | "video" | "document";

interface PresignResponse {
  uploadUrl: string;
  key: string;
  contentType: string;
  filename: string;
}

interface ConfirmResponse {
  key: string;
  url: string;
}

async function authedJson<T>(endpoint: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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
  return res.json();
}

function putWithProgress(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

/**
 * Uploads a file via S3 presigned URLs and returns the stable public URL.
 * Flow: 1) presign 2) direct PUT to S3 (with progress) 3) confirm -> public url
 */
export async function uploadFile(
  file: File,
  type: UploadType,
  options: { token?: string | null; path?: string; onProgress?: (percent: number) => void } = {}
): Promise<string> {
  const presign = await authedJson<PresignResponse>(
    "/upload/presign",
    {
      type,
      contentType: file.type || "application/octet-stream",
      filename: file.name,
      ...(options.path ? { path: options.path } : {}),
    },
    options.token || undefined
  );

  await putWithProgress(presign.uploadUrl, file, options.onProgress);

  const confirmed = await authedJson<ConfirmResponse>(
    "/upload/confirm",
    { key: presign.key },
    options.token || undefined
  );

  return confirmed.url;
}