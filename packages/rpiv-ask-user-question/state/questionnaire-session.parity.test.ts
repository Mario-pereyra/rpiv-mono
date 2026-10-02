import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { makeTheme } from "@juicesharp/rpiv-test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildItemsForQuestion } from "../ask-user-question.js";
import type { InteractionOptions } from "../config.js";
import { buildQuestionnaireResponse } from "../tool/response-envelope.js";
import type { QuestionData, QuestionnaireResult } from "../tool/types.js";
import type { QuestionnaireMouseEvent } from "./mouse-input.js";
import { QuestionnaireSession } from "./questionnaire-session.js";

beforeAll(() => initTheme("dark", false));

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const PAGE_DOWN = "\x1b[6~";
const PAGE_UP = "\x1b[5~";
const question: QuestionData = {
	question: "Which approach?",
	header: "Approach",
	options: [
		{ label: "Alpha", description: "First" },
		{ label: "Beta", description: "Second" },
	],
};
const second: QuestionData = { ...question, question: "Which detail?", header: "Detail" };
const options: InteractionOptions = { autoSubmit: false, multiSelectCustom: "combine" };

function setup(
	questions = [question],
	settings: { width?: number; rows?: number; interactionOptions?: InteractionOptions } = {},
) {
	const terminal = { columns: settings.width ?? 160, rows: settings.rows ?? 60 };
	const done = vi.fn<(result: QuestionnaireResult) => void>();
	const session = new QuestionnaireSession({
		tui: { terminal, requestRender: vi.fn() } as unknown as TUI,
		theme: makeTheme({ bold: (s) => `\x1b[1m${s}\x1b[22m` }) as unknown as Theme,
		params: { questions },
		itemsByTab: questions.map(buildItemsForQuestion),
		done,
		keybindings: {
			matches: (data, name) =>
				data ===
				(
					{
						"tui.select.up": UP,
						"tui.select.down": DOWN,
						"tui.select.confirm": ENTER,
						"tui.input.submit": ENTER,
						"tui.select.cancel": ESC,
						"tui.editor.cursorUp": UP,
						"tui.editor.cursorDown": DOWN,
						"tui.editor.deleteToLineStart": "\x15",
					} as Record<string, string>
				)[name],
		},
		editInput: async () => undefined,
		collapseKey: "off",
		canReopenWhileHidden: false,
		interactionOptions: settings.interactionOptions ?? options,
	});
	const render = () => session.component.render(terminal.columns);
	const point = (text: string) => {
		const lines = render();
		const y = lines.findIndex((line) => line.includes(text));
		expect(y, `visible ${text}`).toBeGreaterThanOrEqual(0);
		const line = lines[y]!;
		return { x: visibleWidth(line.slice(0, line.indexOf(text))) + 1, y };
	};
	const mouse = (
		type: QuestionnaireMouseEvent["type"],
		at: { x: number; y: number },
		extra: Partial<QuestionnaireMouseEvent> = {},
	) =>
		session.component.handleMouse({
			type,
			button: type === "move" || type === "wheel" ? "none" : "left",
			...at,
			shift: false,
			alt: false,
			ctrl: false,
			...extra,
		});
	const click = (text: string) => mouse("click", point(text));
	return { session, terminal, done, render, point, mouse, click };
}

function preview(prefix = "ROW"): string {
	return `\`\`\`text\n${Array.from({ length: 50 }, (_v, i) => `${prefix}${String(i + 1).padStart(3, "0")}`).join("\n")}\n\`\`\``;
}
const visual: QuestionData = {
	...question,
	options: question.options.map((o) => ({ ...o, preview: preview(o.label) })),
};
const multi: QuestionData = { ...question, multiSelect: true };

