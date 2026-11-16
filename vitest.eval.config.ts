import { defineConfig } from "vitest/config";

// Evaluations that call real Workers AI on the local synthetic data
// (npm run seed:local). Not part of `npm test`.
export default defineConfig({
	test: {
		include: ["src/**/*.eval.ts"],
		testTimeout: 180_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
