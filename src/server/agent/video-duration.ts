import { open, type FileHandle } from "node:fs/promises";

/**
 * Video length from the container header, for providers that do not report it (Vertex AI inline video).
 * MP4/MOV: moov/mvhd (also when moov sits at the end of the file). WebM: Segment/Info Duration × TimecodeScale.
 * Returns null when the length cannot be read; callers then skip the duration flag rather than guess.
 */
export async function readVideoDuration(path: string, mimeType: string): Promise<number | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, "r");
    return mimeType === "video/webm" ? await webmDuration(fh) : await mp4Duration(fh);
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

async function read(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

// ---------- MP4 / MOV ----------

/** Child boxes of a box payload: [type, payload]. */
function* children(buf: Buffer): Generator<[string, Buffer]> {
  let p = 0;
  while (p + 8 <= buf.length) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let hl = 8;
    if (size === 1 && p + 16 <= buf.length) {
      size = Number(buf.readBigUInt64BE(p + 8));
      hl = 16;
    } else if (size === 0) {
      size = buf.length - p;
    }
    if (size < hl) return;
    yield [type, buf.subarray(p + hl, Math.min(buf.length, p + size))];
    p += size;
  }
}
const child = (buf: Buffer, type: string) => {
  for (const [t, b] of children(buf)) if (t === type) return b;
  return undefined;
};

interface Mp4Tracks {
  timescale: Map<number, number>; // track_ID → mdhd timescale
  defaultDuration: Map<number, number>; // track_ID → trex default_sample_duration
}

/**
 * Plain MP4: mvhd duration / timescale. Fragmented MP4 (common for screen and browser recordings) has
 * duration 0 there; the length is then the latest fragment end (tfdt + sample durations) per track.
 */
async function mp4Duration(fh: FileHandle): Promise<number | null> {
  const { size: fileSize } = await fh.stat();
  let tracks: Mp4Tracks | null = null;
  const ends = new Map<number, number>(); // track_ID → latest fragment end, in track ticks
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const head = await read(fh, offset, 16);
    if (head.length < 8) break;
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let headerLen = 8;
    if (size === 1) {
      size = Number(head.readBigUInt64BE(8));
      headerLen = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < headerLen) break;
    if (type === "moov") {
      const moov = await read(fh, offset + headerLen, Math.min(size - headerLen, 64 * 1024 * 1024));
      const plain = mvhdDuration(moov);
      if (plain !== null && plain > 0) return plain;
      tracks = trackInfo(moov);
    } else if (type === "moof" && tracks) {
      fragmentEnds(await read(fh, offset + headerLen, Math.min(size - headerLen, 16 * 1024 * 1024)), tracks, ends);
    }
    offset += size;
  }
  if (!tracks) return null;
  let best: number | null = null;
  for (const [id, end] of ends) {
    const ts = tracks.timescale.get(id);
    if (ts) best = Math.max(best ?? 0, end / ts);
  }
  return best;
}

function mvhdDuration(moov: Buffer): number | null {
  const mvhd = child(moov, "mvhd");
  if (!mvhd) return null;
  const v1 = mvhd[0] === 1;
  const timescale = v1 ? mvhd.readUInt32BE(20) : mvhd.readUInt32BE(12);
  const duration = v1 ? Number(mvhd.readBigUInt64BE(24)) : mvhd.readUInt32BE(16);
  return timescale > 0 ? duration / timescale : null;
}

function trackInfo(moov: Buffer): Mp4Tracks {
  const info: Mp4Tracks = { timescale: new Map(), defaultDuration: new Map() };
  for (const [t, trak] of children(moov)) {
    if (t !== "trak") continue;
    const tkhd = child(trak, "tkhd");
    const mdhd = child(child(trak, "mdia") ?? Buffer.alloc(0), "mdhd");
    if (!tkhd || !mdhd) continue;
    const id = tkhd.readUInt32BE(tkhd[0] === 1 ? 20 : 12);
    info.timescale.set(id, mdhd.readUInt32BE(mdhd[0] === 1 ? 20 : 12));
  }
  for (const [t, trex] of children(child(moov, "mvex") ?? Buffer.alloc(0))) {
    if (t === "trex") info.defaultDuration.set(trex.readUInt32BE(4), trex.readUInt32BE(12));
  }
  return info;
}

