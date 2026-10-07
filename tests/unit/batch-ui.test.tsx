// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BatchView } from "../../src/components/features/batch/BatchView";
import { StartBatchForm } from "../../src/components/features/batch/StartBatchForm";
import type { PublicBatch, PublicTeamRow } from "../../src/shared/schemas/batch";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/batches" }));

class FakeES {
  static current: FakeES | null = null;
  readyState = 1;
  listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {};
  onerror: null | (() => void) = null;
  url: string;
  constructor(url: string) { this.url = url; FakeES.current = this; }
  addEventListener(t: string, fn: (e: MessageEvent<string>) => void) { (this.listeners[t] ??= []).push(fn); }
  close() { this.readyState = 2; }
  emit(type: string, data: unknown) { act(() => this.listeners[type]?.forEach((fn) => fn({ data: JSON.stringify(data) } as MessageEvent<string>))); }
}

const at = "2026-10-06T10:00:00Z";
const columns = [
  { id: "working_solution", name: "Working Solution", short: "WS", weight: 25 },
  { id: "meaningful_ai", name: "Meaningful Use of AI", short: "AI", weight: 20 },
];
const summary = {
  categories: { working_solution: { score: 4, remarks: "WS remarks." }, meaningful_ai: { score: 3, remarks: "AI remarks." } },
  overallScore: 3.56, overallComments: "Overall comments.", durationSeconds: 204, exceedsMaxDuration: true, rubricVersion: "r", model: "m", completedAt: at,
};
const rowOf = (id: string, name: string, order: number, extra: Partial<PublicTeamRow> = {}): PublicTeamRow => ({ subfolderId: id, teamName: name, order, status: "Pending", warnings: [], attempts: 0, ...extra });
function batchOf(status: PublicBatch["status"] = "Running"): PublicBatch {
  return {
    schemaVersion: 1, id: "0123456789abcdef", rootFolderId: "fixtureHackathonRoot01", folderName: "Spring Hackathon", folderUrl: "u",
    status, createdAt: at, updatedAt: at, lastScanAt: at,
    teams: [
      rowOf("teamFolderAlpha001", "Team 1 Alpha", 0, { status: "Completed", summary, video: { fileId: "videoAlpha00000001", name: "demo.webm", mimeType: "video/webm", sizeBytes: 10 }, warnings: [{ code: "multipleVideos", count: 2, chosen: "demo.webm" }] }),
      rowOf("teamFolderBeta0001", "Team 2 Beta", 1, { status: "Failed", error: { code: "NO_VIDEO_IN_FOLDER", message: "No video found in folder", step: "Downloading", at } }),
      rowOf("teamFolderGamma001", "Team 3 Gamma", 2, { status: "Scoring", step: { name: "Scoring", startedAt: "2026-01-01T00:00:00Z", note: "AI service busy · attempt 2 of 4" } }),
    ],
  };
}
const teamDetail = {
  schemaVersion: 1, batchId: "0123456789abcdef", subfolderId: "teamFolderAlpha001", teamName: "Team 1 Alpha", completedAt: at,
  video: { fileId: "videoAlpha00000001", name: "demo.webm", mimeType: "video/webm", sizeBytes: 10 },
  result: {
    outputVersion: 1, categories: summary.categories, overallComments: "Overall comments.", overallScore: 3.56, weights: { working_solution: 25, meaningful_ai: 20 },
    durationSeconds: 204, exceedsMaxDuration: true,
    rubric: { maxDurationSeconds: 180, categories: columns.map((c) => ({ ...c, tiers: { "1": "a", "3": "b", "5": "c" } })) },
    provenance: { model: "m", promptVersion: "p", rubricVersion: "r", rubricSource: "default", temperature: 0.2, videoFps: 1, thinkingBudget: 1, usage: { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, stepDurationsMs: { upload: 0, processing: 0, scoring: 0 }, repairUsed: false, startedAt: at, finishedAt: at },
  },
};

function renderView(b = batchOf(), rubricVersion?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BatchView initial={b} columns={columns} rubricVersion={rubricVersion} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/teams/") ? teamDetail : batchOf("Completed")), { status: 200 })));
  FakeES.current = null;
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TeamTable via BatchView (TBL-01)", () => {
  it("should_show_scores_status_reasons_flags_and_counts", async () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Spring Hackathon");
    expect(screen.getByTestId("batch-counts")).toHaveTextContent("1 completed · 1 in progress · 1 failed · 0 pending");
    const alpha = screen.getByTestId("row-teamFolderAlpha001");
    expect(within(alpha).getByRole("img", { name: "Working Solution: 4 out of 5" })).toBeInTheDocument();
    expect(alpha).toHaveTextContent("3.56");
    expect(alpha).toHaveTextContent("Exceeds 3-minute maximum (3:24)");
    expect(alpha).toHaveTextContent("2 videos found; used the most recent (demo.webm)");
    expect(screen.getByTestId("row-teamFolderBeta0001")).toHaveTextContent("FailedNo video found in folder");
    const gamma = screen.getByTestId("row-teamFolderGamma001");
    expect(gamma).toHaveTextContent("AI service busy · attempt 2 of 4");
    // The slow-step hint needs the clock, which is only read after mount (no hydration mismatch).
    await waitFor(() => expect(gamma).toHaveTextContent("More time is needed"));
  });

  it("should_expand_remarks_for_a_completed_team", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Show remarks for Team 1 Alpha" }));
    expect(screen.getByText("WS remarks.")).toBeInTheDocument();
    expect(screen.getByText("Overall comments.")).toBeInTheDocument();
  });

  it("should_apply_live_row_updates_and_close_the_stream_when_done", async () => {
    renderView();
    const es = FakeES.current!;
    expect(es.url).toBe("/api/batches/0123456789abcdef/events");
    es.emit("row", { type: "row", batchId: "0123456789abcdef", row: rowOf("teamFolderGamma001", "Team 3 Gamma", 2, { status: "Completed", summary }) });
    await waitFor(() => expect(screen.getByTestId("row-teamFolderGamma001")).toHaveAttribute("data-status", "Completed"));
    es.emit("status", { type: "status", batchId: "0123456789abcdef", status: "Completed" });
    await waitFor(() => expect(es.readyState).toBe(2));
  });

  it("should_not_open_a_stream_for_a_finished_batch_and_show_interrupted_help", () => {
    renderView(batchOf("Interrupted"));
    expect(FakeES.current).toBeNull();
    expect(screen.getByText("This batch was interrupted")).toBeInTheDocument();
  });

  it("should_fall_back_to_polling_when_the_stream_fails", async () => {
    renderView();
    act(() => FakeES.current!.onerror?.());
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/batches/0123456789abcdef", expect.anything()));
  });
});

