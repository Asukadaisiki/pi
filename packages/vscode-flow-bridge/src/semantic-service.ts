import * as path from "node:path";
import type { FlowLocation, FlowSymbolCandidate } from "asuka.pi/flow-protocol";
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

function toFlowLocation(location: vscode.Location): FlowLocation {
	return {
		uri: location.uri.toString(true),
		range: {
			start: { line: location.range.start.line, character: location.range.start.character },
			end: { line: location.range.end.line, character: location.range.end.character },
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

export class FlowSemanticService {
	private readonly workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	async searchSymbols(query: string): Promise<FlowSymbolCandidate[]> {
		const symbols =
			(await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
				"vscode.executeWorkspaceSymbolProvider",
				query,
			)) ?? [];
		const candidates: FlowSymbolCandidate[] = [];
		for (const symbol of symbols) {
			if (symbol.location.uri.scheme !== "file") continue;
			if (!isInsideWorkspace(symbol.location.uri.fsPath, this.workspaceRoot)) continue;
			const relativePath = path.relative(this.workspaceRoot, symbol.location.uri.fsPath).replace(/\\/g, "/");
			if (!relativePath || isExcludedRelativePath(relativePath)) continue;
			const containerName = symbol.containerName?.trim() || undefined;
			candidates.push({
				name: symbol.name,
				qualifiedName: containerName ? `${containerName}.${symbol.name}` : symbol.name,
				...(containerName && { containerName }),
				kind: getSymbolKindName(symbol.kind),
				relativePath,
				location: toFlowLocation(symbol.location),
			});
		}
		return candidates;
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