describe("questionnaire parity — numeric selection and pointer chrome", () => {
	it("numbers confirm single-select choices exactly once", () => {
		const s = setup();
		s.session.dispatch("2");
		s.session.dispatch("1");
		expect(s.done).toHaveBeenCalledTimes(1);
		expect(s.done.mock.calls[0]![0].answers[0]?.answer).toBe("Beta");
	});
	it("numbers toggle multi-select, never submit it", () => {
		const s = setup([multi]);
		s.session.dispatch("2");
		expect(s.render().some((line) => line.includes("[✔]") && line.includes("Beta"))).toBe(true);
		expect(s.done).not.toHaveBeenCalled();
		s.session.dispatch("2");
		expect(s.render().some((line) => line.includes("[✔]"))).toBe(false);
	});
	it("the custom row number focuses input without sending an answer", () => {
		const s = setup();
		s.session.dispatch("3");
		s.session.dispatch("123c");
		s.session.dispatch(ENTER);
		expect(s.done.mock.calls[0]![0].answers[0]).toMatchObject({ kind: "custom", answer: "123c" });
	});
	it("digits and c are text while notes are open", () => {
		const s = setup();
		s.session.dispatch("n");
		s.session.dispatch("123c");
		s.session.dispatch(ENTER);
		expect(s.done).not.toHaveBeenCalled();
		s.session.dispatch("1");
		expect(s.done.mock.calls[0]![0].answers[0]?.notes).toBe("123c");
	});
	it("out-of-range numbers do nothing", () => {
		const s = setup();
		s.session.dispatch("9");
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).not.toContain("Discuss before");
	});
	it("click switches question tabs and preserves unsubmitted custom text", () => {
		const s = setup([question, second]);
		s.session.dispatch("3");
		s.session.dispatch("draft 123");
		s.click("Detail");
		expect(s.render().join("\n")).toContain("Which detail?");
		s.click("Approach");
		s.session.dispatch("3");
		expect(s.render().join("\n")).toContain("draft 123");
		expect(s.done).not.toHaveBeenCalled();
	});
	it("clicking Submit tab reviews without submitting", () => {
		const s = setup([question, second]);
		s.click("✓ Submit");
		expect(s.render().join("\n")).toContain("Review your answers");
		expect(s.done).not.toHaveBeenCalled();
	});
	it("notes affordance works with and without preview", () => {
		for (const q of [question, visual]) {
			const s = setup([q]);
			s.click("n to add notes");
			expect(s.render().join("\n")).toContain("Notes:");
			s.session.dispatch("a note");
			s.session.dispatch(ESC);
			s.session.dispatch("2");
			expect(s.done.mock.calls[0]![0].answers[0]?.notes).toBe("a note");
		}
	});
	it.each(["1", "2"])("numbers activate the review picker (%s)", (digit) => {
		const s = setup([question, second]);
		s.click("✓ Submit");
		s.session.dispatch(digit);
		expect(s.done.mock.calls[0]![0].cancelled).toBe(digit === "2");
	});
	it("CJK tab geometry and clipping do not select hidden tabs", () => {
		const s = setup([
			{ ...question, header: "日本語" },
			{ ...second, header: "Detalle" },
		]);
		s.click("Detalle");
		expect(s.render().join("\n")).toContain("Which detail?");
		s.terminal.columns = 8;
		s.render();
		expect(s.mouse("click", { x: 50, y: 1 })).toBeUndefined();
	});
});

describe("questionnaire parity — discussion and completion policy", () => {
	it("discussion is a general response, not a refusal or a question answer", () => {
		const s = setup([question, second]);
		s.session.dispatch("1");
		s.click("c to discuss");
		s.session.dispatch("Explain first; do not implement yet.");
		s.session.dispatch(ENTER);
		const result = s.done.mock.calls[0]![0];
		expect(result).toMatchObject({ cancelled: false, response: "Explain first; do not implement yet." });
		expect(result.answers).toHaveLength(1);
		const text = buildQuestionnaireResponse(result, { questions: [question, second] }).content[0]!.text;
		expect(text).toContain("Which detail?");
		expect(text).toContain("not a final submission");
		expect(text).not.toContain("declined");
		expect(text).not.toContain("can now continue");
	});
	it("Escape returns from discussion without canceling, and retains its draft", () => {
		const s = setup();
		s.session.dispatch("c");
		s.session.dispatch("Explain 123");
		s.session.dispatch(ESC);
		expect(s.render().join("\n")).not.toContain("Discuss before answering:");
		expect(s.done).not.toHaveBeenCalled();
		s.session.dispatch("c");
		expect(s.render().join("\n")).toContain("Explain 123");
	});
	it("empty discussion cannot finish the questionnaire", () => {
		const s = setup();
		s.session.dispatch("c");
		s.session.dispatch(ENTER);
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).toContain("Discuss before answering:");
	});
	it("discussion text does not overwrite a question note", () => {
		const s = setup();
		s.session.dispatch("n");
		s.session.dispatch("keep this note");
		s.session.dispatch(ENTER);
		s.session.dispatch("c");
		s.session.dispatch("different message");
		s.session.dispatch(ESC);
		s.session.dispatch("1");
		expect(s.done.mock.calls[0]![0].answers[0]?.notes).toBe("keep this note");
	});
	it("the compatibility default still shows review", () => {
		const s = setup([question, second]);
		s.session.dispatch("1");
		s.session.dispatch("2");
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).toContain("Review your answers");
	});
	it("opt-in auto-submit completes an all-answered single-select batch", () => {
		const s = setup([question, second], { interactionOptions: { ...options, autoSubmit: true } });
		s.session.dispatch("1");
		s.session.dispatch("2");
		expect(s.done).toHaveBeenCalledTimes(1);
		expect(s.done.mock.calls[0]![0].answers).toHaveLength(2);
	});
	it("auto-submit never invents answers to skipped questions", () => {
		const s = setup([question, second], { interactionOptions: { ...options, autoSubmit: true } });
		s.click("Detail");
		s.session.dispatch("2");
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).toContain("Review your answers");
	});
	it("auto-submit keeps review when another question has an unconfirmed custom draft", () => {
		const s = setup([question, second], { interactionOptions: { ...options, autoSubmit: true } });
		s.session.dispatch("1");
		s.click("Approach");
		s.session.dispatch("3");
		s.session.dispatch("pending revision");
		s.click("Detail");
		s.session.dispatch("2");
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).toContain("Review your answers");
	});
	it("auto-submit does not bypass a multi-select review", () => {
		const s = setup([question, { ...second, multiSelect: true }], {
			interactionOptions: { ...options, autoSubmit: true },
		});
		s.session.dispatch("1");
		s.session.dispatch("2");
		s.session.dispatch(DOWN);
		s.session.dispatch(DOWN);
		s.session.dispatch(ENTER);
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().join("\n")).toContain("Review your answers");
	});
	it("ordinary free text has no instruction to proceed in its envelope", () => {
		const s = setup();
		s.session.dispatch("3");
		s.session.dispatch("wait please");
		s.session.dispatch(ENTER);
		const text = buildQuestionnaireResponse(s.done.mock.calls[0]![0], { questions: [question] }).content[0]!.text;
		expect(text).toContain("wait please");
		expect(text).not.toContain("can now continue");
	});
});

