import { sniffVideo } from "@/shared/sniff";

export type VideoMime = "video/mp4" | "video/quicktime" | "video/webm";
const BY_EXT: Record<string, VideoMime> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export type CheckResult = { ok: true; mime: VideoMime } | { ok: false; code: "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE" | "NOT_A_VIDEO" | "EMPTY_FILE" };

/** Same checks as the server, run first in the browser so the judge gets an answer before uploading. */
export async function checkFile(file: File, maxBytes: number): Promise<CheckResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = BY_EXT[ext];
  if (!mime || (file.type && file.type !== mime)) return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (file.size === 0) return { ok: false, code: "EMPTY_FILE" };
  if (file.size > maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const kind = sniffVideo(head);
  if (!kind || (mime === "video/webm") !== (kind === "webm")) return { ok: false, code: "NOT_A_VIDEO" };
  return { ok: true, mime };
}

/** Video length from the browser decoder; null if this browser cannot read the codec (the server measures it later). */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (d: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    v.src = url;
  });
}

export type UploadOutcome = { ok: true; id: string } | { ok: false; message: string };

/** XHR rather than fetch: only XHR reports upload progress. */
export function uploadVideo(file: File, mime: VideoMime, onProgress: (sent: number) => void, fallbackMessage: string): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/evaluations");
    xhr.setRequestHeader("Content-Type", mime);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status === 202) resolve({ ok: true, id: body.evaluationId });
        else resolve({ ok: false, message: body?.error?.message ?? fallbackMessage });
      } catch {
        resolve({ ok: false, message: fallbackMessage });
      }
    };
    xhr.onerror = () => resolve({ ok: false, message: fallbackMessage });
    xhr.send(file);
  });
}
