import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar, NAV } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Budgets } from "@/pages/Budgets";
import { Dashboard } from "@/pages/Dashboard";
import { Merchant } from "@/pages/Merchant";
import { Statements } from "@/pages/Statements";
import { Subscriptions } from "@/pages/Subscriptions";
import { Transactions } from "@/pages/Transactions";
import { Usage } from "@/pages/Usage";
import { Chat } from "@/pages/Chat";
import { useRoute } from "@/router";
import { categoryCssVars } from "@/theme";

function Page() {
	const { path, params } = useRoute();
	if (path.startsWith("/merchant/")) return <Merchant merchantKey={decodeURIComponent(path.slice("/merchant/".length))} tab={params.get("tab")} />;
	switch (path) {
		case "/transactions":
			return <Transactions params={params} />;
		case "/subscriptions":
			return <Subscriptions />;
		case "/budgets":
			return <Budgets params={params} />;
		case "/statements":
			return <Statements />;
		case "/chat":
			return <Chat params={params} />;
		case "/usage":
			return <Usage />;
		default:
			return <Dashboard params={params} />;
	}
}

function Shell() {
	const { path } = useRoute();
	const { resolved } = useTheme();
	const title = path.startsWith("/merchant/") ? "Merchant" : (NAV.find((n) => n.path === path)?.title ?? "Dashboard");
	return (
		<SidebarProvider style={categoryCssVars(resolved === "dark") as React.CSSProperties}>
			<AppSidebar path={path} />
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
					<span className="font-medium">{title}</span>
					<div className="ml-auto">
						<ModeToggle />
					</div>
				</header>
				<main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
					<Page />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}

function App() {
	return (
		<ThemeProvider>
			<TooltipProvider>
				<Shell />
				<Toaster richColors />
			</TooltipProvider>
		</ThemeProvider>
	);
}

export default App;
