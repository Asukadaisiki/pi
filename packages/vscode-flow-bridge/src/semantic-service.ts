import * as path from "node:path";
import type {
	FlowLocation,
	FlowSymbolCall,
	FlowSymbolCallGroup,
	FlowSymbolCandidate,
	FlowSymbolRelation,
	FlowSymbolRelationGroup,
	FlowSymbolRelations,
	FlowSymbolRelationType,
} from "asuka.pi/flow-protocol";
import * as vscode from "vscode";

const EXCLUDED_PATH_SEGMENTS = new Set([
	".git",
	".next",
	"build",
	"coverage",
	"dist",
	"generated",
	"node_modules",
	"out",
	"target",
	"vendor",
]);
const MAX_RELATIONS_PER_GROUP = 100;
const MAX_CALLS_PER_GROUP = 40;
const WORKSPACE_SYMBOL_RETRY_DELAYS_MS = [250, 750, 1500, 2500] as const;
const SOURCE_FILE_GLOB = "**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}";
const SOURCE_FILE_EXCLUDE_GLOB = "**/{.git,node_modules,dist,build,out,coverage,generated}/**";

function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
	const relativePath = path.relative(workspaceRoot, filePath);
	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
	);
}

function isExcludedRelativePath(relativePath: string): boolean {
	return relativePath
		.replace(/\\/g, "/")
		.split("/")
		.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment.toLowerCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toVscodeUri(value: unknown): vscode.Uri | undefined {
	if (value instanceof vscode.Uri) return value;
	if (!isRecord(value) || typeof value.scheme !== "string" || typeof value.path !== "string") return undefined;
	const toStringMethod = value.toString;
	if (typeof toStringMethod !== "function") return undefined;
	try {
		return vscode.Uri.parse(toStringMethod.call(value), true);
	} catch {
		return undefined;
	}
}

function toVscodeRangeValue(value: unknown): vscode.Range | undefined {
	if (value instanceof vscode.Range) return value;
	if (!isRecord(value) || !isRecord(value.start) || !isRecord(value.end)) return undefined;
	const { start, end } = value;
	if (
		typeof start.line !== "number" ||
		typeof start.character !== "number" ||
		typeof end.line !== "number" ||
		typeof end.character !== "number"
	) {
		return undefined;
	}
	return new vscode.Range(start.line, start.character, end.line, end.character);
}

function toFlowLocation(value: unknown): FlowLocation | undefined {
	if (!isRecord(value)) return undefined;
	const uri = toVscodeUri(value.uri ?? value.targetUri);
	const range = toVscodeRangeValue(value.range ?? value.targetSelectionRange ?? value.targetRange);
	if (!uri || !range) return undefined;
	return toFlowLocationAt(uri, range);
}

function toFlowLocationAt(uri: vscode.Uri, range: vscode.Range): FlowLocation {
	return {
		uri: uri.toString(true),
		range: {
			start: { line: range.start.line, character: range.start.character },
			end: { line: range.end.line, character: range.end.character },
		},
	};
}

function toVscodeRange(location: FlowLocation): vscode.Range {
	return new vscode.Range(
		location.range.start.line,
		location.range.start.character,
		location.range.end.line,
		location.range.end.character,
	);
}

function getSymbolKindName(kind: vscode.SymbolKind): string {
	switch (kind) {
		case vscode.SymbolKind.File:
			return "file";
		case vscode.SymbolKind.Module:
			return "module";
		case vscode.SymbolKind.Namespace:
			return "namespace";
		case vscode.SymbolKind.Package:
			return "package";
		case vscode.SymbolKind.Class:
			return "class";
		case vscode.SymbolKind.Method:
			return "method";
		case vscode.SymbolKind.Property:
			return "property";
		case vscode.SymbolKind.Field:
			return "field";
		case vscode.SymbolKind.Constructor:
			return "constructor";
		case vscode.SymbolKind.Enum:
			return "enum";
		case vscode.SymbolKind.Interface:
			return "interface";
		case vscode.SymbolKind.Function:
			return "function";
		case vscode.SymbolKind.Variable:
			return "variable";
		case vscode.SymbolKind.Constant:
			return "constant";
		case vscode.SymbolKind.String:
			return "string";
		case vscode.SymbolKind.Number:
			return "number";
		case vscode.SymbolKind.Boolean:
			return "boolean";
		case vscode.SymbolKind.Array:
			return "array";
		case vscode.SymbolKind.Object:
			return "object";
		case vscode.SymbolKind.Key:
			return "key";
		case vscode.SymbolKind.Null:
			return "null";
		case vscode.SymbolKind.EnumMember:
			return "enum-member";
		case vscode.SymbolKind.Struct:
			return "struct";
		case vscode.SymbolKind.Event:
			return "event";
		case vscode.SymbolKind.Operator:
			return "operator";
		case vscode.SymbolKind.TypeParameter:
			return "type-parameter";
		default:
			return "symbol";
	}
}

function getFlowLocationStartKey(location: FlowLocation): string {
	return `${location.uri}\0${location.range.start.line}\0${location.range.start.character}`;
}

function sameFlowLocationStart(left: FlowLocation, right: FlowLocation): boolean {
	return getFlowLocationStartKey(left) === getFlowLocationStartKey(right);
}

function compareFlowPosition(
	left: { line: number; character: number },
	right: { line: number; character: number },
): number {
	return left.line - right.line || left.character - right.character;
}

function rangesOverlap(left: FlowLocation, right: FlowLocation): boolean {
	return (
		left.uri === right.uri &&
		compareFlowPosition(left.range.start, right.range.end) <= 0 &&
		compareFlowPosition(right.range.start, left.range.end) <= 0
	);
}

function isExcludedFlowLocation(left: FlowLocation, right: FlowLocation): boolean {
	return sameFlowLocationStart(left, right) || rangesOverlap(left, right);
}

function toFlowSymbolCandidate(value: unknown, workspaceRoot: string): FlowSymbolCandidate | undefined {
	if (!isRecord(value)) return undefined;
	const uri = toVscodeUri(value.uri);
	const range = toVscodeRangeValue(value.range);
	const name = typeof value.name === "string" ? value.name.trim() : "";
	if (!uri || !range || !name) return undefined;
	if (uri.scheme !== "file" || !isInsideWorkspace(uri.fsPath, workspaceRoot)) return undefined;
	const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/");
	if (!relativePath || isExcludedRelativePath(relativePath)) return undefined;
	return {
		name,
		qualifiedName: name,
		kind: getSymbolKindName(typeof value.kind === "number" ? value.kind : vscode.SymbolKind.Function),
		relativePath,
		location: toFlowLocationAt(uri, range),
	};
}

function createCallGroup(
	values: readonly unknown[],
	direction: "incoming" | "outgoing",
	workspaceRoot: string,
	anchorUri: vscode.Uri,
): FlowSymbolCallGroup {
	const calls = new Map<string, FlowSymbolCall>();
	for (const value of values) {
		if (!isRecord(value)) continue;
		const node = toFlowSymbolCandidate(direction === "incoming" ? value.from : value.to, workspaceRoot);
		const ranges = value.fromRanges;
		if (!node || !Array.isArray(ranges)) continue;
		const evidenceUri = direction === "incoming" ? vscode.Uri.parse(node.location.uri, true) : anchorUri;
		const evidence = ranges
			.map((range) => toVscodeRangeValue(range))
			.filter((range): range is vscode.Range => range !== undefined)
			.map((range) => toFlowLocationAt(evidenceUri, range));
		if (evidence.length === 0) continue;
		const key = getFlowLocationStartKey(node.location);
		const existing = calls.get(key);
		if (!existing) {
			calls.set(key, { node, evidence });
			continue;
		}
		const evidenceKeys = new Set(existing.evidence.map(getFlowLocationStartKey));
		for (const location of evidence) {
			if (!evidenceKeys.has(getFlowLocationStartKey(location))) existing.evidence.push(location);
		}
	}
	const items = [...calls.values()].sort(
		(left, right) =>
			left.node.relativePath.localeCompare(right.node.relativePath) ||
			left.node.location.range.start.line - right.node.location.range.start.line ||
			left.node.location.range.start.character - right.node.location.range.start.character ||
			left.node.qualifiedName.localeCompare(right.node.qualifiedName),
	);
	return {
		items: items.slice(0, MAX_CALLS_PER_GROUP),
		total: items.length,
		truncated: items.length > MAX_CALLS_PER_GROUP,
	};
}

function toFlowRelation(
	value: unknown,
	type: FlowSymbolRelationType,
	workspaceRoot: string,
): FlowSymbolRelation | undefined {
	const location = toFlowLocation(value);
	if (!location) return undefined;
	const uri = vscode.Uri.parse(location.uri, true);
	if (uri.scheme !== "file" || !isInsideWorkspace(uri.fsPath, workspaceRoot)) return undefined;
	const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/");
	if (!relativePath || isExcludedRelativePath(relativePath)) return undefined;
	return { type, relativePath, location };
}

function createRelationGroup(
	values: readonly unknown[],
	type: FlowSymbolRelationType,
	workspaceRoot: string,
	excludedLocations: readonly FlowLocation[] = [],
): FlowSymbolRelationGroup {
	const seen = new Set<string>();
	const relations: FlowSymbolRelation[] = [];
	for (const value of values) {
		const relation = toFlowRelation(value, type, workspaceRoot);
		if (
			!relation ||
			excludedLocations.some((excludedLocation) => isExcludedFlowLocation(relation.location, excludedLocation))
		) {
			continue;
		}
		const key = getFlowLocationStartKey(relation.location);
		if (seen.has(key)) continue;
		seen.add(key);
		relations.push(relation);
	}
	relations.sort(
		(left, right) =>
			left.relativePath.localeCompare(right.relativePath) ||
			left.location.range.start.line - right.location.range.start.line ||
			left.location.range.start.character - right.location.range.start.character,
	);
	return {
		items: relations.slice(0, MAX_RELATIONS_PER_GROUP),
		total: relations.length,
		truncated: relations.length > MAX_RELATIONS_PER_GROUP,
	};
}

function deduplicateRelationGroup(
	group: FlowSymbolRelationGroup,
	occupiedLocations: Set<string>,
): FlowSymbolRelationGroup {
	const items: FlowSymbolRelation[] = [];
	let removedCount = 0;
	for (const relation of group.items) {
		const key = getFlowLocationStartKey(relation.location);
		if (occupiedLocations.has(key)) {
			removedCount += 1;
			continue;
		}
		occupiedLocations.add(key);
		items.push(relation);
	}
	return {
		items,
		total: group.truncated ? Math.max(items.length, group.total - removedCount) : items.length,
		truncated: group.truncated,
	};
}

export class FlowSemanticService {
	private readonly workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async searchSymbols(query: string): Promise<FlowSymbolCandidate[]> {
		let symbols =
			(await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
				"vscode.executeWorkspaceSymbolProvider",
				query,
			)) ?? [];
		if (symbols.length === 0) await this.warmUpLanguageService();
		for (const delayMs of WORKSPACE_SYMBOL_RETRY_DELAYS_MS) {
			if (symbols.length > 0) break;
			await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
			symbols =
				(await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
					"vscode.executeWorkspaceSymbolProvider",
					query,
				)) ?? [];
		}
		const candidates: FlowSymbolCandidate[] = [];
		for (const symbol of symbols) {
			if (symbol.location.uri.scheme !== "file") continue;
			if (!isInsideWorkspace(symbol.location.uri.fsPath, this.workspaceRoot)) continue;
			const relativePath = path.relative(this.workspaceRoot, symbol.location.uri.fsPath).replace(/\\/g, "/");
			if (!relativePath || isExcludedRelativePath(relativePath)) continue;
			const location = toFlowLocationAt(symbol.location.uri, symbol.location.range);
			const containerName = symbol.containerName?.trim() || undefined;
			candidates.push({
				name: symbol.name,
				qualifiedName: containerName ? `${containerName}.${symbol.name}` : symbol.name,
				...(containerName && { containerName }),
				kind: getSymbolKindName(symbol.kind),
				relativePath,
				location,
			});
		}
		return candidates;
	}

	private async warmUpLanguageService(): Promise<void> {
		const [sourceUri] = await vscode.workspace.findFiles(SOURCE_FILE_GLOB, SOURCE_FILE_EXCLUDE_GLOB, 1);
		if (sourceUri) await vscode.workspace.openTextDocument(sourceUri);
	}

	async getSymbolRelations(symbol: FlowSymbolCandidate): Promise<FlowSymbolRelations> {
		const uri = vscode.Uri.parse(symbol.location.uri, true);
		if (uri.scheme !== "file" || !isInsideWorkspace(uri.fsPath, this.workspaceRoot)) {
			throw new Error("Flow symbol is outside the connected workspace");
		}
		const position = await this.resolveSymbolProviderPosition(symbol, uri);
		const symbolNameLocation: FlowLocation = {
			uri: symbol.location.uri,
			range: {
				start: { line: position.line, character: position.character },
				end: { line: position.line, character: position.character + symbol.name.length },
			},
		};
		const excludedLocations = [symbol.location, symbolNameLocation];
		const [definitions, implementations, references, hierarchyItems] = await Promise.all([
			vscode.commands.executeCommand<unknown>("vscode.executeDefinitionProvider", uri, position),
			vscode.commands.executeCommand<unknown>("vscode.executeImplementationProvider", uri, position),
			vscode.commands.executeCommand<unknown>("vscode.executeReferenceProvider", uri, position),
			vscode.commands.executeCommand<unknown>("vscode.prepareCallHierarchy", uri, position),
		]);
		const asValues = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);
		const hierarchyItem = asValues(hierarchyItems)[0];
		let incomingCalls: unknown[] = [];
		let outgoingCalls: unknown[] = [];
		if (hierarchyItem) {
			[incomingCalls, outgoingCalls] = await Promise.all([
				vscode.commands.executeCommand<unknown>("vscode.provideIncomingCalls", hierarchyItem).then(asValues),
				vscode.commands.executeCommand<unknown>("vscode.provideOutgoingCalls", hierarchyItem).then(asValues),
			]);
		}
		const definitionGroup = createRelationGroup(
			asValues(definitions),
			"definition",
			this.workspaceRoot,
			excludedLocations,
		);
		const occupiedLocations = new Set<string>([
			...excludedLocations.map((location) => getFlowLocationStartKey(location)),
			...definitionGroup.items.map((relation) => getFlowLocationStartKey(relation.location)),
		]);
		const implementationGroup = deduplicateRelationGroup(
			createRelationGroup(asValues(implementations), "implementation", this.workspaceRoot, excludedLocations),
			occupiedLocations,
		);
		const referenceGroup = deduplicateRelationGroup(
			createRelationGroup(asValues(references), "reference", this.workspaceRoot, excludedLocations),
			occupiedLocations,
		);
		return {
			anchor: symbol,
			incomingCalls: createCallGroup(incomingCalls, "incoming", this.workspaceRoot, uri),
			outgoingCalls: createCallGroup(outgoingCalls, "outgoing", this.workspaceRoot, uri),
			definitions: definitionGroup,
			implementations: implementationGroup,
			references: referenceGroup,
		};
	}

	private async resolveSymbolProviderPosition(symbol: FlowSymbolCandidate, uri: vscode.Uri): Promise<vscode.Position> {
		const document = await vscode.workspace.openTextDocument(uri);
		const firstLine = Math.max(0, Math.min(symbol.location.range.start.line, document.lineCount - 1));
		const lastLine = Math.max(firstLine, Math.min(symbol.location.range.end.line, document.lineCount - 1));
		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
			const lineText = document.lineAt(lineNumber).text;
			const lowerBound = lineNumber === firstLine ? symbol.location.range.start.character : 0;
			const upperBound = lineNumber === lastLine ? symbol.location.range.end.character : lineText.length;
			const nameIndex = lineText.indexOf(symbol.name, Math.min(lowerBound, lineText.length));
			if (nameIndex >= lowerBound && nameIndex + symbol.name.length <= Math.max(upperBound, lowerBound)) {
				return new vscode.Position(lineNumber, nameIndex);
			}
		}
		return document.validatePosition(
			new vscode.Position(
				firstLine,
				Math.min(symbol.location.range.start.character, document.lineAt(firstLine).text.length),
			),
		);
	}

	async openLocation(location: FlowLocation): Promise<void> {
		const uri = vscode.Uri.parse(location.uri, true);
		if (uri.scheme !== "file" || !isInsideWorkspace(uri.fsPath, this.workspaceRoot)) {
			throw new Error("Flow location is outside the connected workspace");
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const range = document.validateRange(toVscodeRange(location));
		const editor = await vscode.window.showTextDocument(document, {
			preview: true,
			preserveFocus: false,
			selection: range,
		});
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}
}
