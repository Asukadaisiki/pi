import { Container, getKeybindings, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { FlowSymbolCandidate } from "../../../core/flow/protocol.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

export class FlowSymbolSelectorComponent extends Container {
	private readonly tui: TUI;
	private readonly query: string;
	private readonly candidates: readonly FlowSymbolCandidate[];
	private readonly onSelect: (candidate: FlowSymbolCandidate) => void;
	private readonly onCancel: () => void;
	private readonly listContainer = new Container();
	private selectedIndex = 0;

	constructor(
		tui: TUI,
		query: string,
		candidates: readonly FlowSymbolCandidate[],
		onSelect: (candidate: FlowSymbolCandidate) => void,
		onCancel: () => void,
	) {
		super();
		this.tui = tui;
		this.query = query;
		this.candidates = candidates;
		this.onSelect = onSelect;
		this.onCancel = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${theme.fg("accent", theme.bold("FLOW SYMBOL SEARCH"))}${theme.fg("muted", `  query: ${this.query}`)}`,
				1,
				0,
			),
		);
		this.addChild(new Text(theme.fg("dim", "  [DEF] search result is the definition anchor"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${rawKeyHint("up/down or j/k", "navigate")}  ${keyHint("tui.select.confirm", "select")}  ${keyHint("tui.select.cancel", "cancel")}`,
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.updateList();
	}

	handleInput(keyData: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(keyData, "tui.select.up") || keyData === "k") {
			this.selectedIndex = this.selectedIndex === 0 ? this.candidates.length - 1 : this.selectedIndex - 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (keybindings.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = this.selectedIndex === this.candidates.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (keybindings.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			const selected = this.candidates[this.selectedIndex];
			if (selected) this.onSelect(selected);
			return;
		}
		if (keybindings.matches(keyData, "tui.select.cancel")) {
			this.onCancel();
		}
	}

	private updateList(): void {
		this.listContainer.clear();
		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.candidates.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.candidates.length);

		for (let index = startIndex; index < endIndex; index += 1) {
			const candidate = this.candidates[index];
			if (!candidate) continue;
			const selected = index === this.selectedIndex;
			const marker = selected ? theme.fg("accent", ">") : " ";
			const kind = candidate.kind.padEnd(12);
			const symbol = selected
				? theme.fg("accent", candidate.qualifiedName)
				: theme.fg("text", candidate.qualifiedName);
			this.listContainer.addChild(
				new Text(`${marker} ${theme.fg("accent", "[DEF]")} ${theme.fg("muted", kind)}${symbol}`, 1, 0),
			);
			this.listContainer.addChild(
				new Text(
					theme.fg(
						"dim",
						`  ${candidate.relativePath}:${candidate.location.range.start.line + 1}:${candidate.location.range.start.character + 1}`,
					),
					1,
					0,
				),
			);
		}

		if (startIndex > 0 || endIndex < this.candidates.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.candidates.length})`), 1, 0),
			);
		}
	}
}
