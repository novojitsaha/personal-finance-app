// From https://ui.shadcn.com/docs/dark-mode/vite: adds "light"/"dark" to <html>.
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderState = {
	theme: Theme;
	/** The theme actually shown ("system" resolved). */
	resolved: "dark" | "light";
	setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

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

	useEffect(() => {
		const root = window.document.documentElement;
		root.classList.remove("light", "dark");
		root.classList.add(resolved);
	}, [resolved]);

	const setTheme = (next: Theme) => {
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// Storage unavailable (private mode): the choice lasts for this visit.
		}
		setThemeState(next);
	};

	return <ThemeProviderContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeProviderContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
	const context = useContext(ThemeProviderContext);
	if (!context) throw new Error("useTheme must be used within a ThemeProvider");
	return context;
}
