import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class FileTooLargeError extends Error {
  override name = "FileTooLargeError";
}

/** Stream a request body to disk without buffering it, aborting once it exceeds maxBytes. */
export async function streamToFile(body: ReadableStream<Uint8Array>, dest: string, maxBytes: number, signal?: AbortSignal): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) cb(new FileTooLargeError(`More than ${maxBytes} bytes`));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), limiter, createWriteStream(dest, { flags: "wx" }), { signal });
    return bytes;
  } catch (e) {
    await rm(dest, { force: true });
    throw e;
  }
}
