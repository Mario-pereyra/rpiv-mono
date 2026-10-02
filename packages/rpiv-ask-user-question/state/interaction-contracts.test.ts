import { describe, expect, it, vi } from "vitest";
import { resolveInteractionOptions } from "../config.js";
import { runRpcQuestionnaire } from "../rpc-fallback.js";
import { makeApplyContext, makeQuestionnaireState } from "../test-fixtures.js";
import { buildQuestionnaireResponse } from "../tool/response-envelope.js";
import type { QuestionAnswer, QuestionData } from "../tool/types.js";
import { reduce } from "./state-reducer.js";

const question: QuestionData = {
	question: "Which features?",
	header: "Features",
	multiSelect: true,
	options: [
		{ label: "Alpha", description: "First" },
		{ label: "Beta", description: "Second" },
	],
};
const ctx = { ...makeApplyContext({ questions: [question] }), multiSelectCustom: "combine" as const };

describe("interaction options boundary", () => {
	it("keeps review and exclusive custom answers as compatibility defaults", () => {
		expect(resolveInteractionOptions({})).toEqual({ autoSubmit: false, multiSelectCustom: "exclusive" });
	});
	it("explicit opt-in enables both features", () => {
		expect(resolveInteractionOptions({ autoSubmit: true, multiSelectCustom: "combine" })).toEqual({
			autoSubmit: true,
			multiSelectCustom: "combine",
		});
	});
	it.each([null, 1, "true", {}, []])("non-boolean autoSubmit %j does not enable automatic submission", (value) => {
		expect(resolveInteractionOptions({ autoSubmit: value as boolean }).autoSubmit).toBe(false);
	});
	it.each([null, 1, "COMBINE", {}, []])("invalid custom policy %j remains exclusive", (value) => {
		expect(resolveInteractionOptions({ multiSelectCustom: value as "combine" }).multiSelectCustom).toBe("exclusive");
	});
});

describe("combined-answer reducer contracts", () => {
	it("does not mutate a previous answer when replacing or clearing a custom choice", () => {
		const answer: QuestionAnswer = Object.freeze({
			questionIndex: 0,
			question: question.question,
			kind: "multi",
			answer: null,
			selected: [],
			customAnswer: "old",
		});
		const state = makeQuestionnaireState({ answers: new Map([[0, answer]]) });
		const next = reduce(state, { kind: "multi_custom", value: "new" }, ctx);
		expect(answer.customAnswer).toBe("old");
		expect(state.answers.get(0)).toBe(answer);
		expect(next.state.answers.get(0)?.customAnswer).toBe("new");
		const cleared = reduce(next.state, { kind: "multi_custom", value: " " }, ctx);
		expect(cleared.state.answers.get(0)).not.toHaveProperty("customAnswer");
		expect(next.state.answers.get(0)?.customAnswer).toBe("new");
	});
	it("custom-only partial review already includes pre-answer notes", () => {
		const state = makeQuestionnaireState({ notesByTab: new Map([[0, "qualifier"]]) });
		const result = reduce(state, { kind: "multi_custom", value: "Gamma" }, ctx);
		expect(result.state.answers.get(0)).toMatchObject({ selected: [], customAnswer: "Gamma", notes: "qualifier" });
	});
	it("combined actions cannot change the exclusive policy", () => {
		const state = makeQuestionnaireState();
		expect(
			reduce(state, { kind: "multi_custom", value: "Gamma" }, { ...ctx, multiSelectCustom: "exclusive" }).state,
		).toBe(state);
	});
	it("unconfirmed custom text remains outside the answer map", () => {
		const state = makeQuestionnaireState({ inputMode: true });
		const result = reduce(state, { kind: "nav", nextIndex: 0, inputValue: "draft" }, ctx);
		expect(result.state.answers.size).toBe(0);
		expect(result.state.customDraftsByTab.get(0)).toBe("draft");
	});
	it("preview offsets are immutable and isolated by tab and option", () => {
		const state = makeQuestionnaireState();
		const first = reduce(state, { kind: "scroll_preview", index: 1, offset: 10 }, ctx).state;
		const second = reduce(first, { kind: "scroll_preview", index: 0, offset: 5 }, ctx).state;
		expect(state.previewScrollOffsets).toBeUndefined();
		expect(first.previewScrollOffsets?.get(0)?.has(0)).toBe(false);
		expect(second.previewScrollOffsets?.get(0)?.get(1)).toBe(10);
	});
});

