import { categoryVar } from "@/theme";
import { cn } from "@/lib/utils";

export function CategoryDot({ category, className }: { category: string; className?: string }) {
	return <span className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)} style={{ background: categoryVar(category) }} aria-hidden />;
}

export function CategoryBadge({ category, user }: { category: string; user?: boolean }) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap">
			<CategoryDot category={category} />
			{category}
			{user && <span className="text-muted-foreground" title="Set by you">•</span>}
		</span>
	);
}
