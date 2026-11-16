import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, children, className }: { icon: LucideIcon; title: string; description?: React.ReactNode; children?: React.ReactNode; className?: string }) {
	return (
		<div className={cn("animate-rise flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center", className)}>
			<span className="brand-gradient animate-float flex size-12 items-center justify-center rounded-2xl text-white shadow-lg shadow-primary/25">
				<Icon className="size-6" />
			</span>
			<div>
				<p className="text-lg font-semibold tracking-tight">{title}</p>
				{description && <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>}
			</div>
			{children}
		</div>
	);
}
