import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const FLOW_BRIDGE_PROTOCOL_VERSION = 3;

export interface FlowPosition {
	line: number;
	character: number;
}

export interface FlowRange {
	start: FlowPosition;
	end: FlowPosition;
}

export interface FlowLocation {
	uri: string;
	range: FlowRange;
}

export interface FlowSymbolCandidate {
	name: string;
	qualifiedName: string;
	containerName?: string;
	kind: string;
	relativePath: string;
	location: FlowLocation;
}

export type FlowSymbolRelationType = "definition" | "implementation" | "reference";

export interface FlowSymbolRelation {
	type: FlowSymbolRelationType;
	relativePath: string;
	location: FlowLocation;
}

export interface FlowSymbolRelationGroup {
	items: FlowSymbolRelation[];
	total: number;
	truncated: boolean;
}

export interface FlowSymbolCall {
	node: FlowSymbolCandidate;
	evidence: FlowLocation[];
}

export interface FlowSymbolCallGroup {
	items: FlowSymbolCall[];
	total: number;
	truncated: boolean;
}

export interface FlowSymbolRelations {
	anchor: FlowSymbolCandidate;
	incomingCalls: FlowSymbolCallGroup;
	outgoingCalls: FlowSymbolCallGroup;
	definitions: FlowSymbolRelationGroup;
	implementations: FlowSymbolRelationGroup;
	references: FlowSymbolRelationGroup;
}

export interface FlowBridgeDiscovery {
	protocolVersion: number;
	workspaceRoot: string;
	socketPath: string;
	token: string;
	pid: number;
	createdAt: string;
}

export interface FlowBridgeHelloRequest {
	type: "hello";
	id: string;
	protocolVersion: number;
	token: string;
	workspaceRoot: string;
}

export interface FlowBridgeSearchSymbolsRequest {
	type: "request";
	id: string;
	method: "searchSymbols";
	params: {
		query: string;
	};
}

export interface FlowBridgePingRequest {
	type: "request";
	id: string;
	method: "ping";
	params: Record<string, never>;
}

export interface FlowBridgeOpenLocationRequest {
	type: "request";
	id: string;
	method: "openLocation";
	params: {
		location: FlowLocation;
	};
}

export interface FlowBridgeGetSymbolRelationsRequest {
	type: "request";
	id: string;
	method: "getSymbolRelations";
	params: {
		symbol: FlowSymbolCandidate;
	};
}

export type FlowBridgeRequest =
	| FlowBridgePingRequest
	| FlowBridgeSearchSymbolsRequest
	| FlowBridgeOpenLocationRequest
	| FlowBridgeGetSymbolRelationsRequest;
export type FlowBridgeClientMessage = FlowBridgeHelloRequest | FlowBridgeRequest;

export interface FlowBridgeHelloResponse {
	type: "hello_result";
	id: string;
	ok: boolean;
	protocolVersion: number;
	error?: string;
}

