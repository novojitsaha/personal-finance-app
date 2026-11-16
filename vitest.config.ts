import { defineConfig } from "vitest/config";

// Unit tests for pure modules only, so the Cloudflare Vite plugin isn't loaded.
export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
});