describe("ReviewPanel (TBL-02)", () => {
  it("should_open_a_scorecard_move_with_j_and_k_and_close_with_escape", async () => {
    renderView();
    const open = screen.getByRole("button", { name: "Open scorecard for Team 1 Alpha" });
    await userEvent.click(open);
    const panel = screen.getByRole("region", { name: "Team 1 Alpha scorecard" });
    expect(await within(panel).findByTestId("overall-score")).toHaveTextContent("3.56");
    expect(panel.querySelector("iframe")?.getAttribute("src")).toBe("https://drive.google.com/file/d/videoAlpha00000001/preview");

    fireEvent.keyDown(document, { key: "j" });
    expect(screen.getByRole("region", { name: "Team 2 Beta scorecard" })).toHaveTextContent("No video found in folder");
    fireEvent.keyDown(document, { key: "j" });
    expect(screen.getByRole("region", { name: "Team 3 Gamma scorecard" })).toHaveTextContent("This team has no scorecard yet.");
    fireEvent.keyDown(document, { key: "k" });
    expect(screen.getByRole("region", { name: "Team 2 Beta scorecard" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: /scorecard/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open scorecard for Team 2 Beta" })).toHaveFocus());
  });

  it("should_disable_previous_on_the_first_team", async () => {
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }));
    expect(screen.getByRole("button", { name: "Previous team" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next team" }));
    expect(screen.getByRole("region", { name: "Team 2 Beta scorecard" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: /scorecard/ })).toBeNull();
  });
});

describe("StartBatchForm (BAT-01)", () => {
  it("should_validate_the_link_in_the_browser", async () => {
    render(<StartBatchForm />);
    await userEvent.type(screen.getByLabelText("Google Drive folder link"), "https://example.com/x");
    await userEvent.click(screen.getByRole("button", { name: "Start batch" }));
    expect(await screen.findByText("Enter a Google Drive folder link")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should_open_the_batch_on_success_and_show_server_errors", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "No team folders found in this folder" } }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ batchId: "0123456789abcdef", reopened: false }), { status: 202 }));
    vi.stubGlobal("fetch", f);
    render(<StartBatchForm />);
    await userEvent.type(screen.getByLabelText("Google Drive folder link"), "https://drive.google.com/drive/folders/fixtureEmptyRoot01");
    await userEvent.click(screen.getByRole("button", { name: "Start batch" }));
    expect(await screen.findByText("No team folders found in this folder")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start batch" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/batches/0123456789abcdef"));
  });
});

describe("S-3 batch controls (RSM-02, RSM-03, RSM-04, TBL-04)", () => {
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("should_offer_pause_while_running_and_export_always", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume batch" })).toBeNull();
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/batches/0123456789abcdef/export.csv");
  });

  it("should_pause_and_report_that_it_stops_after_the_current_team", async () => {
    const f = vi.fn(async () => respond(202, { batchId: "0123456789abcdef" }));
    vi.stubGlobal("fetch", f);
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(f).toHaveBeenCalledWith("/api/batches/0123456789abcdef/pause", { method: "POST" });
    expect(await screen.findByText("Pausing after the current team…")).toBeInTheDocument();
  });

  it("should_resume_a_paused_batch_and_reconnect_live_updates", async () => {
    const f = vi.fn(async () => respond(202, { batchId: "0123456789abcdef" }));
    vi.stubGlobal("fetch", f);
    const paused = batchOf("Paused");
    paused.teams[2] = { ...paused.teams[2]!, status: "Pending", step: undefined };
    renderView(paused);
    expect(screen.getByText("This batch is paused")).toBeInTheDocument();
    expect(FakeES.current).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Resume batch" }));
    await waitFor(() => expect(FakeES.current?.url).toBe("/api/batches/0123456789abcdef/events"));
  });

  it("should_show_rescan_results_and_errors", async () => {
    const f = vi.fn().mockResolvedValueOnce(respond(202, { added: 2 })).mockResolvedValueOnce(respond(503, { error: { message: "Google Drive unavailable, retry later" } }));
    vi.stubGlobal("fetch", f);
    renderView(batchOf("Completed"));
    await userEvent.click(screen.getByRole("button", { name: "Rescan folder" }));
    expect(await screen.findByText("Folder rescanned: 2 new team folders")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rescan folder" }));
    expect(await screen.findByText("That did not work: Google Drive unavailable, retry later")).toBeInTheDocument();
  });

  it("should_retry_a_failed_team_and_mark_it_pending", async () => {
    const f = vi.fn(async () => respond(202, {}));
    vi.stubGlobal("fetch", f);
    renderView(batchOf("Completed"));
    await userEvent.click(screen.getByRole("button", { name: "Retry for Team 2 Beta" }));
    expect(f).toHaveBeenCalledWith("/api/batches/0123456789abcdef/teams/teamFolderBeta0001/retry", expect.objectContaining({ method: "POST", body: JSON.stringify({ rejudge: false }) }));
    await waitFor(() => expect(screen.getByTestId("row-teamFolderBeta0001")).toHaveAttribute("data-status", "Pending"));
  });

  it("should_mark_results_from_an_older_rubric_and_offer_rejudge", async () => {
    const f = vi.fn(async () => respond(202, {}));
    vi.stubGlobal("fetch", f);
    renderView(batchOf("Completed"), "newrubric");
    const alpha = screen.getByTestId("row-teamFolderAlpha001");
    expect(alpha).toHaveTextContent("Judged with a previous rubric");
    await userEvent.click(screen.getByRole("button", { name: "Re-judge for Team 1 Alpha" }));
    expect(f).toHaveBeenCalledWith("/api/batches/0123456789abcdef/teams/teamFolderAlpha001/retry", expect.objectContaining({ body: JSON.stringify({ rejudge: true }) }));
  });

  it("should_not_mark_results_from_the_current_rubric", () => {
    renderView(batchOf("Completed"), "r");
    expect(screen.getByTestId("row-teamFolderAlpha001")).not.toHaveTextContent("Judged with a previous rubric");
    expect(screen.queryByRole("button", { name: "Re-judge for Team 1 Alpha" })).toBeNull();
  });
});
