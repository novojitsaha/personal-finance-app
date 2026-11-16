// Small motion helpers shared by the pages. All of them stand still when the
// visitor asks for reduced motion.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
	const q = window.matchMedia(QUERY);
	q.addEventListener("change", cb);
	return () => q.removeEventListener("change", cb);
};

// eslint-disable-next-line react-refresh/only-export-components
export function useReducedMotion(): boolean {
	return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}

/** Props for Recharts series so charts draw themselves in once, smoothly. */
// eslint-disable-next-line react-refresh/only-export-components
export function useChartMotion(delay = 0) {
	const reduced = useReducedMotion();
	return { isAnimationActive: !reduced, animationBegin: delay, animationDuration: 900, animationEasing: "ease-out" as const };
}

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));

/** A number that counts up to its value, and glides when the value changes. */
export function AnimatedNumber({ value, format, duration = 900, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
	const reduced = useReducedMotion();
	const [shown, setShown] = useState(0);
	const from = useRef(0);

	useEffect(() => {
		if (reduced) {
			from.current = value;
			return;
		}
		const start = from.current;
		const t0 = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - t0) / duration);
			const v = start + (value - start) * easeOutExpo(t);
			from.current = v;
			setShown(t === 1 ? value : v);
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [value, duration, reduced]);

	return (
		<span className={className} aria-label={format(value)}>
			<span aria-hidden>{format(reduced ? value : shown)}</span>
		</span>
	);
}
