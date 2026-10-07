import { t, type MessageKey } from "@/i18n/t";
import type { TeamStatus } from "@/shared/status";
import { StateIcon, stateKind } from "./StateIcon";

export function StatusBadge({ status }: { status: TeamStatus }) {
  const kind = stateKind(status);
  return (
    <span className={`state state-${kind}`}>
      <StateIcon kind={kind} />
      <span>{t(`status.${status}` as MessageKey)}</span>
    </span>
  );
}
