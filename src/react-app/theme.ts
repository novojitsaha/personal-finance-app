// Category colours for shadcn charts (ChartConfig) and badges.
//
// Spending categories are folded into six groups (GROUPS in
// src/shared/categories.ts). Each group has one hue from a colour-blind-checked
// categorical palette; categories within a group are lighter/darker steps of
// that hue. So every category has its own fixed colour everywhere, related
// categories look related, and charts that need few series (the trend) use
// the group colours. Light and dark mode have separately tuned steps.
import type { ChartConfig } from "@/components/ui/chart";
import { CATEGORIES, GROUPS, type GroupName } from "../shared/categories";

/** Group base colours: [light, dark]. */
const GROUP_BASE: Record<GroupName, [string, string]> = {
	"Home & bills": ["#2a78d6", "#3987e5"],
	"Food & drink": ["#eb6834", "#d95926"],
	"Transport & travel": ["#1baf7a", "#199e70"],
	Shopping: ["#eda100", "#c98500"],
	"Health & leisure": ["#e87ba4", "#d55181"],
	"Other spending": ["#008300", "#2f9e2f"],
};
const HUE: Record<GroupName, number> = {
	"Home & bills": 255,
	"Food & drink": 42,
	"Transport & travel": 165,
	Shopping: 78,
	"Health & leisure": 355,
	"Other spending": 142,
};
// Lightness steps per position within a group (first = the group colour).
const STEPS_LIGHT = [0.58, 0.72, 0.45, 0.82];
const STEPS_DARK = [0.66, 0.8, 0.52, 0.88];

function categoryColors(): Record<string, { light: string; dark: string }> {
	const out: Record<string, { light: string; dark: string }> = {};
	for (const g of GROUPS) {
		g.categories.forEach((c, i) => {
			out[c] =
				i === 0
					? { light: GROUP_BASE[g.name][0], dark: GROUP_BASE[g.name][1] }
					: { light: `oklch(${STEPS_LIGHT[i]} 0.15 ${HUE[g.name]})`, dark: `oklch(${STEPS_DARK[i]} 0.14 ${HUE[g.name]})` };
		});
	}
	out.Income = { light: "#6250d6", dark: "#9085e9" };
	out.Transfers = { light: "#8a8984", dark: "#8f8f97" };
	return out;
}

export const CATEGORY_COLORS = categoryColors();

/** Stable CSS-safe key for a category ("Bars & Nightlife" -> "bars-nightlife"). */
export const categoryKey = (c: string) =>
	c
		.toLowerCase()
		.replace(/[^a-z]+/g, "-")
		.replace(/^-|-$/g, "");
export const groupKey = (g: string) => `group-${categoryKey(g)}`;

/** One ChartConfig entry per category, keyed by categoryKey(). */
export const categoryChartConfig = Object.fromEntries(
	CATEGORIES.map((c) => [categoryKey(c), { label: c, theme: CATEGORY_COLORS[c] }]),
) satisfies ChartConfig;

/** One ChartConfig entry per spending group, keyed by groupKey(). */
export const groupChartConfig = Object.fromEntries(
	GROUPS.map((g) => [groupKey(g.name), { label: g.name, theme: { light: GROUP_BASE[g.name][0], dark: GROUP_BASE[g.name][1] } }]),
) satisfies ChartConfig;

export const OTHER_SLICE = { label: "Other categories", theme: { light: "#b5b4ae", dark: "#5c5c62" } };

/** Spending up vs down (status colours, always paired with a sign and label). */
export const CHANGE_COLORS = {
	up: { light: "#d03b3b", dark: "#e66767" },
	down: { light: "#0ca30c", dark: "#2fb52f" },
};

/** CSS colour for a category in the current theme (for dots outside charts). */
export const categoryVar = (c: string) => `var(--cat-${categoryKey(c)})`;

/** CSS custom properties for every category, set once on the app root. */
export function categoryCssVars(dark: boolean): Record<string, string> {
	return Object.fromEntries(Object.entries(CATEGORY_COLORS).map(([c, v]) => [`--cat-${categoryKey(c)}`, dark ? v.dark : v.light]));
}
