import { Brain, CalendarClock, Cpu, FileText, MessageSquare, LayoutDashboard, PiggyBank, ReceiptText, Wallet } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import { href } from "@/router";

export const NAV = [
	{ path: "/", title: "Dashboard", icon: LayoutDashboard },
	{ path: "/chat", title: "Chat", icon: MessageSquare },
	{ path: "/memory", title: "Memory", icon: Brain },
	{ path: "/transactions", title: "Transactions", icon: ReceiptText },
	{ path: "/subscriptions", title: "Subscriptions", icon: CalendarClock },
	{ path: "/budgets", title: "Budgets", icon: PiggyBank },
	{ path: "/statements", title: "Statements", icon: FileText },
	{ path: "/usage", title: "AI usage", icon: Cpu },
];

// Sidebar sections by path; a page without an entry lands in the first section.
const SECTIONS = ["Insights", "Money", "Data"] as const;
const SECTION_OF: Record<string, (typeof SECTIONS)[number]> = {
	"/transactions": "Money",
	"/subscriptions": "Money",
	"/budgets": "Money",
	"/statements": "Data",
	"/usage": "Data",
};

export function AppSidebar({ path }: { path: string }) {
	const { setOpenMobile } = useSidebar();
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild className="group/brand hover:bg-transparent active:bg-transparent">
							<a href={href("/")} onClick={() => setOpenMobile(false)}>
								<div className="brand-gradient flex aspect-square size-8 items-center justify-center rounded-[10px] text-white shadow-md shadow-primary/30 transition-transform duration-500 ease-[var(--ease-spring)] group-hover/brand:scale-110 group-hover/brand:-rotate-6">
									<Wallet className="size-4" />
								</div>
								<div className="grid leading-tight">
									<span className="font-semibold tracking-tight">Personal Finance</span>
									<span className="text-xs text-muted-foreground">Your money, explained</span>
								</div>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				{SECTIONS.map((section) => (
					<SidebarGroup key={section}>
						<SidebarGroupLabel>{section}</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarMenu>
								{NAV.filter((n) => (SECTION_OF[n.path] ?? SECTIONS[0]) === section).map((item) => (
									<SidebarMenuItem key={item.path}>
										<SidebarMenuButton
											asChild
											tooltip={item.title}
											isActive={item.path === "/" ? path === "/" : path.startsWith(item.path)}
											className="nav-item relative transition-colors duration-200 data-active:text-primary dark:data-active:text-sidebar-accent-foreground"
										>
											<a href={href(item.path)} onClick={() => setOpenMobile(false)}>
												<item.icon className="transition-transform duration-300 ease-[var(--ease-spring)] group-hover/menu-button:scale-110" />
												<span>{item.title}</span>
											</a>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				))}
			</SidebarContent>
			<SidebarRail />
		</Sidebar>
	);
}
