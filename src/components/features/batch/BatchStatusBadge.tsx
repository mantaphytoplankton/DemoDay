import { t } from "@/i18n/t";
import type { BatchStatus } from "@/shared/schemas/batch";
import { StateIcon, type StateKind } from "@/components/ui/StateIcon";

const KIND: Record<BatchStatus, StateKind> = { Running: "active", Paused: "hold", Completed: "done", Interrupted: "hold" };

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const kind = KIND[status];
  return (
    <span className={`state state-${kind}`}>
      <StateIcon kind={kind} />
      <span>{t(`status.${status}`)}</span>
    </span>
  );
}
