import { Container, getKeybindings, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { FlowLocation, FlowSymbolCall, FlowSymbolRelations } from "../../../core/flow/protocol.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint, rawKeyHint } from "./keybinding-hints.ts";

type FlowRowSection = "anchor" | "outgoing" | "incoming" | "definitions" | "implementations" | "references";

interface FlowRow {
	section: FlowRowSection;
	location: FlowLocation;
	relativePath: string;
	label: string;
	detail: string;
	openLabel: string;
}

function formatCount(total: number, truncated: boolean): string {
	return `${total}${truncated ? "+" : ""}`;
}

function formatLocation(relativePath: string, location: FlowLocation): string {
	return `${relativePath}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatEvidence(call: FlowSymbolCall): string {
	const evidence = call.evidence[0];
	return evidence ? `callsite ${formatLocation(call.node.relativePath, evidence)}` : "callsite unavailable";
}

function createRows(relations: FlowSymbolRelations): FlowRow[] {
	const rows: FlowRow[] = [
		{
			section: "anchor",
			location: relations.anchor.location,
			relativePath: relations.anchor.relativePath,
			label: `[DEF] ${relations.anchor.qualifiedName}`,
			detail: `@ ${formatLocation(relations.anchor.relativePath, relations.anchor.location)}`,
			openLabel: "definition",
		},
	];
	for (const call of relations.outgoingCalls.items) {
		rows.push({
			section: "outgoing",
			location: call.node.location,
			relativePath: call.node.relativePath,
			label: `[CALL] ${call.node.qualifiedName}`,
			detail: formatEvidence(call),
			openLabel: "callee",
		});
	}
	for (const call of relations.incomingCalls.items) {
		rows.push({
			section: "incoming",
			location: call.node.location,
			relativePath: call.node.relativePath,
			label: `[CALLER] ${call.node.qualifiedName}`,
			detail: formatEvidence(call),
			openLabel: "caller",
		});
	}
	for (const relation of relations.definitions.items) {
		rows.push({
			section: "definitions",
			location: relation.location,
			relativePath: relation.relativePath,
			label: `[DEF] ${relation.relativePath}`,
			detail: "additional definition of the selected symbol",
			openLabel: "additional definition",
		});
	}
	for (const relation of relations.implementations.items) {
		rows.push({
			section: "implementations",
			location: relation.location,
			relativePath: relation.relativePath,
			label: `[IMPL] ${relation.relativePath}`,
			detail: "concrete implementation of a contract",
			openLabel: "implementation",
		});
	}
	for (const relation of relations.references.items) {
		rows.push({
			section: "references",
			location: relation.location,
			relativePath: relation.relativePath,
			label: `[REF] ${relation.relativePath}`,
			detail: "non-call reference to the selected symbol",
			openLabel: "reference",
		});
	}
	return rows;
}

function getSectionLabel(section: FlowRowSection): string | undefined {
	switch (section) {
		case "outgoing":
			return "▼ outgoing calls";
		case "incoming":
			return "▲ incoming calls toward definition";
		case "definitions":
			return "◇ additional definitions";
		case "implementations":
			return "◇ contract implementations";
		case "references":
			return "· non-call references";
		default:
			return undefined;
	}
}

export class FlowSymbolRelationsViewComponent extends Container {
	private readonly tui: TUI;
	private readonly query: string;
	private readonly relations: FlowSymbolRelations;
	private readonly rows: readonly FlowRow[];
	private readonly onOpen: (location: FlowLocation, label: string, relativePath: string) => void;
	private readonly onCancel: () => void;
	private readonly listContainer = new Container();
	private selectedIndex = 0;

	constructor(
		tui: TUI,
		query: string,
		relations: FlowSymbolRelations,
		onOpen: (location: FlowLocation, label: string, relativePath: string) => void,
		onCancel: () => void,
	) {
		super();
		this.tui = tui;
		this.query = query;
		this.relations = relations;
		this.rows = createRows(relations);
		this.onOpen = onOpen;
		this.onCancel = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${theme.fg("accent", theme.bold("FUNCTION FLOW"))}${theme.fg("muted", `  ${this.relations.anchor.qualifiedName}`)}`,
				1,
				0,
			),
		);
		this.addChild(new Text(theme.fg("dim", `  query: ${this.query}`), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${theme.fg("muted", "outgoing calls")} ${formatCount(relations.outgoingCalls.total, relations.outgoingCalls.truncated)}  ${theme.fg("muted", "incoming calls")} ${formatCount(relations.incomingCalls.total, relations.incomingCalls.truncated)}  ${theme.fg("muted", "implementations")} ${formatCount(relations.implementations.total, relations.implementations.truncated)}  ${theme.fg("muted", "references")} ${formatCount(relations.references.total, relations.references.truncated)}`,
				1,
				0,
			),
		);
		this.addChild(new Text(theme.fg("dim", "  main spine: ▼ outgoing calls  ▲ incoming calls"), 1, 0));
		this.addChild(new Text(theme.fg("dim", "  contract and reference relations are side branches"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				`${theme.fg("muted", "legend:")} ${theme.fg("text", "[DEF] definition")}  ${theme.fg("text", "[CALL] callee")}  ${theme.fg("text", "[CALLER] caller")}  ${theme.fg("text", "[IMPL] implementation")}  ${theme.fg("text", "[REF] reference")}`,
				1,
				0,
			),
		);
		this.addChild(
			new Text(
				`${rawKeyHint("up/down or j/k", "navigate")}  ${keyHint("tui.select.confirm", "open symbol")}  ${keyHint("tui.select.cancel", "close")}`,
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
			this.selectedIndex = this.selectedIndex === 0 ? this.rows.length - 1 : this.selectedIndex - 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (keybindings.matches(keyData, "tui.select.down") || keyData === "j") {
			this.selectedIndex = this.selectedIndex === this.rows.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}
		if (keybindings.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			const selected = this.rows[this.selectedIndex];
			if (selected) this.onOpen(selected.location, selected.openLabel, selected.relativePath);
			return;
		}
		if (keybindings.matches(keyData, "tui.select.cancel")) this.onCancel();
	}

	private updateList(): void {
		this.listContainer.clear();
		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxVisible / 2), this.rows.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.rows.length);

		let previousSection: FlowRowSection | undefined;
		for (let index = startIndex; index < endIndex; index += 1) {
			const row = this.rows[index];
			if (!row) continue;
			if (row.section !== previousSection) {
				const sectionLabel = getSectionLabel(row.section);
				if (sectionLabel) {
					this.listContainer.addChild(new Text(theme.fg("dim", `      ${sectionLabel}`), 1, 0));
					this.listContainer.addChild(new Text(theme.fg("dim", "      │"), 1, 0));
				}
			}
			const selected = index === this.selectedIndex;
			const marker = selected ? theme.fg("accent", ">") : " ";
			const target = formatLocation(row.relativePath, row.location);
			const targetText = selected ? theme.fg("accent", target) : theme.fg("text", target);
			const branch = row.section === "anchor" ? "" : "   └─ ";
			this.listContainer.addChild(new Text(`${marker}${branch}${row.label}  ${targetText}`, 1, 0));
			this.listContainer.addChild(new Text(theme.fg("dim", `      ${row.detail}`), 1, 0));
			if (row.section === "anchor" && startIndex === 0) {
				if (this.relations.outgoingCalls.total === 0) {
					this.listContainer.addChild(new Text(theme.fg("dim", "      ▼ outgoing calls (none reported)"), 1, 0));
				}
				if (this.relations.incomingCalls.total === 0) {
					this.listContainer.addChild(
						new Text(theme.fg("dim", "      ▲ incoming calls toward definition (none reported)"), 1, 0),
					);
				}
			}
			previousSection = row.section;
		}

		if (startIndex > 0 || endIndex < this.rows.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.rows.length})`), 1, 0),
			);
		}
	}
}
