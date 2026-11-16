// The fixed category list the model must choose from. Shared by the Worker
// (prompt + JSON schema + validation) and the React app.
export const CATEGORIES = [
	"Groceries",
	"Restaurants",
	"Bars & Nightlife",
	"Coffee & Snacks",
	"Clothing & Fashion",
	"Shopping",
	"Transport",
	"Travel",
	"Rent & Housing",
	"Utilities",
	"Subscriptions",
	"Health & Fitness",
	"Entertainment",
	"Education",
	"Gifts & Donations",
	"Fees & Charges",
	"Transfers",
	"Income",
	"Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Not spending: excluded from spending totals (Transfers are shown separately). */
export const NON_SPENDING: readonly Category[] = ["Income", "Transfers"];

export const isSpendingCategory = (c: string) => !NON_SPENDING.includes(c as Category);

/**
 * Spending categories are folded into six groups for charts: a categorical
 * palette stays distinguishable (also for colour-blind readers) only up to
 * about eight colours, and there are 17 spending categories. Each category
 * always takes its group's colour, so a category looks the same everywhere.
 */
export const GROUPS = [
	{ name: "Home & bills", categories: ["Rent & Housing", "Utilities", "Subscriptions"] },
	{ name: "Food & drink", categories: ["Groceries", "Restaurants", "Bars & Nightlife", "Coffee & Snacks"] },
	{ name: "Transport & travel", categories: ["Transport", "Travel"] },
	{ name: "Shopping", categories: ["Shopping", "Clothing & Fashion"] },
	{ name: "Health & leisure", categories: ["Health & Fitness", "Entertainment", "Education"] },
	{ name: "Other spending", categories: ["Gifts & Donations", "Fees & Charges", "Other"] },
] as const satisfies readonly { name: string; categories: readonly Category[] }[];

export type GroupName = (typeof GROUPS)[number]["name"];

export function groupOf(category: string): GroupName {
	return (GROUPS.find((g) => (g.categories as readonly string[]).includes(category)) ?? GROUPS[GROUPS.length - 1]).name;
}
