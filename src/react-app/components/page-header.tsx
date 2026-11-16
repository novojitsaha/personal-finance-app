import { cn } from "@/lib/utils";

/** Title block at the top of every page, with optional actions on the right. */
export function PageHeader({ title, description, children, className }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex flex-wrap items-end gap-x-4 gap-y-3 animate-rise", className)}>
			<div className="mr-auto min-w-0">
				<h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h1>
				{description && <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">{description}</p>}
			</div>
			{children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
		</div>
	);
}
