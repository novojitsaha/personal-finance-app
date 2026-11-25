// "AI summary" card on the dashboard: the month's digest, written by the AI
// after a statement is processed. If it is missing or outdated, the server
// writes a new one in the background and this card checks back.
import { Loader2, MessageCircleQuestion, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDigest } from "@/api";
import { href } from "@/router";
import { monthLabel } from "@/format";
import type { Digest } from "../../shared/api";

export function AiSummary({ month }: { month: string }) {
	const [digest, setDigest] = useState<Digest | null>(null);
	const [generating, setGenerating] = useState(false);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let cancelled = false;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout>;
		const load = () =>
			getDigest(month).then(
				(r) => {
					if (cancelled) return;
					setDigest(r.digest);
					setGenerating(r.generating);
					setLoaded(true);
					if (r.generating && tries++ < 12) timer = setTimeout(load, 5000);
				},
				() => !cancelled && setLoaded(true),
			);
		setLoaded(false);
		setDigest(null);
		load();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [month]);

	if (loaded && !digest && !generating) return null;
	return (
		<Card className="relative ring-primary/20">
			<span className="brand-gradient absolute inset-x-0 top-0 h-0.5" aria-hidden />
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<span className="brand-gradient flex size-7 items-center justify-center rounded-lg text-white shadow-sm shadow-primary/30">
						<Sparkles className="size-4" />
					</span>
					AI summary
				</CardTitle>
				<CardDescription>Written from this month's numbers; check details in the charts below</CardDescription>
				<CardAction className="flex items-center gap-2">
					{generating && (
						<Badge variant="outline">
							<Loader2 className="animate-spin" /> {digest ? "Updating" : "Writing"}
						</Badge>
					)}
					<Button variant="outline" size="sm" asChild>
						<a href={href("/chat")}>Ask a question</a>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				{!digest ? (
					<div className="space-y-2">
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-4 w-1/2" />
					</div>
				) : (
					<div className="animate-fade text-sm leading-relaxed [&_li]:my-1 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
						<Markdown>{digest.summary}</Markdown>
					</div>
				)}
				{digest && (
					<div className="mt-4 flex flex-wrap gap-2" aria-label="Follow-up questions">
						{followUps(month).map((q, i) => (
							<a
								key={q}
								href={href("/chat", { q })}
								style={{ "--i": i } as React.CSSProperties}
								className="animate-rise inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							>
								<MessageCircleQuestion className="size-3.5 text-primary" />
								{q}
							</a>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/** Questions the summary invites, asked in a new chat. */
function followUps(month: string): string[] {
	const m = monthLabel(month);
	return [`What drove my spending in ${m}?`, `Were there unusual charges in ${m}?`, `How does ${m} compare to the month before?`];
}
