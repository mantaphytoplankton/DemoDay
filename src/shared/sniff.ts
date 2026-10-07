/** Identify a video container from its first bytes (SNG-01 content check). */
export function sniffVideo(head: Uint8Array): "mp4-family" | "webm" | null {
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "mp4-family"; // "ftyp": MP4, MOV
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm"; // EBML
  return null;
}