export interface FlowBridgeResponse {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export type FlowBridgeServerMessage = FlowBridgeHelloResponse | FlowBridgeResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isFlowPosition(value: unknown): value is FlowPosition {
	return isRecord(value) && isNonNegativeInteger(value.line) && isNonNegativeInteger(value.character);
}

export function isFlowRange(value: unknown): value is FlowRange {
	return isRecord(value) && isFlowPosition(value.start) && isFlowPosition(value.end);
}

export function isFlowLocation(value: unknown): value is FlowLocation {
	return isRecord(value) && typeof value.uri === "string" && isFlowRange(value.range);
}

export function isFlowSymbolCandidate(value: unknown): value is FlowSymbolCandidate {
	return (
		isRecord(value) &&
		typeof value.name === "string" &&
		typeof value.qualifiedName === "string" &&
		(value.containerName === undefined || typeof value.containerName === "string") &&
		typeof value.kind === "string" &&
		typeof value.relativePath === "string" &&
		isFlowLocation(value.location)
	);
}

function isFlowSymbolRelationType(value: unknown): value is FlowSymbolRelationType {
	return value === "definition" || value === "implementation" || value === "reference";
}

export function isFlowSymbolRelation(value: unknown): value is FlowSymbolRelation {
	return (
		isRecord(value) &&
		isFlowSymbolRelationType(value.type) &&
		typeof value.relativePath === "string" &&
		isFlowLocation(value.location)
	);
}

export function isFlowSymbolRelationGroup(value: unknown): value is FlowSymbolRelationGroup {
	return (
		isRecord(value) &&
		Array.isArray(value.items) &&
		value.items.every(isFlowSymbolRelation) &&
		isNonNegativeInteger(value.total) &&
		typeof value.truncated === "boolean" &&
		value.total >= value.items.length
	);
}

export function isFlowSymbolCall(value: unknown): value is FlowSymbolCall {
	return (
		isRecord(value) &&
		isFlowSymbolCandidate(value.node) &&
		Array.isArray(value.evidence) &&
		value.evidence.every(isFlowLocation)
	);
}

export function isFlowSymbolCallGroup(value: unknown): value is FlowSymbolCallGroup {
	return (
		isRecord(value) &&
		Array.isArray(value.items) &&
		value.items.every(isFlowSymbolCall) &&
		isNonNegativeInteger(value.total) &&
		typeof value.truncated === "boolean" &&
		value.total >= value.items.length
	);
}

export function isFlowSymbolRelations(value: unknown): value is FlowSymbolRelations {
	return (
		isRecord(value) &&
		isFlowSymbolCandidate(value.anchor) &&
		isFlowSymbolCallGroup(value.incomingCalls) &&
		isFlowSymbolCallGroup(value.outgoingCalls) &&
		isFlowSymbolRelationGroup(value.definitions) &&
		isFlowSymbolRelationGroup(value.implementations) &&
		isFlowSymbolRelationGroup(value.references)
	);
}

export function isFlowBridgeDiscovery(value: unknown): value is FlowBridgeDiscovery {
	return (
		isRecord(value) &&
		value.protocolVersion === FLOW_BRIDGE_PROTOCOL_VERSION &&
		typeof value.workspaceRoot === "string" &&
		typeof value.socketPath === "string" &&
		typeof value.token === "string" &&
		value.token.length >= 32 &&
		typeof value.pid === "number" &&
		typeof value.createdAt === "string"
	);
}

export function isFlowBridgeClientMessage(value: unknown): value is FlowBridgeClientMessage {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
		return false;
	}
	if (value.type === "hello") {
		return (
			typeof value.protocolVersion === "number" &&
			typeof value.token === "string" &&
			typeof value.workspaceRoot === "string"
		);
	}
	if (value.type !== "request" || typeof value.method !== "string" || !isRecord(value.params)) {
		return false;
	}
	if (value.method === "searchSymbols") {
		return typeof value.params.query === "string";
	}
	if (value.method === "ping") {
		return true;
	}
	if (value.method === "openLocation") {
		return isFlowLocation(value.params.location);
	}
	if (value.method === "getSymbolRelations") {
		return isFlowSymbolCandidate(value.params.symbol);
	}
	return false;
}

export function isFlowBridgeServerMessage(value: unknown): value is FlowBridgeServerMessage {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.ok !== "boolean") {
		return false;
	}
	if (value.type === "hello_result") {
		return (
			typeof value.protocolVersion === "number" && (value.error === undefined || typeof value.error === "string")
		);
	}
	if (value.type === "response") {
		return value.error === undefined || typeof value.error === "string";
	}
	return false;
}

export function encodeFlowBridgeMessage(message: FlowBridgeClientMessage | FlowBridgeServerMessage): string {
	return `${JSON.stringify(message)}\n`;
}

export function parseFlowBridgeMessage(line: string): unknown {
	return JSON.parse(line) as unknown;
}

export function normalizeFlowWorkspaceRoot(workspaceRoot: string): string {
	let normalized = resolve(workspaceRoot);
	while (normalized.length > 1 && /[\\/]$/.test(normalized)) {
		normalized = normalized.slice(0, -1);
	}
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getFlowBridgeWorkspaceKey(workspaceRoot: string): string {
	return createHash("sha256").update(normalizeFlowWorkspaceRoot(workspaceRoot)).digest("hex");
}

export function getFlowBridgeDiscoveryDirectory(): string {
	return join(tmpdir(), "asuka-pi-flow");
}

export function getFlowBridgeDiscoveryPath(workspaceRoot: string): string {
	return join(getFlowBridgeDiscoveryDirectory(), `${getFlowBridgeWorkspaceKey(workspaceRoot)}.json`);
}
