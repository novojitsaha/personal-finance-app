import { CalendarClock, Cpu, FileText, LayoutDashboard, PiggyBank, ReceiptText, Wallet } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { href } from "@/router";

export const NAV = [
	{ path: "/", title: "Dashboard", icon: LayoutDashboard },
	{ path: "/transactions", title: "Transactions", icon: ReceiptText },
	{ path: "/subscriptions", title: "Subscriptions", icon: CalendarClock },
	{ path: "/budgets", title: "Budgets", icon: PiggyBank },
	{ path: "/statements", title: "Statements", icon: FileText },
	{ path: "/usage", title: "AI usage", icon: Cpu },
];

export function AppSidebar({ path }: { path: string }) {
	const { setOpenMobile } = useSidebar();
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<a href={href("/")}>
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
									<Wallet className="size-4" />
								</div>
								<span className="font-semibold">Personal Finance</span>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV.map((item) => (
								<SidebarMenuItem key={item.path}>
									<SidebarMenuButton
										asChild
										tooltip={item.title}
										isActive={item.path === "/" ? path === "/" : path.startsWith(item.path)}
									>
										<a href={href(item.path)} onClick={() => setOpenMobile(false)}>
											<item.icon />
											<span>{item.title}</span>
										</a>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}
