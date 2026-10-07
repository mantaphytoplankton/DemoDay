// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvidenceStrip, ObservationList, TimestampedText, type EvidenceObservation } from "../../src/components/features/scorecard/EvidenceStrip";
import { flagLabels } from "../../src/shared/flags";

afterEach(cleanup);

const obs: EvidenceObservation[] = [
  { at: "00:12", segment: "context", kind: "demonstrated", note: "Problem stated" },
  { at: "01:42", segment: "demo", kind: "demonstrated", note: "AI summary generated from uploaded PDF" },
  { at: "02:30", segment: "value", kind: "claimed", note: "Translates into 40 languages" },
];

describe("EvidenceStrip (JDG-05, ui-guideline 6.5)", () => {
  it("should_render_one_labelled_marker_per_observation_with_shape_by_kind", () => {
    render(<EvidenceStrip observations={obs} durationSeconds={170} maxSeconds={180} />);
    expect(screen.getByRole("group", { name: "Evidence timeline, 3 observations" })).toBeInTheDocument();
    const m = screen.getByRole("button", { name: "01:42, demonstrated, Demo: AI summary generated from uploaded PDF" });
    expect(m).toHaveClass("evidence-demonstrated");
    expect(screen.getByRole("button", { name: /02:30, claimed/ })).toHaveClass("evidence-claimed");
  });

  it("should_summarise_counts_per_segment_as_text", () => {
    render(<EvidenceStrip observations={obs} durationSeconds={170} maxSeconds={180} />);
    expect(screen.getByText("Demo: 1 demonstrated, 0 claimed")).toBeInTheDocument();
    expect(screen.getByText("Value: 0 demonstrated, 1 claimed")).toBeInTheDocument();
  });

  it("should_move_between_markers_with_arrow_keys_and_seek_on_enter", async () => {
    const onSeek = vi.fn();
    render(<EvidenceStrip observations={obs} durationSeconds={170} maxSeconds={180} onSeek={onSeek} />);
    const first = screen.getByRole("button", { name: /^00:12/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^01:42/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSeek).toHaveBeenCalledWith(102);
  });

  it("should_hatch_time_past_the_limit", () => {
    const { container } = render(<EvidenceStrip observations={obs} durationSeconds={204} maxSeconds={180} />);
    expect(container.querySelector(".evidence-over")).not.toBeNull();
  });
});

describe("ObservationList and TimestampedText (SNG-04)", () => {
  it("should_jump_the_video_when_a_timestamp_is_selected", async () => {
    const onSeek = vi.fn();
    render(<ObservationList observations={obs} onSeek={onSeek} />);
    await userEvent.click(screen.getByRole("button", { name: "Play from 01:42" }));
    expect(onSeek).toHaveBeenCalledWith(102);
  });

  it("should_show_plain_timestamps_without_a_seekable_video", () => {
    render(<ObservationList observations={obs} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("01:42")).toBeInTheDocument();
  });

  it("should_turn_timestamps_in_remarks_into_buttons", async () => {
    const onSeek = vi.fn();
    render(<p><TimestampedText text="The flow runs at 01:42 and again at 2:05." onSeek={onSeek} /></p>);
    await userEvent.click(screen.getByRole("button", { name: "Play from 2:05" }));
    expect(onSeek).toHaveBeenCalledWith(125);
  });
});

describe("flagLabels (JDG-06 wording)", () => {
  it("should_use_the_story_wording_for_every_flag", () => {
    expect(
      flagLabels({
        exceedsMaxDuration: true, durationSeconds: 204, maxDurationSeconds: 180,
        flags: { noWorkingDemo: true, audio: "missing", narratedNotShown: true, impactClaimedWithoutHow: true },
      }),
    ).toEqual(["Exceeds 3-minute maximum (3:24)", "No working demo walkthrough", "Audio missing", "Narrated, not shown", "Impact claimed without explanation"]);
    expect(flagLabels({ exceedsMaxDuration: false, durationSeconds: 100, flags: { noWorkingDemo: false, audio: "unintelligible", narratedNotShown: false, impactClaimedWithoutHow: false } })).toEqual(["Audio unintelligible"]);
    expect(flagLabels({ exceedsMaxDuration: false, durationSeconds: 100 })).toEqual([]);
  });
});
