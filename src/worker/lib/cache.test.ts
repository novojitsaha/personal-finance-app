import { describe, expect, it } from "vitest";
import { cacheKey } from "./cache";

describe("tool cache key", () => {
	it("ignores argument order and empty values", () => {
		expect(cacheKey("search_transactions", { month: "2026-10", merchant: "AH" })).toBe(cacheKey("search_transactions", { merchant: "AH", month: "2026-10", text: undefined, category: null }));
	});
	it("differs per tool and per argument", () => {
		expect(cacheKey("get_overview", { month: "2026-10" })).not.toBe(cacheKey("get_overview", { month: "2026-09" }));
		expect(cacheKey("get_overview", {})).not.toBe(cacheKey("spending_by_category", {}));
	});
});
