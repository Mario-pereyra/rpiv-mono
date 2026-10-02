import type { QuestionAnswer, QuestionData, QuestionnaireResult } from "../tool/types.js";
import type { WrappingSelectItem } from "../view/components/wrapping-select.js";
import type { QuestionnaireAction } from "./key-router.js";
import { ROW_INTENT_META } from "./row-intent.js";
import type { QuestionnaireState } from "./state.js";

/** Session-lifetime constants. No live-component reads — peripheral values live on canonical state. */
export interface ApplyContext {
	questions: readonly QuestionData[];
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>;
	multiSelectCustom?: "exclusive" | "combine";
}

/**
 * Declarative side-effects emitted by `reduce`. The runtime executes them after
 * committing the new state, then asks the props-adapter to re-project. Closed set —
 * adding an effect requires updating both the union AND the runtime's `runEffect` switch
 * (compiler-enforced exhaustive). No string-keyed escape hatch.
 */
export type Effect =
	| { kind: "set_input_buffer"; value: string }
	| { kind: "clear_input_buffer" }
	| { kind: "open_input_editor"; value: string }
	| { kind: "set_notes_value"; value: string }
	| { kind: "set_notes_focused"; focused: boolean }
	| { kind: "forward_notes_keystroke"; data: string }
	/**
	 * Tell the session to hide or show its underlying overlay. Emitted by the
	 * `toggle_collapsed` action so the runtime can call `OverlayHandle.setHidden(...)`,
	 * which lets other overlay-aware consumers (e.g. `pi-station`) see the questionnaire
	 * as truly hidden and resume normal chat scroll while the user reads the transcript
	 * behind the modal.
	 */
	| { kind: "set_overlay_hidden"; hidden: boolean }
	| { kind: "confirm_focused" }
	| { kind: "done"; result: QuestionnaireResult };

export interface ApplyResult {
	state: QuestionnaireState;
	effects: readonly Effect[];
}

function orderedAnswers(state: QuestionnaireState, questions: readonly QuestionData[]): QuestionAnswer[] {
	const out: QuestionAnswer[] = [];
	for (let i = 0; i < questions.length; i++) {
		const a = state.answers.get(i);
		if (a) out.push(a);
	}
	return out;
}

function syncMultiSelectFromAnswers(
	answers: ReadonlyMap<number, QuestionAnswer>,
	questions: readonly QuestionData[],
	tab: number,
): ReadonlySet<number> {
	const q = questions[tab];
	if (!q?.multiSelect) return new Set();
	const saved = answers.get(tab);
	const labels = saved?.selected ?? [];
	const indices = new Set<number>();
	for (let i = 0; i < q.options.length; i++) {
		if (labels.includes(q.options[i]!.label)) indices.add(i);
	}
	return indices;
}

function persistMultiSelectAnswer(state: QuestionnaireState, ctx: ApplyContext): ReadonlyMap<number, QuestionAnswer> {
	const q = ctx.questions[state.currentTab];
	if (!q?.multiSelect) return state.answers;
	const selected: string[] = [];
	for (let i = 0; i < q.options.length; i++) {
		if (state.multiSelectChecked.has(i)) selected.push(q.options[i]!.label);
	}
	const out = new Map(state.answers);
	const customAnswer =
		ctx.multiSelectCustom === "combine" ? state.answers.get(state.currentTab)?.customAnswer : undefined;
	if (selected.length === 0 && !customAnswer) {
		out.delete(state.currentTab);
		return out;
	}
	const pendingNotes = state.notesByTab.get(state.currentTab);
	out.set(state.currentTab, {
		questionIndex: state.currentTab,
		question: q.question,
		kind: "multi",
		answer: null,
		selected,
		...(customAnswer ? { customAnswer } : {}),
		...(pendingNotes && pendingNotes.length > 0 ? { notes: pendingNotes } : {}),
	});
	return out;
}