function fragmentEnds(moof: Buffer, tracks: Mp4Tracks, ends: Map<number, number>): void {
  for (const [t, traf] of children(moof)) {
    if (t !== "traf") continue;
    const tfhd = child(traf, "tfhd");
    if (!tfhd) continue;
    const flags = tfhd.readUInt32BE(0) & 0xffffff;
    const id = tfhd.readUInt32BE(4);
    let p = 8;
    if (flags & 0x1) p += 8; // base_data_offset
    if (flags & 0x2) p += 4; // sample_description_index
    const defaultDuration = flags & 0x8 ? tfhd.readUInt32BE(p) : (tracks.defaultDuration.get(id) ?? 0);
    const tfdt = child(traf, "tfdt");
    let time = tfdt ? (tfdt[0] === 1 ? Number(tfdt.readBigUInt64BE(4)) : tfdt.readUInt32BE(4)) : (ends.get(id) ?? 0);
    for (const [tt, trun] of children(traf)) {
      if (tt !== "trun") continue;
      const tf = trun.readUInt32BE(0) & 0xffffff;
      const count = trun.readUInt32BE(4);
      let q = 8;
      if (tf & 0x1) q += 4; // data_offset
      if (tf & 0x4) q += 4; // first_sample_flags
      const perSample = [0x100, 0x200, 0x400, 0x800].filter((f) => tf & f).length * 4;
      if (tf & 0x100) {
        for (let i = 0; i < count && q + 4 <= trun.length; i++, q += perSample) time += trun.readUInt32BE(q);
      } else {
        time += count * defaultDuration;
      }
    }
    ends.set(id, Math.max(ends.get(id) ?? 0, time));
  }
}

// ---------- WebM (EBML) ----------

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

/** EBML element ID (kept with its marker bits, as IDs are written in specs). */
function readId(buf: Buffer, p: number): { id: number; len: number } | null {
  const first = buf[p];
  if (first === undefined || first === 0) return null;
  const len = Math.clz32(first) - 23; // 1..4
  if (len < 1 || len > 4 || p + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[p + i]!;
  return { id, len };
}

/** EBML data size (marker bit removed). "Unknown size" (all ones) returns Infinity. */
function readSize(buf: Buffer, p: number): { size: number; len: number } | null {
  const first = buf[p];
  if (first === undefined || first === 0) return null;
  const len = Math.clz32(first) - 23; // 1..8
  if (len < 1 || len > 8 || p + len > buf.length) return null;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[p + i]!;
    if (buf[p + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? Infinity : value, len };
}

async function webmDuration(fh: FileHandle): Promise<number | null> {
  const buf = await read(fh, 0, 1024 * 1024); // Info sits near the start of the Segment
  let p = 0;
  // EBML header element, then the Segment.
  const header = readId(buf, p);
  const headerSize = header && readSize(buf, p + header.len);
  if (!header || !headerSize || !Number.isFinite(headerSize.size)) return null;
  p += header.len + headerSize.len + headerSize.size;
  const seg = readId(buf, p);
  const segSize = seg && readSize(buf, p + seg.len);
  if (!seg || seg.id !== ID_SEGMENT || !segSize) return null;
  p += seg.len + segSize.len;

  // Walk the Segment's children until Info.
  while (p < buf.length) {
    const el = readId(buf, p);
    const sz = el && readSize(buf, p + el.len);
    if (!el || !sz || !Number.isFinite(sz.size)) return null;
    const dataStart = p + el.len + sz.len;
    if (el.id === ID_INFO) return infoDuration(buf.subarray(dataStart, dataStart + sz.size));
    p = dataStart + sz.size;
  }
  return null;
}

function infoDuration(info: Buffer): number | null {
  let scale = 1_000_000; // nanoseconds per tick (EBML default)
  let duration: number | null = null;
  let p = 0;
  while (p < info.length) {
    const el = readId(info, p);
    const sz = el && readSize(info, p + el.len);
    if (!el || !sz || !Number.isFinite(sz.size)) break;
    const data = info.subarray(p + el.len + sz.len, p + el.len + sz.len + sz.size);
    if (el.id === ID_TIMECODE_SCALE) scale = data.reduce((v, b) => v * 256 + b, 0);
    if (el.id === ID_DURATION) duration = data.length === 4 ? data.readFloatBE(0) : data.length === 8 ? data.readDoubleBE(0) : null;
    p += el.len + sz.len + sz.size;
  }
  return duration === null ? null : (duration * scale) / 1e9;
}
