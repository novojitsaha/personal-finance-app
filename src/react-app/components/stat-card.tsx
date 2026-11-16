import type { LucideIcon } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { cn } from "@/lib/utils";

const TONES = {
	brand: "bg-primary/10 text-primary",
	positive: "bg-[color-mix(in_oklch,var(--positive)_14%,transparent)] text-positive",
	negative: "bg-[color-mix(in_oklch,var(--negative)_14%,transparent)] text-negative",
	warning: "bg-[color-mix(in_oklch,var(--warning)_16%,transparent)] text-warning",
	neutral: "bg-muted text-muted-foreground",
};

/** Sparkline: a tiny trend line drawn in, with a soft fill underneath. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
	if (values.length < 2) return null;
	const w = 120;
	const h = 36;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
	// Smooth the line with horizontal control points between neighbours.
	const line = pts.reduce((d, [x, y], i) => {
		if (i === 0) return `M${x},${y}`;
		const [px, py] = pts[i - 1];
		const mx = (px + x) / 2;
		return `${d} C${mx},${py} ${mx},${y} ${x},${y}`;
	}, "");
	const [lx, ly] = pts[pts.length - 1];
	return (
		<svg viewBox={`0 0 ${w} ${h}`} className={cn("h-9 w-[7.5rem] overflow-visible", className)} aria-hidden>
			<path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" fillOpacity={0.12} className="animate-fade [--i:6]" />
			<path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" pathLength={1} strokeDasharray={1} className="sparkline-draw" />
			<circle cx={lx} cy={ly} r={2.5} fill="currentColor" className="animate-pop [--i:12]" style={{ transformOrigin: `${lx}px ${ly}px` }} />
		</svg>
	);
}

export function StatCard({
	label,
	value,
	format,
	icon: Icon,
	tone = "brand",
	badge,
	note,
	spark,
	index = 0,
	className,
}: {
	label: string;
	value: number;
	format: (n: number) => string;
	icon?: LucideIcon;
	tone?: keyof typeof TONES;
	/** Shown top right, e.g. a trend badge. */
	badge?: React.ReactNode;
	note?: React.ReactNode;
	/** Values for a sparkline, oldest first. */
	spark?: number[];
	/** Position in a row, for the staggered entrance. */
	index?: number;
	className?: string;
}) {
	return (
		<div
			data-slot="card"
			className={cn("card-lift animate-rise group/stat relative flex flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10", className)}
			style={{ "--i": index } as React.CSSProperties}
		>
			<div className="flex items-center gap-2.5">
				{Icon && (
					<span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover/stat:scale-110", TONES[tone])}>
						<Icon className="size-4" />
					</span>
				)}
				<span className="text-sm font-medium text-muted-foreground">{label}</span>
				<span className="ml-auto">{badge}</span>
			</div>
			<div className="flex items-end justify-between gap-3">
				<AnimatedNumber value={value} format={format} className="text-2xl font-semibold tracking-tight tabular-nums md:text-[1.7rem]" />
				{spark && <Sparkline values={spark} className={cn("shrink-0", TONES[tone].split(" ").pop())} />}
			</div>
			{note && <p className="text-xs text-pretty text-muted-foreground">{note}</p>}
		</div>
	);
}
