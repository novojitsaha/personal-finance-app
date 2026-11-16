// Command palette (Ctrl/Cmd+K): jump to any page or merchant, start a chat,
// or switch theme without reaching for the mouse.
import { AlertTriangle, FileUp, MessageSquarePlus, Monitor, Moon, Search, Store, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { NAV } from "@/components/app-sidebar";
import { useTheme } from "@/components/theme-provider";
import { listMerchants } from "@/api";
import { merchantHref, navigate } from "@/router";
import type { MerchantSummary } from "../../shared/api";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function CommandMenu() {
	const [open, setOpen] = useState(false);
	const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
	const { setTheme } = useTheme();

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((o) => !o);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	// Merchants are fetched when the palette opens, so they are always current.
	useEffect(() => {
		if (open) listMerchants().then(setMerchants, () => setMerchants([]));
	}, [open]);

	const run = (fn: () => void) => () => {
		setOpen(false);
		fn();
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="group flex h-9 items-center gap-2 rounded-full border bg-background/60 px-3 text-sm text-muted-foreground shadow-xs transition-all hover:border-ring/50 hover:bg-background hover:text-foreground sm:w-56 lg:w-72"
				aria-label="Search and jump to"
			>
				<Search className="size-4 transition-transform group-hover:scale-110" />
				<span className="hidden sm:inline">Search or jump to…</span>
				<kbd className="ml-auto hidden rounded-md border bg-muted px-1.5 font-sans text-[11px] font-medium sm:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
			</button>
			<CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page or a merchant, or run an action.">
				<Command>
					<CommandInput placeholder="Search pages, merchants, actions…" />
					<CommandList>
						<CommandEmpty>Nothing found.</CommandEmpty>
						<CommandGroup heading="Go to">
							{NAV.map((n) => (
								<CommandItem key={n.path} value={`go ${n.title}`} onSelect={run(() => navigate(n.path))}>
									<n.icon /> {n.title}
								</CommandItem>
							))}
						</CommandGroup>
						<CommandSeparator />
						<CommandGroup heading="Actions">
							<CommandItem value="new chat ask question" onSelect={run(() => navigate("/chat", { c: crypto.randomUUID() }))}>
								<MessageSquarePlus /> Ask a new question
							</CommandItem>
							<CommandItem value="upload statement pdf" onSelect={run(() => navigate("/statements"))}>
								<FileUp /> Upload a statement
							</CommandItem>
							<CommandItem value="flagged unusual charges" onSelect={run(() => navigate("/transactions", { flagged: "1" }))}>
								<AlertTriangle /> Review flagged charges
							</CommandItem>
						</CommandGroup>
						{merchants.length > 0 && (
							<>
								<CommandSeparator />
								<CommandGroup heading="Merchants">
									{merchants.map((m) => (
										<CommandItem key={m.merchant_key} value={`merchant ${m.merchant}`} onSelect={run(() => (location.hash = merchantHref(m.merchant_key).slice(1)))}>
											<Store /> {m.merchant}
											<span className="ml-auto text-xs text-muted-foreground tabular-nums">{m.count} {m.count === 1 ? "payment" : "payments"}</span>
										</CommandItem>
									))}
								</CommandGroup>
							</>
						)}
						<CommandSeparator />
						<CommandGroup heading="Theme">
							<CommandItem value="theme light" onSelect={run(() => setTheme("light"))}>
								<Sun /> Light
							</CommandItem>
							<CommandItem value="theme dark" onSelect={run(() => setTheme("dark"))}>
								<Moon /> Dark
							</CommandItem>
							<CommandItem value="theme system" onSelect={run(() => setTheme("system"))}>
								<Monitor /> System
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</CommandDialog>
		</>
	);
}
