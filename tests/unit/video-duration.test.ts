import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readVideoDuration } from "../../src/server/agent/video-duration.ts";

const FIX = path.join(process.cwd(), "tests/fixtures/videos");

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}
/** Minimal MP4: ftyp + mdat (+ moov/mvhd at the end, as non-faststart files have). */
function mp4(timescale: number, duration: number, version: 0 | 1 = 0): Buffer {
  const mvhd = version === 0 ? Buffer.alloc(100) : Buffer.alloc(112);
  mvhd[0] = version;
  if (version === 0) {
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(duration, 16);
  } else {
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(duration), 24);
  }
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isom")), box("mdat", Buffer.alloc(5000)), box("moov", box("mvhd", mvhd))]);
}

/** Fragmented MP4 (fMP4): durations 0 in moov; timing in moof/traf (tfhd, tfdt, trun). */
function fmp4(): Buffer {
  const full = (v: number, flags: number, rest: Buffer) => Buffer.concat([Buffer.from([v, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), rest]);
  const u32 = (...n: number[]) => Buffer.concat(n.map((x) => { const b = Buffer.alloc(4); b.writeUInt32BE(x); return b; }));
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); // duration 0
  const tkhd = full(0, 3, Buffer.concat([u32(0, 0, 7), Buffer.alloc(72)])); // track_ID 7
  const mdhd = full(0, 0, Buffer.concat([u32(0, 0, 15360, 0), Buffer.alloc(4)])); // timescale 15360, duration 0
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), box("mdia", box("mdhd", mdhd))]));
  const trex = box("trex", full(0, 0, u32(7, 1, 512, 0, 0))); // default sample duration 512
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), trak, box("mvex", trex)]));
  // Fragment 1: 0 s, 30 samples using trex default (512 ticks).
  const frag1 = box("moof", box("traf", Buffer.concat([
    box("tfhd", full(0, 0, u32(7))),
    box("tfdt", full(1, 0, Buffer.concat([u32(0), u32(0)]))),
    box("trun", full(0, 0, u32(30))),
  ])));
  // Fragment 2: starts at 1,582,080 ticks (103 s); 2 samples with explicit durations 7680 each (= 1 s total).
  const frag2 = box("moof", box("traf", Buffer.concat([
    box("tfhd", full(0, 0x08, u32(7, 512))),
    box("tfdt", full(0, 0, u32(1_582_080))),
    box("trun", full(0, 0x100, u32(2, 7680, 7680))),
  ])));
  return Buffer.concat([box("ftyp", Buffer.from("iso5\0\0\0\0iso5")), moov, frag1, box("mdat", Buffer.alloc(3000)), frag2, box("mdat", Buffer.alloc(3000))]);
}

async function tmp(name: string, data: Buffer) {
  const f = path.join(await mkdtemp(path.join(tmpdir(), "dd-dur-")), name);
  await writeFile(f, data);
  return f;
}

describe("readVideoDuration (JDG-07: 3:00 flag without the Files API)", () => {
  it.each([
    ["team-alpha.webm", 120],
    ["team-long.webm", 204],
  ])("should_read_the_webm_duration_of_%s", async (file, seconds) => {
    expect(Math.round((await readVideoDuration(path.join(FIX, file), "video/webm"))!)).toBe(seconds);
  });

  it("should_read_mp4_mvhd_version_0_even_when_moov_is_at_the_end", async () => {
    expect(await readVideoDuration(await tmp("a.mp4", mp4(1000, 104_000)), "video/mp4")).toBeCloseTo(104, 3);
  });

  it("should_read_mp4_mvhd_version_1_with_64_bit_duration", async () => {
    expect(await readVideoDuration(await tmp("b.mov", mp4(600, 122_400, 1)), "video/quicktime")).toBeCloseTo(204, 3);
  });

  it("should_read_fragmented_mp4_from_the_last_fragment_end", async () => {
    expect(await readVideoDuration(await tmp("f.mp4", fmp4()), "video/mp4")).toBeCloseTo(104, 3);
  });

  it("should_return_null_for_unreadable_files", async () => {
    expect(await readVideoDuration(path.join(FIX, "fake.mp4"), "video/mp4")).toBeNull();
    expect(await readVideoDuration(await tmp("c.webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])), "video/webm")).toBeNull();
  });
});
