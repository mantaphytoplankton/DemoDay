// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EvaluateClient } from "../../src/components/features/evaluate/EvaluateClient";
import { EvaluateView } from "../../src/components/features/evaluate/EvaluateView";
import { ShortcutsDialog } from "../../src/components/shell/ShortcutsDialog";
import { NavLinks } from "../../src/components/shell/NavLinks";
import { useUiStore } from "../../src/hooks/useUiStore";

vi.mock("next/navigation", () => ({ usePathname: () => "/evaluate" }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));

const webm = readFileSync(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
const ID = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60";

// ---- browser boundary fakes ----
class FakeXHR {
  static next: { status: number; body: unknown } = { status: 202, body: { evaluationId: ID } };
  static last: FakeXHR | null = null;
  headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  upload = { onprogress: null as null | ((e: { loaded: number }) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  open() {}
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(file: File) {
    FakeXHR.last = this;
    setTimeout(() => {
      this.upload.onprogress?.({ loaded: file.size });
      this.status = FakeXHR.next.status;
      this.responseText = JSON.stringify(FakeXHR.next.body);
      this.onload?.();
    }, 0);
  }
}
class FakeES {
  static CLOSED = 2;
  static current: FakeES | null = null;
  readyState = 1;
  listeners: Record<string, ((e: MessageEvent<string>) => void)[]> = {};
  onerror: null | (() => void) = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeES.current = this;
  }
  addEventListener(t: string, fn: (e: MessageEvent<string>) => void) { (this.listeners[t] ??= []).push(fn); }
  close() { this.readyState = 2; }
  push(type: string, data: unknown) { act(() => this.listeners[type]?.forEach((fn) => fn({ data: JSON.stringify(data) } as MessageEvent<string>))); }
}

const base = { schemaVersion: 1, id: ID, source: { kind: "upload", fileName: "team.webm", mimeType: "video/webm", sizeBytes: webm.length }, attempts: 1, createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z" };
const at = "2026-10-05T10:00:00Z";
const tiers = { "1": "a", "3": "b", "5": "c" };
const completed = {
  ...base, status: "Completed", step: { name: "Completed", startedAt: at },
  result: {
    outputVersion: 1, overallComments: "Overall.", overallScore: 3.92, weights: { ws: 25 }, durationSeconds: 120.4, exceedsMaxDuration: false,
    categories: { ws: { score: 4, remarks: "Remarks." } },
    rubric: { maxDurationSeconds: 180, categories: [{ id: "ws", name: "Working Solution", short: "WS", weight: 25, tiers }] },
    provenance: { model: "m", promptVersion: "p", rubricVersion: "r", rubricSource: "default", temperature: 0.2, videoFps: 1, thinkingBudget: 1, usage: { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, stepDurationsMs: { upload: 0, processing: 0, scoring: 0 }, repairUsed: false, startedAt: at, finishedAt: at },
  },
};

let serverState: unknown = null;

function renderClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDuration = vi.fn();
  render(<QueryClientProvider client={qc}><EvaluateClient maxBytes={10_000_000} maxLabel="10 MB" onDuration={onDuration} /></QueryClientProvider>);
  return { onDuration };
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.stubGlobal("EventSource", FakeES);
  serverState = { ...base, status: "Pending", step: { name: "Pending", startedAt: at } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/api/evaluations?") ? { items: [] } : serverState), { status: 200 })));
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  // jsdom cannot decode video: make the length probe take its "unknown length" path immediately.
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    configurable: true,
    set(this: HTMLMediaElement) { setTimeout(() => this.onerror?.(new Event("error")), 0); },
    get() { return ""; },
  });
  FakeXHR.next = { status: 202, body: { evaluationId: ID } };
  FakeES.current = null;
  FakeXHR.last = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function choose(name = "team.webm", bytes: Uint8Array = webm, type = "video/webm") {
  const input = screen.getByTestId("video-input");
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(bytes)], name, { type })] } });
  await waitFor(() => expect(FakeES.current?.url ?? "").toContain(ID), { timeout: 7000 });
}