/**
 * Note text to seed the editor/draft with for a tab. The in-flight side-band store
 * (`notesByTab`) is authoritative — before an option is confirmed the note lives ONLY
 * there; `answer.notes` is a mirror written on exit/confirm.
 */
function notesValueFor(state: QuestionnaireState, tab: number): string {
	return state.notesByTab.get(tab) ?? state.answers.get(tab)?.notes ?? "";
}

function customDraftValueFor(state: QuestionnaireState, tab: number): string {
	const draft = state.customDraftsByTab.get(tab);
	if (draft !== undefined) return draft;
	const answer = state.answers.get(tab);
	return answer?.kind === "custom" && typeof answer.answer === "string" ? answer.answer : (answer?.customAnswer ?? "");
}

function setCustomDraft(state: QuestionnaireState, tab: number, value: string): ReadonlyMap<number, string> {
	const drafts = new Map(state.customDraftsByTab);
	drafts.set(tab, value);
	return drafts;
}

function withoutCustomDraft(state: QuestionnaireState, tab: number): ReadonlyMap<number, string> {
	if (!state.customDraftsByTab.has(tab)) return state.customDraftsByTab;
	const drafts = new Map(state.customDraftsByTab);
	drafts.delete(tab);
	return drafts;
}

function switchTabResult(state: QuestionnaireState, nextTab: number, ctx: ApplyContext): ApplyResult {
	const notesValue = notesValueFor(state, nextTab);
	const transitioned: QuestionnaireState = {
		...state,
		currentTab: nextTab,
		bodyScrollOffset: undefined,
		optionIndex: 0,
		inputMode: false,
		notesVisible: false,
		submitChoiceIndex: 0,
		multiSelectChecked: syncMultiSelectFromAnswers(state.answers, ctx.questions, nextTab),
		notesDraft: notesValue,
	};
	return {
		state: transitioned,
		effects: [
			{ kind: "set_notes_focused", focused: false },
			{ kind: "set_notes_value", value: notesValue },
			{ kind: "set_input_buffer", value: customDraftValueFor(state, nextTab) },
		],
	};
}

function doneFor(state: QuestionnaireState, ctx: ApplyContext, cancelled: boolean, response?: string): ApplyResult {
	// Global note lift: the Submit-tab note lives at the `questions.length` pseudo-index
	// in `notesByTab` — question tabs only occupy 0..questions.length-1, so this can never
	// cross-contaminate a per-question note. Attached regardless of `cancelled` (the
	// reducer is truth; the envelope owns decline presentation), with cancel/submit/confirm
	// sharing this single lift. Conditional spread keeps note-free results byte-identical.
	const globalNote = state.notesByTab.get(ctx.questions.length);
	const result: QuestionnaireResult = {
		answers: orderedAnswers(state, ctx.questions),
		cancelled,
		...(response ? { response } : {}),
		...(globalNote && globalNote.length > 0 ? { globalNote } : {}),
	};
	return { state, effects: [{ kind: "done", result }] };
}

/**
 * Per-kind handler signature: action payload narrows to the matching union member
 * via `Extract`, so handlers consume fully-typed actions without `as` casts.
 */
type Handler<K extends QuestionnaireAction["kind"]> = (
	state: QuestionnaireState,
	action: Extract<QuestionnaireAction, { kind: K }>,
	ctx: ApplyContext,
) => ApplyResult;

const navHandler: Handler<"nav"> = (state, action, ctx) => {
	const items = ctx.itemsByTab[state.currentTab] ?? [];
	const item = items[action.nextIndex];
	const inputMode = item ? ROW_INTENT_META[item.kind].activatesInputMode : false;
	const customDraftsByTab = state.inputMode
		? setCustomDraft(state, state.currentTab, action.inputValue)
		: state.customDraftsByTab;
	const next: QuestionnaireState = {
		...state,
		bodyScrollOffset: undefined,
		optionIndex: action.nextIndex,
		inputMode,
		customDraftsByTab,
	};
	if (!inputMode) return { state: next, effects: [] };
	return {
		state: next,
		effects: [{ kind: "set_input_buffer", value: customDraftValueFor(next, state.currentTab) }],
	};
};

