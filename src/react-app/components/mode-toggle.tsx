import { Monitor, Moon, Sun } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";

export function ModeToggle() {
	const { theme, setTheme } = useTheme();
	const button = useRef<HTMLButtonElement>(null);
	const pick = (next: "light" | "dark" | "system") => {
		const r = button.current?.getBoundingClientRect();
		setTheme(next, r && { x: r.left + r.width / 2, y: r.top + r.height / 2 });
	};
	const items = [
		{ value: "light", label: "Light", icon: Sun },
		{ value: "dark", label: "Dark", icon: Moon },
		{ value: "system", label: "System", icon: Monitor },
	] as const;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button ref={button} variant="ghost" size="icon" className="relative rounded-full">
					<Sun className="size-[1.15rem] scale-100 rotate-0 transition-all duration-500 ease-[var(--ease-spring)] dark:scale-0 dark:-rotate-90" />
					<Moon className="absolute size-[1.15rem] scale-0 rotate-90 transition-all duration-500 ease-[var(--ease-spring)] dark:scale-100 dark:rotate-0" />
					<span className="sr-only">Toggle theme</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{items.map((i) => (
					<DropdownMenuItem key={i.value} onClick={() => pick(i.value)} className={theme === i.value ? "font-medium text-primary" : undefined}>
						<i.icon /> {i.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
