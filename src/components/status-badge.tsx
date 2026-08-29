import { Badge } from "@/components/ui/badge";
import type { HealStatus } from "@/modules/platform";

/**
 * The whole point of this mapping: `no_candidate` and `skipped` are NOT failures. They are
 * the healer correctly declining to guess, and colouring them red would train a reviewer to
 * ignore the ones that matter.
 */
const HEAL_TONE: Record<HealStatus, { variant: "default" | "secondary" | "destructive" | "outline"; label?: string }> = {
  pr_open: { variant: "default", label: "PR open" },
  verified: { variant: "default" },
  healing: { variant: "secondary" },
  received: { variant: "secondary" },
  diagnosed: { variant: "secondary" },
  no_candidate: { variant: "outline", label: "no candidate" },
  skipped: { variant: "outline" },
  rejected: { variant: "outline" },
  failed: { variant: "destructive" },
};

export function HealStatusBadge({ status }: { status: string }) {
  const tone = HEAL_TONE[status as HealStatus] ?? { variant: "outline" as const };
  return <Badge variant={tone.variant}>{tone.label ?? status.replace(/_/g, " ")}</Badge>;
}

/** A rejected or malformed delivery is data we want, so it is shown, not hidden. */
export function DeliveryStatusBadge({
  httpStatus,
  authOk,
  xpathRelated,
}: {
  httpStatus: number;
  authOk: boolean;
  xpathRelated: boolean;
}) {
  const variant = !authOk || httpStatus >= 400 ? "destructive" : xpathRelated ? "default" : "secondary";
  return <Badge variant={variant}>{httpStatus}</Badge>;
}
