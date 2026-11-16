// What the chat remembers: short notes saved automatically from conversations
// (goals, facts, preferences, notes). New chats start with them. Notes can be
// added, edited and deleted here.
import { Brain, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { addMemory, deleteMemory, listMemories, updateMemory } from "@/api";
import { formatDate } from "@/format";
import type { Memory as Note } from "../../shared/api";

const KINDS: { kind: Note["kind"]; title: string; description: string }[] = [
	{ kind: "goal", title: "Goals", description: "Targets and plans you mentioned" },
	{ kind: "preference", title: "Preferences", description: "How you like answers" },
	{ kind: "fact", title: "Facts", description: "Things you explained that the statements don't show" },
	{ kind: "note", title: "Notes", description: "Conclusions worth remembering" },
];

export function Memory() {
	const [notes, setNotes] = useState<Note[] | null>(null);
	const [editing, setEditing] = useState<{ id: number | null; kind: Note["kind"]; text: string } | null>(null);
	const refresh = useCallback(() => {
		listMemories().then(setNotes, (e: Error) => toast.error(e.message));
	}, []);
	useEffect(refresh, [refresh]);

	const save = async () => {
		if (!editing) return;
		try {
			if (editing.id === null) await addMemory(editing.kind, editing.text);
			else await updateMemory(editing.id, editing.kind, editing.text);
			setEditing(null);
			refresh();
		} catch (e) {
			toast.error((e as Error).message);
		}
	};
	const remove = async (n: Note) => {
		try {
			await deleteMemory(n.id);
			refresh();
			toast.success("Note deleted");
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<div className="stagger space-y-4 md:space-y-5">
			<PageHeader
				title="Memory"
				description="The chat saves short notes from your conversations a few minutes after they go quiet, so new chats don't start from zero. Every new chat reads them. Edit or delete anything that's wrong."
				className="animate-none"
			>
				<Button onClick={() => setEditing({ id: null, kind: "goal", text: "" })}>
					<Plus /> Add note
				</Button>
			</PageHeader>

			{notes === null ? (
				<Skeleton className="h-60" />
			) : notes.length === 0 ? (
				<EmptyState icon={Brain} title="Nothing remembered yet" description="Chat about your goals or explain a payment, and notes will appear here." />
			) : (
				<div className="stagger grid gap-4 md:gap-5 lg:grid-cols-2">
					{KINDS.map(({ kind, title, description }) => {
						const list = notes.filter((n) => n.kind === kind);
						if (!list.length) return null;
						return (
							<Card key={kind}>
								<CardHeader>
									<CardTitle>{title}</CardTitle>
									<CardDescription>{description}</CardDescription>
								</CardHeader>
								<CardContent>
									<ul className="divide-y divide-border/60">
										{list.map((n) => (
											<li key={n.id} className="flex items-start gap-2 py-2">
												<div className="min-w-0 flex-1">
													<p className="text-sm">{n.text}</p>
													<p className="mt-0.5 text-xs text-muted-foreground">
														{n.source === "user" ? "Added or edited by you" : "Saved from"}{" "}
														{n.source === "ai" && n.conversation_id ? (
															<a className="underline-offset-4 hover:underline" href={`#/chat?c=${n.conversation_id}`}>
																{n.conversation_title ?? "a deleted chat"}
															</a>
														) : null}{" "}
														· {formatDate(n.updated_at.slice(0, 10))}
													</p>
												</div>
												<Button variant="ghost" size="icon" className="size-8" aria-label="Edit note" onClick={() => setEditing({ id: n.id, kind: n.kind, text: n.text })}>
													<Pencil />
												</Button>
												<Button variant="ghost" size="icon" className="size-8" aria-label="Delete note" onClick={() => remove(n)}>
													<Trash2 />
												</Button>
											</li>
										))}
									</ul>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing?.id === null ? "Add note" : "Edit note"}</DialogTitle>
					</DialogHeader>
					{editing && (
						<form
							className="space-y-3"
							onSubmit={(e) => {
								e.preventDefault();
								save();
							}}
						>
							<Select value={editing.kind} onValueChange={(v) => setEditing({ ...editing, kind: v as Note["kind"] })}>
								<SelectTrigger aria-label="Kind" className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{KINDS.map((k) => (
										<SelectItem key={k.kind} value={k.kind}>
											<Badge variant="outline">{k.title.replace(/s$/, "")}</Badge>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Textarea
								value={editing.text}
								onChange={(e) => setEditing({ ...editing, text: e.target.value })}
								maxLength={300}
								rows={3}
								placeholder="e.g. Wants to keep eating out under €200 a month"
								aria-label="Note"
								autoFocus
							/>
							<DialogFooter>
								<Button type="submit" disabled={!editing.text.trim()}>
									Save
								</Button>
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
