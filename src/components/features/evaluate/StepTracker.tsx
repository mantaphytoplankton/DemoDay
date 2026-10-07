import { t, type MessageKey } from "@/i18n/t";
import { SINGLE_STEPS } from "@/shared/status";
import { StateIcon } from "@/components/ui/StateIcon";

export type StepState = "todo" | "active" | "done" | "failed";

export function StepTracker({ states, meta }: { states: StepState[]; meta: (string | undefined)[] }) {
  return (
    <ol className="steps" aria-label={t("evaluate.steps")}>
      {SINGLE_STEPS.map((name, i) => {
        const s = states[i] ?? "todo";
        const icon = s === "done" ? "done" : s === "failed" ? "failed" : s === "active" ? "active" : "pending";
        return (
          <li className="step" data-s={s} key={name} aria-current={s === "active" ? "step" : undefined}>
            <span className="state">
              <StateIcon kind={icon} />
              <span>{t(`status.${name}` as MessageKey)}</span>
            </span>
            {meta[i] && <div className="step-meta">{meta[i]}</div>}
          </li>
        );
      })}
    </ol>
  );
}
