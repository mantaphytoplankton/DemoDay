/**
 * Protocol-level fake of the Google Drive API v3, for automated tests only (JUDGE_UPSTREAM=fixture,
 * refused in production). It rejects /files listings without supportsAllDrives and
 * includeItemsFromAllDrives, so tests enforce that tech-spec rule.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

export interface FakeNode {
  id: string;
  name: string;
  mimeType: string;
  parent?: string;
  modifiedTime?: string;
  content?: Uint8Array;
  restricted?: boolean; // listed, but downloads return 404 (not shared)
  targetId?: string;
  targetMimeType?: string;
}

export interface FakeDriveOptions {
  nodes?: FakeNode[];
  pageSize?: number;
  /** Return a 403 rateLimitExceeded this many times for the first listing of this folder id. */
  rateLimitOnce?: Record<string, number>;
  /** Folder ids whose listings always fail with 500. */
  brokenFolders?: string[];
  base?: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, reason: string, message: string) => json({ error: { code: status, message, errors: [{ reason, message }] } }, status);

export function fixtureVideo(marker = ""): Uint8Array {
  const base = readFileSync(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
  return new Uint8Array(Buffer.concat([base, Buffer.from(marker)]));
}

/** The default tree used by fixture mode and E2E: one root with teams covering each BAT/RSM case. */
export function defaultFixtureTree(): FakeNode[] {
  const root = "fixtureHackathonRoot01";
  const t = (id: string, name: string): FakeNode => ({ id, name, mimeType: FOLDER, parent: root });
  return [
    { id: root, name: "Fixture Hackathon 2026", mimeType: FOLDER },
    t("teamFolderAlpha001", "Team 1 Alpha"),
    { id: "videoAlpha00000001", name: "demo.webm", mimeType: "video/webm", parent: "teamFolderAlpha001", modifiedTime: "2026-10-01T10:00:00Z", content: fixtureVideo() },
    { id: "pdfAlpha000000001", name: "README.pdf", mimeType: "application/pdf", parent: "teamFolderAlpha001" },
    t("teamFolderBeta0001", "Team 2 Beta"),
    { id: "pdfBeta0000000001", name: "pitch.pdf", mimeType: "application/pdf", parent: "teamFolderBeta0001" },
    t("teamFolderGamma001", "Team 3 Gamma"),
    { id: "videoGammaV100001", name: "v1.webm", mimeType: "video/webm", parent: "teamFolderGamma001", modifiedTime: "2026-10-01T10:00:00Z", content: fixtureVideo("DD-SCENARIO:unprocessable") },
    { id: "videoGammaV200001", name: "v2.webm", mimeType: "video/webm", parent: "teamFolderGamma001", modifiedTime: "2026-10-03T10:00:00Z", content: fixtureVideo() },
    t("teamFolderEcho0001", "Team 4 Echo"),
    { id: "videoEchoLocked01", name: "private.webm", mimeType: "video/webm", parent: "teamFolderEcho0001", modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo(), restricted: true },
    t("teamFolderFoxtrot1", "Team 5 Foxtrot"),
    { id: "videoFoxtrot00001", name: "broken.webm", mimeType: "video/webm", parent: "teamFolderFoxtrot1", modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo("DD-SCENARIO:unprocessable") },
    t("teamFolderDelta001", "Team 10 Delta"),
    { id: "shortcutDelta0001", name: "Shortcut to demo", mimeType: SHORTCUT, parent: "teamFolderDelta001", targetId: "videoDeltaReal001", targetMimeType: "video/webm" },
    { id: "videoDeltaReal001", name: "delta-demo.webm", mimeType: "video/webm", parent: "someOtherFolder01", modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo("DD-DURATION:204") },
    { id: "videoLooseRoot001", name: "loose.webm", mimeType: "video/webm", parent: root, content: fixtureVideo() },
    { id: "fixtureEmptyRoot01", name: "Empty event", mimeType: FOLDER },
    // A second small event for pause/resume tests.
    { id: "fixtureSecondRoot01", name: "Second Event", mimeType: FOLDER },
    ...[1, 2, 3].flatMap((i): FakeNode[] => [
      { id: `secondTeamFolder0${i}`, name: `Squad ${i}`, mimeType: FOLDER, parent: "fixtureSecondRoot01" },
      { id: `secondTeamVideo00${i}`, name: `squad${i}.webm`, mimeType: "video/webm", parent: `secondTeamFolder0${i}`, modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo(`squad-${i}`) },
    ]),
    { id: "notAFolderFile0001", name: "file.webm", mimeType: "video/webm", content: fixtureVideo() },
  ];
}

export class FakeDrive {
  readonly base: string;
  readonly nodes = new Map<string, FakeNode>();
  readonly requests: { path: string; q?: string; hasKey: boolean }[] = [];
  private readonly pageSize: number;
  private readonly rateLimit: Record<string, number>;
  private readonly broken: Set<string>;

  constructor(o: FakeDriveOptions = {}) {
    this.base = o.base ?? "https://fake-drive.test/drive/v3";
    for (const n of o.nodes ?? defaultFixtureTree()) this.nodes.set(n.id, n);
    this.pageSize = o.pageSize ?? 100;
    this.rateLimit = { ...(o.rateLimitOnce ?? {}) };
    this.broken = new Set(o.brokenFolders ?? []);
  }

  private meta(n: FakeNode) {
    return {
      id: n.id, name: n.name, mimeType: n.mimeType, modifiedTime: n.modifiedTime ?? "2026-10-01T00:00:00Z",
      ...(n.content ? { size: String(n.content.length), md5Checksum: createHash("md5").update(n.content).digest("hex") } : {}),
      ...(n.mimeType === SHORTCUT ? { shortcutDetails: { targetId: n.targetId, targetMimeType: n.targetMimeType } } : {}),
    };
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const hasKey = new Headers(init.headers).has("x-goog-api-key");
    const qParam = url.searchParams.get("q") ?? undefined;
    this.requests.push({ path: url.pathname + (url.searchParams.get("alt") ? "?alt=media" : ""), q: qParam, hasKey });
    if (init.signal?.aborted) throw init.signal.reason;
    if (!hasKey) return err(403, "forbidden", "The request is missing a valid API key.");
    const rel = url.pathname.replace(new URL(this.base).pathname, "");

    if (rel === "/files") {
      if (url.searchParams.get("supportsAllDrives") !== "true" || url.searchParams.get("includeItemsFromAllDrives") !== "true") {
        return err(400, "badRequest", "Fake: listings must set supportsAllDrives and includeItemsFromAllDrives");
      }
      const parent = qParam?.match(/^'([^']+)' in parents/)?.[1] ?? "";
      if (this.broken.has(parent)) return err(500, "backendError", "Internal error");
      if ((this.rateLimit[parent] ?? 0) > 0) {
        this.rateLimit[parent]!--;
        return err(403, "rateLimitExceeded", "Rate limit exceeded");
      }
      const p = this.nodes.get(parent);
      if (!p) return err(404, "notFound", `File not found: ${parent}.`);
      const wantFolders = qParam?.includes(`mimeType='${FOLDER}'`);
      const all = [...this.nodes.values()]
        .filter((n) => n.parent === parent)
        .filter((n) => (wantFolders ? n.mimeType === FOLDER : n.mimeType.startsWith("video/") || n.mimeType === SHORTCUT));
      const start = Number(url.searchParams.get("pageToken") ?? "0");
      const page = all.slice(start, start + this.pageSize).map((n) => this.meta(n));
      const next = start + this.pageSize < all.length ? String(start + this.pageSize) : undefined;
      return json({ files: page, ...(next ? { nextPageToken: next } : {}) });
    }

    const m = rel.match(/^\/files\/([^/]+)$/);
    if (m) {
      const n = this.nodes.get(decodeURIComponent(m[1]!));
      if (!n) return err(404, "notFound", "File not found.");
      if (url.searchParams.get("alt") === "media") {
        if (n.restricted || !n.content) return err(404, "notFound", "File not found.");
        return new Response(new Uint8Array(n.content), { status: 200, headers: { "content-type": n.mimeType } });
      }
      return json(this.meta(n));
    }
    return err(404, "notFound", `No fake route ${rel}`);
  };
}
