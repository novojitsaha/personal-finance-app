// Minimal hash router: "#/transactions?merchant=albert%20heijn&month=2026-10".
// Filters live in the URL, so every view can be bookmarked and shared.
import { useEffect, useState } from "react";

export interface Route {
	path: string;
	params: URLSearchParams;
}

function parse(): Route {
	const hash = location.hash.replace(/^#/, "") || "/";
	const [path, query = ""] = hash.split("?");
	return { path: path || "/", params: new URLSearchParams(query) };
}

export function useRoute(): Route {
	const [route, setRoute] = useState(parse);
	useEffect(() => {
		const onChange = () => setRoute(parse());
		window.addEventListener("hashchange", onChange);
		// A child's effect may have changed the URL before this listener existed.
		onChange();
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return route;
}

export function href(path: string, params?: Record<string, string | null | undefined>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
	const s = q.toString();
	return `#${path}${s ? `?${s}` : ""}`;
}

export function navigate(path: string, params?: Record<string, string | null | undefined>, replace = false) {
	const next = href(path, params);
	if (replace) history.replaceState(null, "", next);
	else location.hash = next.slice(1);
	if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export const merchantHref = (key: string) => href(`/merchant/${encodeURIComponent(key)}`);