const inputClearHandler: Handler<"input_clear"> = (state, _action, _ctx) => ({
	state: { ...state, customDraftsByTab: setCustomDraft(state, state.currentTab, "") },
	effects: [{ kind: "clear_input_buffer" }],
});
const inputEditHandler: Handler<"input_edit"> = (state, action, _ctx) => ({
	state,
	effects: [{ kind: "open_input_editor", value: action.value }],
});
const inputReplaceHandler: Handler<"input_replace"> = (state, action, _ctx) => ({
	state: { ...state, customDraftsByTab: setCustomDraft(state, state.currentTab, action.value) },
	effects: [{ kind: "set_input_buffer", value: action.value }],
});

const tabSwitchHandler: Handler<"tab_switch"> = (state, action, ctx) => switchTabResult(state, action.nextTab, ctx);

const confirmHandler: Handler<"confirm"> = (state, action, ctx) => {
	let answer = action.answer;
	if (answer.kind === "option" && answer.answer) {
		const q = ctx.questions[answer.questionIndex];
		const matched = q?.options.find((o) => o.label === answer.answer);
		if (matched?.preview && matched.preview.length > 0) {
			answer = { ...answer, preview: matched.preview };
		}
	}
	const pendingNotes = state.notesByTab.get(answer.questionIndex);
	if (pendingNotes && pendingNotes.length > 0) {
		answer = { ...answer, notes: pendingNotes };
	}
	const answers = new Map(state.answers);
	answers.set(answer.questionIndex, answer);
	// Custom free-text on a multi-select tab is mutually exclusive with checkbox selections:
	// clear the checked set immediately so [✔] glyphs vanish on Enter. (A custom answer
	// carries no `selected` array, so syncMultiSelectFromAnswers keeps it empty on tab-back.)
	const isCustomMulti = answer.kind === "custom" && ctx.questions[answer.questionIndex]?.multiSelect === true;
	const customDraftsByTab =
		answer.kind === "custom" ? withoutCustomDraft(state, answer.questionIndex) : state.customDraftsByTab;
	const next: QuestionnaireState = {
		...state,
		answers,
		customDraftsByTab,
		...(isCustomMulti ? { multiSelectChecked: new Set<number>() } : {}),
	};
	if (action.autoAdvanceTab !== undefined) return switchTabResult(next, action.autoAdvanceTab, ctx);
	return doneFor(next, ctx, false);
};

const toggleHandler: Handler<"toggle"> = (state, action, ctx) => {
	const checked = new Set(state.multiSelectChecked);
	if (checked.has(action.index)) checked.delete(action.index);
	else checked.add(action.index);
	const intermediate: QuestionnaireState = { ...state, multiSelectChecked: checked, bodyScrollOffset: undefined };
	const answers = persistMultiSelectAnswer(intermediate, ctx);
	return { state: { ...intermediate, answers }, effects: [] };
};

const multiConfirmHandler: Handler<"multi_confirm"> = (state, action, ctx) => {
	const q = ctx.questions[state.currentTab];
	if (!q) return { state, effects: [] };
	const pendingNotes = state.notesByTab.get(state.currentTab);
	const answers = new Map(state.answers);
	answers.set(state.currentTab, {
		questionIndex: state.currentTab,
		question: q.question,
		kind: "multi",
		answer: null,
		selected: action.selected,
		...(ctx.multiSelectCustom === "combine" && state.answers.get(state.currentTab)?.customAnswer
			? { customAnswer: state.answers.get(state.currentTab)!.customAnswer }
			: {}),
		...(pendingNotes && pendingNotes.length > 0 ? { notes: pendingNotes } : {}),
	});
	const synced: QuestionnaireState = {
		...state,
		answers,
		multiSelectChecked: syncMultiSelectFromAnswers(answers, ctx.questions, state.currentTab),
	};
	if (action.autoAdvanceTab !== undefined) return switchTabResult(synced, action.autoAdvanceTab, ctx);
	return doneFor(synced, ctx, false);
};

