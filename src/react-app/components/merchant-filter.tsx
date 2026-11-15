// Type-ahead multi-select over merchant names (shadcn Combobox pattern).
import { Check, ChevronsUpDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listMerchants } from "@/api";
import { cn } from "@/lib/utils";
import type { MerchantSummary } from "../../shared/api";

export function MerchantFilter({
	value,
	onChange,
	multiple = true,
	placeholder = "Merchant",
	exclude,
}: {
	value: string[];
	onChange: (keys: string[]) => void;
	multiple?: boolean;
	placeholder?: string;
	exclude?: string;
}) {
	const [open, setOpen] = useState(false);
	const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
	useEffect(() => {
		listMerchants().then(setMerchants, () => setMerchants([]));
	}, []);
	const name = (key: string) => merchants.find((m) => m.merchant_key === key)?.merchant ?? key;
	const toggle = (key: string) => {
		if (!multiple) {
			onChange([key]);
			setOpen(false);
		} else onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="outline" size="sm" role="combobox" aria-expanded={open} className="justify-between">
						{!multiple && value[0] ? name(value[0]) : value.length && multiple ? `${placeholder} (${value.length})` : placeholder}
						<ChevronsUpDown className="opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-[260px] p-0" align="start">
					<Command>
						<CommandInput placeholder="Search merchants…" />
						<CommandList>
							<CommandEmpty>No merchant found.</CommandEmpty>
							<CommandGroup>
								{merchants
									.filter((m) => m.merchant_key !== exclude)
									.map((m) => (
										<CommandItem key={m.merchant_key} value={`${m.merchant} ${m.merchant_key}`} onSelect={() => toggle(m.merchant_key)}>
											<Check className={cn("size-4", value.includes(m.merchant_key) ? "opacity-100" : "opacity-0")} />
											<span className="truncate">{m.merchant}</span>
											<span className="ml-auto text-xs text-muted-foreground">{m.count}</span>
										</CommandItem>
									))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{multiple &&
				value.map((key) => (
					<Badge key={key} variant="secondary" className="gap-1">
						{name(key)}
						<button type="button" aria-label={`Remove ${name(key)}`} onClick={() => onChange(value.filter((k) => k !== key))}>
							<X className="size-3" />
						</button>
					</Badge>
				))}
		</div>
	);
}