describe("questionnaire parity — combined custom choices", () => {
	it("custom Enter commits a choice, Next submits labels and custom together", () => {
		const s = setup([multi]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		expect(s.done).not.toHaveBeenCalled();
		expect(s.render().some((line) => line.includes("[✔]") && line.includes("Gamma"))).toBe(true);
		s.click("Submit");
		expect(s.done.mock.calls[0]![0].answers[0]).toMatchObject({
			kind: "multi",
			answer: null,
			selected: ["Alpha"],
			customAnswer: "Gamma",
		});
	});
	it("custom-only is an explicit multi answer", () => {
		const s = setup([multi]);
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		s.click("Submit");
		expect(s.done.mock.calls[0]![0].answers[0]).toMatchObject({ kind: "multi", selected: [], customAnswer: "Gamma" });
	});
	it("toggling the last checkbox off retains a committed custom choice", () => {
		const s = setup([multi]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		s.session.dispatch("1");
		s.click("Submit");
		expect(s.done.mock.calls[0]![0].answers[0]).toMatchObject({ selected: [], customAnswer: "Gamma" });
	});
	it("clearing the custom choice keeps checked labels", () => {
		const s = setup([multi]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		s.session.dispatch("3");
		s.session.dispatch("\x15");
		s.session.dispatch(ENTER);
		s.click("Submit");
		const answer = s.done.mock.calls[0]![0].answers[0];
		expect(answer?.selected).toEqual(["Alpha"]);
		expect(answer).not.toHaveProperty("customAnswer");
	});
	it("an unconfirmed draft is never silently transmitted by Next", () => {
		const s = setup([multi]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("unconfirmed");
		s.click("Submit");
		const answer = s.done.mock.calls[0]![0].answers[0];
		expect(answer?.selected).toEqual(["Alpha"]);
		expect(answer).not.toHaveProperty("customAnswer");
	});
	it("a changed draft is retained for editing but never displayed as the committed choice", () => {
		const s = setup([multi]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		s.session.dispatch("3");
		s.session.dispatch("\x15");
		s.session.dispatch("Delta draft");
		s.session.dispatch(UP);
		expect(s.render().some((line) => line.includes("[✔]") && line.includes("Gamma"))).toBe(true);
		s.session.dispatch("3");
		expect(s.render().join("\n")).toContain("Delta draft");
		s.session.dispatch(UP);
		s.click("Submit");
		expect(s.done.mock.calls[0]![0].answers[0]?.customAnswer).toBe("Gamma");
	});
	it("the old exclusive policy remains available", () => {
		const s = setup([multi], { interactionOptions: { autoSubmit: false, multiSelectCustom: "exclusive" } });
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		expect(s.done.mock.calls[0]![0].answers[0]).toMatchObject({ kind: "custom", answer: "Gamma" });
	});
	it("both parts survive tab switches and appear in review and envelope", () => {
		const s = setup([multi, second]);
		s.session.dispatch("1");
		s.session.dispatch("3");
		s.session.dispatch("Gamma");
		s.session.dispatch(ENTER);
		s.click("Next");
		s.click("Approach");
		expect(s.render().join("\n")).toContain("Gamma");
		expect(s.render().join("\n")).toContain("[✔]");
		s.click("✓ Submit");
		expect(s.render().join("\n")).toContain("Alpha, Gamma");
		s.click("Submit answers");
		expect(
			buildQuestionnaireResponse(s.done.mock.calls[0]![0], { questions: [multi, second] }).content[0]!.text,
		).toContain("Alpha, Gamma");
	});
});

describe("questionnaire parity — independent scrolling", () => {
	it.each([160, 70])("keyboard pages reveal the entire preview at width %i", (width) => {
		const s = setup([visual], { width, rows: 100 });
		s.render();
		expect(s.render().join("\n")).not.toContain("Alpha050");
		for (let i = 0; i < 10; i++) {
			s.session.dispatch(PAGE_DOWN);
			s.render();
		}
		expect(s.render().join("\n")).toContain("Alpha050");
		expect(s.done).not.toHaveBeenCalled();
		for (let i = 0; i < 10; i++) {
			s.session.dispatch(PAGE_UP);
			s.render();
		}
		expect(s.render().join("\n")).toContain("Alpha001");
	});
	it("wheel scrolls only the hovered preview, without answering or losing hover", () => {
		const s = setup([visual]);
		s.mouse("move", s.point("Beta"));
		const at = s.point("Beta001");
		s.mouse("move", at);
		expect(s.mouse("wheel", at, { wheelDelta: 500 })).toEqual({ handled: true });
		expect(s.render().join("\n")).toContain("Beta050");
		expect(s.done).not.toHaveBeenCalled();
		s.click("Alpha");
		expect(s.done.mock.calls[0]![0].answers[0]?.answer).toBe("Alpha");
	});
	it("preview offsets stay isolated by option", () => {
		const s = setup([visual]);
		const at = s.point("Alpha001");
		s.mouse("wheel", at, { wheelDelta: 500 });
		s.mouse("move", s.point("Beta"));
		expect(s.render().join("\n")).toContain("Beta001");
		s.mouse("move", s.point("Alpha"));
		expect(s.render().join("\n")).toContain("Alpha050");
	});
	it("body scroll does not change the selected option and keyboard navigation restores focus", () => {
		const q: QuestionData = {
			...question,
			options: [
				{ ...question.options[0]!, description: Array.from({ length: 30 }, (_v, i) => `BODY${i}`).join("\n") },
				question.options[1]!,
			],
		};
		const s = setup([q], { rows: 14 });
		const before = s.render().join("\n");
		const at = { x: 2, y: 6 };
		expect(s.mouse("wheel", at, { wheelDelta: 8 })).toEqual({ handled: true });
		expect(s.render().join("\n")).not.toBe(before);
		expect(s.done).not.toHaveBeenCalled();
		s.session.dispatch(DOWN);
		expect(s.render().join("\n")).toContain("Beta");
	});
	it("opening an editor after manual body scroll brings it into view", () => {
		const q: QuestionData = {
			...question,
			options: [
				{ ...question.options[0]!, description: Array.from({ length: 30 }, (_v, i) => `BODY${i}`).join("\n") },
				question.options[1]!,
			],
		};
		const s = setup([q], { rows: 14 });
		s.render();
		s.mouse("wheel", { x: 2, y: 6 }, { wheelDelta: 8 });
		s.session.dispatch("c");
		expect(s.render().join("\n")).toContain("Discuss before answering:");
		s.session.dispatch(ESC);
		s.session.dispatch("n");
		expect(s.render().join("\n")).toContain("Notes:");
	});
	it("wheel over footer and modified wheel do not affect the questionnaire", () => {
		const s = setup([visual]);
		expect(s.mouse("wheel", s.point("c to discuss"), { wheelDelta: 5 })).toBeUndefined();
		expect(s.mouse("wheel", s.point("Alpha001"), { wheelDelta: 5, ctrl: true })).toBeUndefined();
		expect(s.render().join("\n")).toContain("Alpha001");
	});
	it("wheel is inert while an editor owns focus", () => {
		const s = setup([visual]);
		const at = s.point("Alpha001");
		s.session.dispatch("n");
		expect(s.mouse("wheel", at, { wheelDelta: 5 })).toBeUndefined();
	});
	it("resizing clamps an old preview offset to the new wrapped content", () => {
		const s = setup([visual], { width: 70, rows: 100 });
		const at = s.point("Alpha001");
		s.mouse("wheel", at, { wheelDelta: 500 });
		s.terminal.columns = 160;
		expect(s.render().join("\n")).toContain("Alpha050");
		expect(s.render().every((line) => visibleWidth(line) <= 160)).toBe(true);
	});
});
