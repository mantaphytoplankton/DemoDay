// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scorecard } from "../../src/components/features/scorecard/Scorecard";
import { ConfirmDelete } from "../../src/components/ui/ConfirmDelete";
import type { JudgeResult } from "../../src/shared/schemas/judge-result";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(cleanup);

const at = "2026-10-07T10:00:00.000Z";
const tiers = { "1": "a", "3": "b", "5": "c" };
const result: JudgeResult = {
  outputVersion: 2,
  categories: { working_solution: { score: 4, remarks: "Shown at 01:42." }, meaningful_ai: { score: 3, remarks: "AI ok." }, ux_value: { score: 5, remarks: "Clear." } },
  overallComments: "Overall.", overallScore: 3.92, weights: { working_solution: 25, meaningful_ai: 20, ux_value: 15 },
  durationSeconds: 170, exceedsMaxDuration: false,
  observations: [{ at: "01:42", segment: "demo", kind: "demonstrated", note: "AI summary generated from uploaded PDF" }],
  flags: { noWorkingDemo: false, audio: "unintelligible", narratedNotShown: false, impactClaimedWithoutHow: false },
  rubric: { maxDurationSeconds: 180, categories: [
    { id: "working_solution", name: "Working Solution", short: "WS", weight: 25, tiers },
    { id: "meaningful_ai", name: "Meaningful Use of AI", short: "AI", weight: 20, tiers },
    { id: "ux_value", name: "User Experience & Value", short: "UX", weight: 15, tiers },
  ] },
  provenance: { model: "m", provider: "vertex", promptVersion: "p", rubricVersion: "r", rubricSource: "default", temperature: 0.2, videoFps: 1, thinkingBudget: 1, usage: { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, stepDurationsMs: { upload: 0, processing: 0, scoring: 0 }, repairUsed: false, startedAt: at, finishedAt: at },
};

describe("Scorecard evidence and flags (JDG-05, JDG-06, SNG-04)", () => {
  it("should_show_evidence_flags_provider_and_seek_from_remarks", async () => {
    const onSeek = vi.fn();
    render(<Scorecard title="t" result={result} onSeek={onSeek} />);
    expect(screen.getByText("Audio unintelligible")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Evidence timeline, 1 observations" })).toBeInTheDocument();
    expect(screen.getByText(/via Vertex AI/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show all remarks" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Play from 01:42" })[0]!);
    expect(onSeek).toHaveBeenCalledWith(102);
  });

  it("should_explain_when_a_result_has_no_evidence", () => {
    const { observations: _o, flags: _f, ...v1 } = result;
    render(<Scorecard title="t" result={{ ...v1, outputVersion: 1 }} />);
    expect(screen.getByText("No evidence details for this result (judged before this feature).")).toBeInTheDocument();
  });
});

describe("Scorecard overrides (TBL-03)", () => {
  it("should_show_final_and_struck_ai_scores_with_the_note", () => {
    render(
      <Scorecard
        title="t"
        result={result}
        overrides={{ working_solution: { score: 2, note: "Demo used hardcoded output", at } }}
        final={{ categories: { working_solution: 2, meaningful_ai: 3, ux_value: 5 }, overallScore: 3.08, overridden: true }}
        onOverride={async () => null}
      />,
    );
    expect(screen.getByTestId("overall-score")).toHaveTextContent("3.08");
    expect(screen.getByText("AI 3.92")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Working Solution: final 2 out of 5, AI 4" })).toBeInTheDocument();
    expect(screen.getByText("Judge's note: Demo used hardcoded output")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove override for Working Solution" })).toBeInTheDocument();
  });

  it("should_validate_then_save_an_override", async () => {
    const onOverride = vi.fn(async () => null);
    render(<Scorecard title="t" result={result} onOverride={onOverride} />);
    await userEvent.click(screen.getByRole("button", { name: "Override score for Working Solution" }));
    const dialog = screen.getByRole("dialog", { name: "Override Working Solution" });
    const score = screen.getByLabelText("Your score (1 to 5)");
    await userEvent.clear(score);
    await userEvent.type(score, "6");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    expect(await screen.findByText("Score must be a whole number from 1 to 5")).toBeInTheDocument();
    await userEvent.clear(score);
    await userEvent.type(score, "2");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    expect(await screen.findByText("Add a note explaining the override")).toBeInTheDocument();
    expect(onOverride).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Note explaining the override (required)"), "Demo used hardcoded output");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    await waitFor(() => expect(onOverride).toHaveBeenCalledWith("working_solution", { score: 2, note: "Demo used hardcoded output" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Override saved");
  });

  it("should_keep_the_dialog_open_and_show_server_errors", async () => {
    render(<Scorecard title="t" result={result} onOverride={async () => "There is no AI score to override yet"} />);
    await userEvent.click(screen.getByRole("button", { name: "Override score for Working Solution" }));
    await userEvent.type(screen.getByLabelText("Note explaining the override (required)"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save override" }));
    expect(await screen.findByText("The override was not saved: There is no AI score to override yet")).toBeInTheDocument();
  });

  it("should_remove_an_override", async () => {
    const onOverride = vi.fn(async () => null);
    render(<Scorecard title="t" result={result} overrides={{ working_solution: { score: 2, note: "n", at } }} onOverride={onOverride} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove override for Working Solution" }));
    expect(onOverride).toHaveBeenCalledWith("working_solution", { remove: true });
    expect(await screen.findByText("Override removed")).toBeInTheDocument();
  });
});

describe("ConfirmDelete (RSM-07)", () => {
  it("should_name_what_is_removed_and_delete_only_after_confirming", async () => {
    const onConfirm = vi.fn(async () => null);
    render(<ConfirmDelete label="Delete batch" title='Delete "Spring Hackathon"?' body="This removes the batch and its 20 team results from DemoDay. Files in Google Drive are not changed. This cannot be undone." onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete batch" }));
    const dialog = screen.getByRole("dialog", { name: 'Delete "Spring Hackathon"?' });
    expect(dialog).toHaveTextContent("20 team results");
    expect(dialog).toHaveTextContent("This cannot be undone.");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog).not.toHaveAttribute("open");
    await userEvent.click(screen.getByRole("button", { name: "Delete batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("should_show_why_deletion_was_refused", async () => {
    render(<ConfirmDelete label="Delete batch" title="T" body="B" onConfirm={async () => "Pause or wait until it finishes, then delete"} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Not deleted: Pause or wait until it finishes, then delete")).toBeInTheDocument();
  });
});
