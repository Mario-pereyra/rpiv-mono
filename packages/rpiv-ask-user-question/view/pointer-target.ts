/** Render-time hit targets. State transitions remain owned by the session/reducer. */
export type PointerTarget =
	| { kind: "option"; index: number }
	| { kind: "submit"; index: 0 | 1 }
	| { kind: "tab"; index: number }
	| { kind: "notes" }
	| { kind: "discussion" };

/** One cell interval per rendered line; absent rows are chrome, gaps, or preview content. */
export interface PointerRow {
	start: number;
	end: number;
	target: PointerTarget;
	/** Independent intervals sharing a rendered line (tab strip, footer, preview affordance). */
	additional?: readonly PointerRow[];
}

export interface ScrollMetrics {
	offset: number;
	maxOffset: number;
	pageSize: number;
	target: { kind: "body" } | { kind: "preview"; index: number };
}

export interface PreviewScrollRegion extends ScrollMetrics {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export function optionPointerRows(items: readonly (number | undefined)[], width: number): (PointerRow | undefined)[] {
	return items.map((index) =>
		index === undefined ? undefined : { start: 0, end: width, target: { kind: "option", index } },
	);
}

export function pointerTargetAt(
	rows: readonly (PointerRow | undefined)[],
	x: number,
	y: number,
): PointerTarget | undefined {
	const row = rows[y];
	return row ? [row, ...(row.additional ?? [])].find((cell) => x >= cell.start && x < cell.end)?.target : undefined;
}
