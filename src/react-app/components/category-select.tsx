// Change a transaction's category: pick a category, then choose whether it
// applies to just this transaction or to every transaction from the merchant
// (remembered for future uploads).
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryDot } from "@/components/category-badge";
import { setCategory } from "@/api";
import { CATEGORIES, type Category } from "../../shared/categories";

export function CategorySelect({
	transactionId,
	merchant,
	category,
	onChanged,
}: {
	transactionId: string;
	merchant: string;
	category: Category;
	onChanged: () => void;
}) {
	const [pending, setPending] = useState<Category | null>(null);
	const [busy, setBusy] = useState(false);

	const apply = async (scope: "one" | "merchant") => {
		if (!pending) return;
		setBusy(true);
		try {
			const { updated } = await setCategory(transactionId, pending, scope);
			toast.success(scope === "one" ? `Category set to ${pending}.` : `${updated} ${merchant} transactions set to ${pending}; future uploads too.`);
			setPending(null);
			onChanged();
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Select value={category} onValueChange={(v) => v !== category && setPending(v as Category)}>
				<SelectTrigger size="sm" className="h-7 w-[170px] text-xs" onClick={(e) => e.stopPropagation()}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{CATEGORIES.map((c) => (
						<SelectItem key={c} value={c}>
							<CategoryDot category={c} /> {c}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
				<DialogContent onClick={(e) => e.stopPropagation()}>
					<DialogHeader>
						<DialogTitle>Change category to {pending}?</DialogTitle>
						<DialogDescription>
							Apply it to just this transaction, or to every transaction from {merchant}. The merchant choice is also used for future
							uploads.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="gap-2 sm:gap-2">
						<Button variant="outline" disabled={busy} onClick={() => apply("one")}>
							Just this one
						</Button>
						<Button disabled={busy} onClick={() => apply("merchant")}>
							All from {merchant}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
