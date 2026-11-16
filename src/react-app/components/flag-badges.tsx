import { AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { dismissFlag } from "@/api";
import type { Flag } from "../../shared/api";

export const FLAG_LABELS: Record<Flag["code"], string> = {
	large_vs_usual: "Unusually large",
	first_time_large: "Large first payment",
	possible_duplicate: "Possible duplicate",
	price_up: "Price went up",
	bank_fee: "Bank fee",
};

export function FlagBadges({ transactionId, flags, onChanged }: { transactionId: string; flags: Flag[]; onChanged?: () => void }) {
	return (
		<div className="flex flex-wrap gap-1">
			{flags.map((f) => (
				<Tooltip key={f.code}>
					<TooltipTrigger asChild>
						<Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
							<AlertTriangle className="size-3" />
							{FLAG_LABELS[f.code]}
							{onChanged && (
								<button
									type="button"
									aria-label="Dismiss flag"
									onClick={async (e) => {
										e.stopPropagation();
										await dismissFlag(transactionId, f.code);
										toast("Flag dismissed.");
										onChanged();
									}}
								>
									<X className="size-3" />
								</button>
							)}
						</Badge>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs">{f.reason}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}