const notesEnterHandler: Handler<"notes_enter"> = (state, _action, _ctx) => {
	const value = notesValueFor(state, state.currentTab);
	return {
		state: { ...state, notesVisible: true, notesDraft: value, bodyScrollOffset: undefined },
		effects: [
			{ kind: "set_notes_value", value },
			{ kind: "set_notes_focused", focused: true },
		],
	};
};

const notesExitHandler: Handler<"notes_exit"> = (state, _action, _ctx) => {
	const trimmed = state.notesDraft.trim();
	const notes = new Map(state.notesByTab);
	const answers = new Map(state.answers);
	if (trimmed.length === 0) {
		notes.delete(state.currentTab);
		const prev = answers.get(state.currentTab);
		if (prev?.notes) {
			const stripped = { ...prev };
			delete (stripped as { notes?: string }).notes;
			answers.set(state.currentTab, stripped);
		}
	} else {
		notes.set(state.currentTab, trimmed);
		const prev = answers.get(state.currentTab);
		if (prev) answers.set(state.currentTab, { ...prev, notes: trimmed });
	}
	return {
		state: { ...state, notesByTab: notes, answers, notesVisible: false, bodyScrollOffset: undefined },
		effects: [{ kind: "set_notes_focused", focused: false }],
	};
};

const cancelHandler: Handler<"cancel"> = (s, _a, c) => doneFor(s, c, true);
const submitHandler: Handler<"submit"> = (s, _a, c) => doneFor(s, c, false);
const submitNavHandler: Handler<"submit_nav"> = (s, a, _c) => ({
	state: { ...s, submitChoiceIndex: a.nextIndex, bodyScrollOffset: undefined },
	effects: [],
});
const notesForwardHandler: Handler<"notes_forward"> = (s, a, _c) => ({
	state: s,
	effects: [{ kind: "forward_notes_keystroke", data: a.data }],
});
const toggleCollapsedHandler: Handler<"toggle_collapsed"> = (s, _a, _c) => ({
	state: { ...s, collapsed: !s.collapsed },
	effects: [{ kind: "set_overlay_hidden", hidden: !s.collapsed }],
});
const hoverHandler: Handler<"hover"> = (state, action, _ctx) => ({
	state: { ...state, hoveredOptionIndex: action.index },
	effects: [],
});
const activateHandler: Handler<"activate"> = (state, action, ctx) => {
	const result = navHandler(state, { kind: "nav", nextIndex: action.index, inputValue: action.inputValue }, ctx);
	return result.state.inputMode ? result : { ...result, effects: [...result.effects, { kind: "confirm_focused" }] };
};

