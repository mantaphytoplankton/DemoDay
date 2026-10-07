export const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/;

/**
 * Extract the folder id from a Google Drive folder link (app-design.md section 8.1).
 * Accepts /drive/folders/{id}, /drive/u/{n}/folders/{id}, /drive/mobile/folders/{id} and /open?id={id}.
 */
export function parseFolderUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.hostname !== "drive.google.com") return null;
  const m = url.pathname.match(/^\/drive\/(?:u\/\d+\/|mobile\/)?folders\/([^/]+)\/?$/);
  const id = m?.[1] ?? (url.pathname === "/open" ? url.searchParams.get("id") : null);
  return id && DRIVE_ID_RE.test(id) ? id : null;
}

export function isDriveId(id: string): boolean {
  return DRIVE_ID_RE.test(id);
}
