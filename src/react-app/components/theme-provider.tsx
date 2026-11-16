// From https://ui.shadcn.com/docs/dark-mode/vite: adds "light"/"dark" to <html>.
import { createContext, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";

type Theme = "dark" | "light" | "system";

type ThemeProviderState = {
	theme: Theme;
	/** The theme actually shown ("system" resolved). */
	resolved: "dark" | "light";
	/** `origin` (viewport px) is where the reveal animation starts, usually the toggle. */
	setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

function applyClass(resolved: "dark" | "light") {
	const root = window.document.documentElement;
	root.classList.remove("light", "dark");
	root.classList.add(resolved);
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({
	children,
	defaultTheme = "system",
	storageKey = "vite-ui-theme",
}: {
	children: React.ReactNode;
	defaultTheme?: Theme;
	storageKey?: string;
}) {
	const [theme, setThemeState] = useState<Theme>(() => {
		try {
			return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
		} catch {
			return defaultTheme;
		}
	});
	const [system, setSystem] = useState<"dark" | "light">(() => (systemDark() ? "dark" : "light"));
	const resolved = theme === "system" ? system : theme;

	useEffect(() => {
		const q = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => setSystem(q.matches ? "dark" : "light");
		q.addEventListener("change", onChange);
		return () => q.removeEventListener("change", onChange);
	}, []);

	useEffect(() => applyClass(resolved), [resolved]);

	const setTheme = (next: Theme, origin?: { x: number; y: number }) => {
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// Storage unavailable (private mode): the choice lasts for this visit.
		}
		const nextResolved = next === "system" ? system : next;
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		// Where supported, the new theme is revealed in a circle growing from the toggle.
		if (nextResolved === resolved || reduced || !document.startViewTransition) return setThemeState(next);
		const root = document.documentElement;
		root.style.setProperty("--vt-x", `${origin?.x ?? window.innerWidth}px`);
		root.style.setProperty("--vt-y", `${origin?.y ?? 0}px`);
		document.startViewTransition(() => {
			flushSync(() => setThemeState(next));
			applyClass(nextResolved);
		});
	};

	return <ThemeProviderContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeProviderContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
	const context = useContext(ThemeProviderContext);
	if (!context) throw new Error("useTheme must be used within a ThemeProvider");
	return context;
}
