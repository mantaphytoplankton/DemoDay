export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  shortcutDetails?: { targetId: string; targetMimeType?: string };
}

export type VideoSelection = { kind: "none" } | { kind: "one"; file: DriveFile; others: number };

/** BAT-03: none → fail; one → use it; several → most recently modified, with a count for the warning. */
export function selectVideo(videos: DriveFile[]): VideoSelection {
  if (videos.length === 0) return { kind: "none" };
  const sorted = [...videos].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
  return { kind: "one", file: sorted[0]!, others: videos.length - 1 };
}
