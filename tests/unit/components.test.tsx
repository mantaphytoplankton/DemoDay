// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scorecard } from "../../src/components/features/scorecard/Scorecard";
import { PitchClock } from "../../src/components/features/evaluate/PitchClock";
import { StepTracker } from "../../src/components/features/evaluate/StepTracker";
import { StatusBadge } from "../../src/components/ui/StatusBadge";
import { ScoreChip, scoreClass } from "../../src/components/ui/ScoreChip";
import { useUiStore } from "../../src/hooks/useUiStore";
import type { PublicEvaluation } from "../../src/shared/schemas/evaluation";

afterEach(cleanup);

const tiers = (a: string, b: string, c: string) => ({ "1": a, "3": b, "5": c });
function evaluation(over: Partial<{ ws: number; ai: number; ux: number; duration: number; exceeds: boolean; source: "default" | "active" }> = {}): PublicEvaluation {
  const now = "2026-10-05T10:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60",
    source: { kind: "upload", fileName: "team-alpha.webm", mimeType: "video/webm", sizeBytes: 29814 },
    status: "Completed",
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    result: {
      outputVersion: 1,
      categories: {
        working_solution: { score: over.ws ?? 4, remarks: "WS remarks: the flow runs at 00:31." },
        meaningful_ai: { score: over.ai ?? 3, remarks: "AI remarks." },
        ux_value: { score: over.ux ?? 5, remarks: "UX remarks." },
      },
      overallComments: "Overall comments text.",
      overallScore: 3.92,
      weights: { working_solution: 25, meaningful_ai: 20, ux_value: 15 },
      durationSeconds: over.duration ?? 120.4,
      exceedsMaxDuration: over.exceeds ?? false,
      rubric: {
        maxDurationSeconds: 180,
        categories: [
          { id: "working_solution", name: "Working Solution", short: "WS", weight: 25, tiers: tiers("Mostly concept", "Core flow works", "Convincing across realistic cases") },
          { id: "meaningful_ai", name: "Meaningful Use of AI", short: "AI", weight: 20, tiers: tiers("Superficial use of AI", "AI enables a key step", "Strong task/AI fit with safeguards") },
          { id: "ux_value", name: "User Experience & Value", short: "UX", weight: 15, tiers: tiers("Hard to follow", "Usable and plausible", "Clear, practical and valuable") },
        ],
      },
      provenance: {
        model: "gemini-3.8-flash", promptVersion: "1ecd7bff", rubricVersion: "a7ba7139", rubricSource: over.source ?? "default",
        temperature: 0.2, videoFps: 1, thinkingBudget: 4096,
        usage: { promptTokens: 1, outputTokens: 1, thoughtsTokens: 1, totalTokens: 3 },
        stepDurationsMs: { upload: 1, processing: 1, scoring: 1 }, repairUsed: false, startedAt: now, finishedAt: now,
      },
    },
  };
}

describe("Scorecard (SNG-03)", () => {
  it("should_show_each_category_score_weight_and_the_weighted_overall", () => {
    render(<Scorecard title="team-alpha.webm" sizeBytes={29814} result={evaluation().result!} />);
    expect(screen.getByRole("img", { name: "Working Solution: 4 out of 5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Meaningful Use of AI: 3 out of 5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "User Experience & Value: 5 out of 5" })).toBeInTheDocument();
    expect(screen.getByTestId("overall-score")).toHaveTextContent("3.92");
    expect(screen.getByText("Weighted · WS 25% · AI 20% · UX 15%")).toBeInTheDocument();
    expect(screen.getByText("Overall comments text.")).toBeInTheDocument();
    expect(screen.getByText(/Default rubric/)).toBeInTheDocument();
  });

  it("should_describe_in_between_scores_with_both_tiers", () => {
    render(<Scorecard title="t" result={evaluation({ ws: 2, ai: 1 }).result!} />);
    expect(screen.getByText('Tier: between "Mostly concept" and "Core flow works"')).toBeInTheDocument();
    expect(screen.getByText("Tier: Superficial use of AI")).toBeInTheDocument();
  });

  it("should_expand_one_category_then_all_remarks", async () => {
    const user = userEvent.setup();
    render(<Scorecard title="team-alpha.webm" sizeBytes={29814} result={evaluation().result!} />);
    const toggle = screen.getByRole("button", { name: "Show remarks for Working Solution" });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show all remarks" }));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Hide all remarks" }));
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("should_toggle_all_remarks_when_the_E_shortcut_signal_fires", () => {
    render(<Scorecard title="team-alpha.webm" sizeBytes={29814} result={evaluation().result!} />);
    act(() => useUiStore.getState().requestToggleAll());
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(3);
  });

  it("should_show_the_over_duration_flag_as_text", () => {
    render(<Scorecard title="t" result={evaluation({ duration: 204, exceeds: true, source: "active" }).result!} />);
    expect(within(screen.getByLabelText("Data-quality flags")).getByText("Exceeds 3-minute maximum (3:24)")).toBeInTheDocument();
    expect(screen.getByText(/Event rubric/)).toBeInTheDocument();
  });
});

describe("PitchClock", () => {
  it("should_show_the_limit_before_a_video_is_chosen", () => {
    render(<PitchClock maxSeconds={180} durationSeconds={null} />);
    expect(screen.getByTestId("pitch-clock")).toHaveAttribute("data-state", "limit");
    expect(screen.getByText("Longer videos are flagged")).toBeInTheDocument();
  });
  it.each([
    [180.4, "ok", "Within the 3:00 limit"],
    [204, "over", "Over the 3:00 limit, will be flagged"],
  ])("should_show_%ss_as_%s", (d, state, note) => {
    render(<PitchClock maxSeconds={180} durationSeconds={d} />);
    expect(screen.getByTestId("pitch-clock")).toHaveAttribute("data-state", state);
    expect(screen.getByText(note)).toBeInTheDocument();
  });
});

describe("StepTracker, StatusBadge, ScoreChip", () => {
  it("should_mark_only_the_active_step_as_current", () => {
    render(<StepTracker states={["done", "active", "todo", "todo"]} meta={["29 KB sent", "12s"]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveTextContent("Processing Video12s");
  });
  it("should_render_status_as_text_not_colour_only", () => {
    render(<StatusBadge status="Failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
  it.each([
    [1, "s1"], [2.49, "s2"], [3.5, "s4"], [3.92, "s4"], [5, "s5"],
  ])("should_colour_%s_as_%s", (x, cls) => {
    expect(scoreClass(x)).toBe(cls);
  });
  it("should_fill_pips_up_to_the_score", () => {
    const { container } = render(<ScoreChip score={3} label="X" />);
    expect(container.querySelectorAll(".pips i.on")).toHaveLength(3);
  });
});
