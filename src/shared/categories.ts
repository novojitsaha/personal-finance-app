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