const discussionEnterHandler: Handler<"discussion_enter"> = (state, action, _ctx) => ({
	state: {
		...state,
		discussionVisible: true,
		notesVisible: false,
		bodyScrollOffset: undefined,
		customDraftsByTab: state.inputMode
			? setCustomDraft(state, state.currentTab, action.inputValue)
			: state.customDraftsByTab,
	},
	effects: [
		{ kind: "set_notes_value", value: state.discussionDraft ?? "" },
		{ kind: "set_notes_focused", focused: true },
	],
});
const discussionExitHandler: Handler<"discussion_exit"> = (state, _action, _ctx) => ({
	state: { ...state, discussionVisible: false, discussionDraft: state.notesDraft, bodyScrollOffset: undefined },
	effects: [
		{ kind: "set_notes_value", value: notesValueFor(state, state.currentTab) },
		{ kind: "set_notes_focused", focused: false },
	],
});
const discussionConfirmHandler: Handler<"discussion_confirm"> = (state, _action, ctx) => {
	if (!state.discussionVisible || !state.notesDraft.trim()) return { state, effects: [] };
	return doneFor(state, ctx, false, state.notesDraft);
};
const multiCustomHandler: Handler<"multi_custom"> = (state, action, ctx) => {
	const q = ctx.questions[state.currentTab];
	if (!q?.multiSelect || ctx.multiSelectCustom !== "combine") return { state, effects: [] };
	const answers = new Map(persistMultiSelectAnswer(state, ctx));
	const previous = answers.get(state.currentTab);
	const customAnswer = action.value.trim() ? action.value : undefined;
	const answer: QuestionAnswer = previous ?? {
		questionIndex: state.currentTab,
		question: q.question,
		kind: "multi",
		answer: null,
		selected: [],
	};
	const base = { ...answer };
	delete base.customAnswer;
	const notes = state.notesByTab.get(state.currentTab);
	answers.set(state.currentTab, { ...base, ...(customAnswer ? { customAnswer } : {}), ...(notes ? { notes } : {}) });
	return {
		state: {
			...state,
			answers,
			inputMode: false,
			bodyScrollOffset: undefined,
			optionIndex: q.options.length + 1,
			customDraftsByTab: withoutCustomDraft(state, state.currentTab),
		},
		effects: [],
	};
};
const scrollBodyHandler: Handler<"scroll_body"> = (state, action, _ctx) => ({
	state: { ...state, bodyScrollOffset: action.offset },
	effects: [],
});
const scrollPreviewHandler: Handler<"scroll_preview"> = (state, action, _ctx) => {
	const tabs = new Map(state.previewScrollOffsets);
	const options = new Map(tabs.get(state.currentTab));
	options.set(action.index, action.offset);
	tabs.set(state.currentTab, options);
	return { state: { ...state, previewScrollOffsets: tabs }, effects: [] };
};
const ignoreHandler: Handler<"ignore"> = (s, _a, _c) => ({ state: s, effects: [] });

/**
 * Compile-time-exhaustive dispatch table. `{ [K in Kind]: Handler<K> }` requires
 * an entry per union member — adding a new `QuestionnaireAction` variant fails to
 * compile here until a handler is registered, mirroring the `Record<RowKind, …>`
 * pattern used by `ROW_INTENT_META`.
 */
const HANDLERS: { [K in QuestionnaireAction["kind"]]: Handler<K> } = {
	nav: navHandler,
	activate: activateHandler,
	discussion_enter: discussionEnterHandler,
	discussion_exit: discussionExitHandler,
	discussion_confirm: discussionConfirmHandler,
	multi_custom: multiCustomHandler,
	scroll_body: scrollBodyHandler,
	scroll_preview: scrollPreviewHandler,
	input_clear: inputClearHandler,
	input_edit: inputEditHandler,
	input_replace: inputReplaceHandler,
	tab_switch: tabSwitchHandler,
	confirm: confirmHandler,
	toggle: toggleHandler,
	multi_confirm: multiConfirmHandler,
	cancel: cancelHandler,
	notes_enter: notesEnterHandler,
	notes_exit: notesExitHandler,
	notes_forward: notesForwardHandler,
	submit: submitHandler,
	submit_nav: submitNavHandler,
	toggle_collapsed: toggleCollapsedHandler,
	hover: hoverHandler,
	ignore: ignoreHandler,
};

/**
 * Pure reducer: (state, action, ctx) → (state, Effect[]). Mirrors `rpiv-todo`'s `applyTaskMutation`.
 * Delegates to `HANDLERS` — per-kind handlers above are pure, named, and individually testable.
 * `ignore` is also handled outside the reducer by `handleIgnoreInline` in the runtime fast path.
 */
export function reduce(state: QuestionnaireState, action: QuestionnaireAction, ctx: ApplyContext): ApplyResult {
	if (
		action.kind !== "hover" &&
		action.kind !== "scroll_preview" &&
		action.kind !== "scroll_body" &&
		state.hoveredOptionIndex !== undefined
	) {
		state = { ...state, hoveredOptionIndex: undefined };
	}
	const handler = HANDLERS[action.kind] as Handler<typeof action.kind>;
	return handler(state, action as never, ctx);
}