describe("scroll focus contract", () => {
	it.each([
		{ kind: "notes_enter" },
		{ kind: "notes_exit" },
		{ kind: "discussion_enter", inputValue: "" },
		{ kind: "discussion_exit" },
		{ kind: "submit_nav", nextIndex: 1 },
		{ kind: "toggle", index: 0 },
	] as const)("clears manual body scroll on $kind so the active control stays visible", (action) => {
		const state = { ...makeQuestionnaireState(), bodyScrollOffset: 9 };
		expect(reduce(state, action, ctx).state.bodyScrollOffset).toBeUndefined();
		expect(state.bodyScrollOffset).toBe(9);
	});
});

describe("discussion result contract", () => {
	it("cannot turn ordinary notes into a discussion response", () => {
		const state = makeQuestionnaireState({ notesDraft: "ordinary note" });
		expect(reduce(state, { kind: "discussion_confirm" }, ctx).effects).toEqual([]);
	});
	it("a general reply carries partial answers and global notes without treating them as final", () => {
		const result = buildQuestionnaireResponse(
			{
				answers: [
					{
						questionIndex: 0,
						question: question.question,
						kind: "multi",
						answer: null,
						selected: ["Alpha"],
						customAnswer: "Gamma",
					},
				],
				cancelled: false,
				response: "Explain first",
				globalNote: "Keep it small",
			},
			{ questions: [question] },
		);
		expect(result.details).toMatchObject({
			response: "Explain first",
			globalNote: "Keep it small",
			cancelled: false,
		});
		expect(result.content[0]!.text).toContain("Alpha, Gamma");
		expect(result.content[0]!.text).toContain("Explain first");
		expect(result.content[0]!.text).not.toContain("declined");
	});
});

describe("RPC combined-answer compatibility", () => {
	it("an explicit semicolon combines labels and arbitrary custom text", async () => {
		const ui = { select: vi.fn(), input: vi.fn().mockResolvedValue("1,2; Gamma; with details") };
		const result = await runRpcQuestionnaire(ui, { questions: [question] }, "combine");
		expect(result.answers[0]).toMatchObject({
			kind: "multi",
			selected: ["Alpha", "Beta"],
			customAnswer: "Gamma; with details",
		});
	});
	it("duplicates are normalized and empty custom text does not create a property", async () => {
		const result = await runRpcQuestionnaire(
			{ select: vi.fn(), input: vi.fn().mockResolvedValue("1,1;") },
			{ questions: [question] },
			"combine",
		);
		expect(result.answers[0]?.selected).toEqual(["Alpha"]);
		expect(result.answers[0]).not.toHaveProperty("customAnswer");
	});
	it("invalid numeric prefixes are preserved as custom text, not silently discarded", async () => {
		const result = await runRpcQuestionnaire(
			{ select: vi.fn(), input: vi.fn().mockResolvedValue("99; Gamma") },
			{ questions: [question] },
			"combine",
		);
		expect(result.answers[0]).toMatchObject({ kind: "multi", selected: [], customAnswer: "99; Gamma" });
	});
	it("the default RPC policy remains exclusive and preserves the whole input", async () => {
		const result = await runRpcQuestionnaire(
			{ select: vi.fn(), input: vi.fn().mockResolvedValue("1; Gamma") },
			{ questions: [question] },
		);
		expect(result.answers[0]).toMatchObject({ kind: "custom", answer: "1; Gamma" });
	});
	it("dismissal remains cancellation rather than an empty custom choice", async () => {
		const result = await runRpcQuestionnaire(
			{ select: vi.fn(), input: vi.fn().mockResolvedValue(undefined) },
			{ questions: [question] },
			"combine",
		);
		expect(result).toEqual({ answers: [], cancelled: true });
	});
});