describe("EvaluateClient (SNG-01, SNG-02, SNG-03)", () => {
  it("should_show_the_validation_message_and_mark_the_input_invalid", async () => {
    renderClient();
    fireEvent.change(screen.getByTestId("video-input"), { target: { files: [new File(["x"], "slides.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Unsupported file type. Use MP4, MOV or WebM.")).toBeInTheDocument();
    expect(screen.getByTestId("video-input")).toHaveAttribute("aria-invalid", "true");
  });

  it("should_upload_with_headers_then_follow_steps_to_the_scorecard", async () => {
    const { onDuration } = renderClient();
    await choose();
    expect(FakeXHR.last?.headers).toMatchObject({ "Content-Type": "video/webm", "X-File-Name": "team.webm" });

    FakeES.current!.push("snapshot", { ...base, status: "Processing Video", step: { name: "Processing Video", startedAt: at } });
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Processing Video"));
    FakeES.current!.push("update", { ...base, status: "Scoring", step: { name: "Scoring", startedAt: at, note: "AI service busy · attempt 2 of 4" } });
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("AI service busy · attempt 2 of 4"));
    FakeES.current!.push("update", completed);

    expect(await screen.findByTestId("overall-score")).toHaveTextContent("3.92");
    expect(FakeES.current!.readyState).toBe(2);
    expect(onDuration).toHaveBeenLastCalledWith(120.4);
    expect(screen.getByText("Evaluation completed. Overall AI score 3.92 out of 5.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open result page" })).toHaveAttribute("href", `/results/${ID}`);

    await userEvent.click(screen.getByRole("button", { name: "Evaluate another video" }));
    expect(screen.getByTestId("video-input")).toBeInTheDocument();
    expect(onDuration).toHaveBeenLastCalledWith(null);
  });

  it("should_show_the_failure_reason_help_and_rubric_link", async () => {
    renderClient();
    await choose();
    FakeES.current!.push("update", { ...base, status: "Failed", error: { code: "RUBRIC_INVALID", message: "Rubric configuration invalid", step: "Uploading", at } });
    expect(await screen.findByText("Rubric configuration invalid", { selector: ".banner-title" })).toHaveFocus();
    expect(screen.getByText("Fix rubric.md and evaluate again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View rubric" })).toHaveAttribute("href", "/rubric");
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Stopped");
  });

  it("should_retry_a_failed_evaluation_without_a_new_upload", async () => {
    renderClient();
    await choose();
    FakeES.current!.push("update", { ...base, status: "Failed", error: { code: "AI_UNAVAILABLE", message: "AI service unavailable, retry later", step: "Scoring", at } });
    await screen.findByText("AI service unavailable, retry later", { selector: ".banner-title" });
    const first = FakeES.current;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ evaluationId: ID }), { status: 202 }));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(fetch).toHaveBeenCalledWith(`/api/evaluations/${ID}/retry`, { method: "POST" });
    await waitFor(() => expect(FakeES.current).not.toBe(first));
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Uploading"));
    expect(FakeXHR.last).not.toBeNull();
  });

  it("should_show_the_soft_tip_after_10_seconds_on_one_step", async () => {
    renderClient();
    await choose();
    vi.useFakeTimers({ toFake: ["Date"] }); // only the clock; the component's real 500ms tick reads it
    FakeES.current!.push("update", { ...base, status: "Processing Video", step: { name: "Processing Video", startedAt: at } });
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Processing Video"));
    await new Promise((r) => setTimeout(r, 600)); // let the tick record when the step started
    expect(screen.queryByTestId("soft-tip")).toBeNull();
    vi.setSystemTime(Date.now() + 11_000);
    expect(await screen.findByTestId("soft-tip")).toHaveTextContent("More time is needed. Still processing video…");
  });

  it("should_return_to_the_dropzone_with_the_server_message_when_upload_is_refused", async () => {
    FakeXHR.next = { status: 413, body: { error: { code: "FILE_TOO_LARGE", message: "File is larger than 1 GB" } } };
    renderClient();
    fireEvent.change(screen.getByTestId("video-input"), { target: { files: [new File([new Uint8Array(webm)], "team.webm", { type: "video/webm" })] } });
    expect(await screen.findByText("File is larger than 1 GB", {}, { timeout: 7000 })).toBeInTheDocument();
  });

  it("should_fall_back_to_polling_when_events_disconnect", async () => {
    renderClient();
    await choose();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serverState = completed;
    act(() => FakeES.current!.onerror?.());
    await act(async () => { vi.advanceTimersByTime(3500); });
    expect(await screen.findByTestId("overall-score")).toHaveTextContent("3.92");
  });
});

describe("EvaluateView", () => {
  it("should_render_banner_stickers_from_rubric_and_empty_recent_list", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <EvaluateView categories={[{ id: "ws", name: "Working Solution", weight: 25 }]} maxSeconds={180} maxBytes={1} maxLabel="1 GB" recent={[]} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("list", { name: "Rubric categories and weights" })).toHaveTextContent("Working Solution 25%");
    expect(screen.getByText("No evaluations yet. Upload a team video to get its first scorecard.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /hackathon stage/ })).toBeInTheDocument();
    expect(screen.getByText(/CC0 1.0/)).toBeInTheDocument();
  });
});

describe("Shell", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  });

  it("should_open_shortcuts_on_question_mark_and_respect_the_off_switch", async () => {
    render(<><ShortcutsDialog /><button data-remarks-toggle>t</button><input aria-label="field" /></>);
    const before = useUiStore.getState().toggleAllSignal;
    fireEvent.keyDown(document, { key: "e" });
    expect(useUiStore.getState().toggleAllSignal).toBe(before + 1);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), { key: "e" });
    expect(useUiStore.getState().toggleAllSignal).toBe(before + 1);

    fireEvent.keyDown(document, { key: "?" });
    expect(document.querySelector("dialog")).toHaveAttribute("open");
    await userEvent.click(screen.getByRole("checkbox", { name: "Turn off single-key shortcuts", hidden: true }));
    expect(useUiStore.getState().shortcutsOff).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
    fireEvent.keyDown(document, { key: "e" });
    expect(useUiStore.getState().toggleAllSignal).toBe(before + 1);
    useUiStore.getState().setShortcutsOff(false);
  });

  it("should_mark_the_current_page_and_link_to_batches", () => {
    render(<NavLinks />);
    expect(screen.getByRole("link", { name: "Evaluate" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Batches" })).toHaveAttribute("href", "/batches");
  });
});
