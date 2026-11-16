// Screenshots of the main screens for the README / PRs, using headless Google
// Chrome with a throwaway profile. Run against SYNTHETIC data only:
//
//   npm run seed:local && npm run dev      # in another terminal
//   node scripts/screenshots.mjs           # writes docs/screenshots/*.png
//   node scripts/screenshots.mjs usage.png # only the named shots
//
// Never point this at a database with real statements.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const shots = [
	{ file: "dashboard.png", path: "/#/?period=2026-10", size: [1280, 2300] },
	{ file: "dashboard-dark.png", path: "/#/?period=2026-10", size: [1280, 2300], dark: true },
	{ file: "transactions.png", path: "/#/transactions?month=2026-10&merchant=albert%20heijn,jumbo", size: [1280, 1250] },
	{ file: "flagged.png", path: "/#/transactions?flagged=1", size: [1280, 1100] },
	{ file: "merchant.png", path: "/#/merchant/albert%20heijn?tab=variants", size: [1280, 1150] },
	{ file: "subscriptions.png", path: "/#/subscriptions", size: [1280, 1400] },
	{ file: "budgets.png", path: "/#/budgets?month=2026-10", size: [1280, 1650] },
	{ file: "statements.png", path: "/#/statements", size: [1280, 1250] },
	{ file: "dashboard-mobile.png", path: "/#/?period=2026-10", size: [390, 2600] },
	{ file: "usage.png", path: "/#/usage", size: [1280, 2200] },
	{ file: "memory.png", path: "/#/memory", size: [1280, 800] },
	{ file: "usage-dark.png", path: "/#/usage", size: [1280, 2200], dark: true },
];
// The chat needs an existing conversation: CHAT_ID=<id> node scripts/screenshots.mjs chat.png
if (process.env.CHAT_ID) shots.push({ file: "chat.png", path: `/#/chat?c=${process.env.CHAT_ID}`, size: [1280, 1100] });

// Optional file names as arguments take only those shots.
const only = process.argv.slice(2);
for (const s of shots.filter((x) => !only.length || only.includes(x.file))) {
	const profile = mkdtempSync(join(tmpdir(), "shot-"));
	execFileSync(
		CHROME,
		[
			"--headless=new",
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--hide-scrollbars",
			`--window-size=${s.size[0]},${s.size[1]}`,
			"--force-device-scale-factor=2",
			"--virtual-time-budget=15000",
			...(s.dark ? ["--force-dark-mode", "--blink-settings=preferredColorScheme=0"] : ["--blink-settings=preferredColorScheme=1"]),
			`--screenshot=${join(OUT, s.file)}`,
			BASE + s.path,
		],
		{ stdio: "ignore" },
	);
	rmSync(profile, { recursive: true, force: true });
	console.log(`docs/screenshots/${s.file}`);
}
