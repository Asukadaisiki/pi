import { randomUUID } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import {
	encodeFlowBridgeMessage,
	FLOW_BRIDGE_PROTOCOL_VERSION,
	type FlowBridgeDiscovery,
	type FlowBridgeRequest,
	type FlowBridgeResponse,
	type FlowLocation,
	type FlowSymbolCandidate,
	getFlowBridgeDiscoveryPath,
	isFlowBridgeDiscovery,
	isFlowBridgeServerMessage,
	isFlowSymbolCandidate,
	normalizeFlowWorkspaceRoot,
	parseFlowBridgeMessage,
} from "./protocol.ts";
import { rankFlowSymbolCandidates } from "./symbol-ranking.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export class FlowBridgeUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "FlowBridgeUnavailableError";
	}
}

function canonicalizeWorkspaceRoot(workspaceRoot: string): string {
	const absoluteRoot = resolve(workspaceRoot);
	try {
		return normalizeFlowWorkspaceRoot(realpathSync.native(absoluteRoot));
	} catch {
		return normalizeFlowWorkspaceRoot(absoluteRoot);
	}
}

function createAbortError(): Error {
	const error = new Error("Flow request cancelled");
	error.name = "AbortError";
	return error;
}

export class FlowBridgeClient {
	private readonly workspaceRoot: string;
	private readonly requestTimeoutMs: number;

	constructor(workspaceRoot: string, options: { requestTimeoutMs?: number } = {}) {
		this.workspaceRoot = canonicalizeWorkspaceRoot(workspaceRoot);
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}

	async searchSymbols(query: string, signal?: AbortSignal): Promise<FlowSymbolCandidate[]> {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return [];
		const response = await this.sendRequest(
			{
				type: "request",
				id: randomUUID(),
				method: "searchSymbols",
				params: { query: trimmedQuery },
			},
			signal,
		);
		if (!Array.isArray(response.result) || !response.result.every(isFlowSymbolCandidate)) {
			throw new Error("Flow bridge returned an invalid symbol list");
		}
		return rankFlowSymbolCandidates(response.result, trimmedQuery);
	}

	async openLocation(location: FlowLocation, signal?: AbortSignal): Promise<void> {
		const response = await this.sendRequest(
			{
				type: "request",
				id: randomUUID(),
				method: "openLocation",
				params: { location },
			},
			signal,
		);
		if (
			typeof response.result !== "object" ||
			response.result === null ||
			!("opened" in response.result) ||
			response.result.opened !== true
		) {
			throw new Error("Flow bridge did not confirm source navigation");
		}
	}

	private async readDiscovery(): Promise<FlowBridgeDiscovery> {
		const discoveryPath = getFlowBridgeDiscoveryPath(this.workspaceRoot);
		let contents: string;
		try {
			contents = await fs.readFile(discoveryPath, "utf8");
		} catch (error) {
			throw new FlowBridgeUnavailableError(
				"VS Code Flow bridge is not available for this workspace. Install or enable the asuka.pi Flow Bridge extension, then open the same workspace in VS Code.",
				{ cause: error },
			);
		}

		let value: unknown;
		try {
			value = JSON.parse(contents) as unknown;
		} catch (error) {
			throw new FlowBridgeUnavailableError("VS Code Flow bridge discovery data is invalid", { cause: error });
		}
		if (!isFlowBridgeDiscovery(value)) {
			throw new FlowBridgeUnavailableError("VS Code Flow bridge discovery data is incompatible");
		}
		if (normalizeFlowWorkspaceRoot(value.workspaceRoot) !== this.workspaceRoot) {
			throw new FlowBridgeUnavailableError("VS Code Flow bridge is connected to a different workspace");
		}
		return value;
	}

	private async sendRequest(request: FlowBridgeRequest, signal?: AbortSignal): Promise<FlowBridgeResponse> {
		if (signal?.aborted) throw createAbortError();
		const discovery = await this.readDiscovery();

		return new Promise<FlowBridgeResponse>((resolveResponse, rejectResponse) => {
			let socket: Socket | undefined;
			let buffer = "";
			let handshakeComplete = false;
			let settled = false;
			const timeout = setTimeout(() => {
				finish(new FlowBridgeUnavailableError("VS Code Flow bridge request timed out"));
			}, this.requestTimeoutMs);

			const onAbort = () => finish(createAbortError());
			const cleanup = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
				socket?.removeAllListeners();
				socket?.destroy();
			};
			const finish = (error?: Error, response?: FlowBridgeResponse) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) rejectResponse(error);
				else if (response) resolveResponse(response);
				else rejectResponse(new Error("Flow bridge request ended without a response"));
			};
			const handleLine = (line: string) => {
				let value: unknown;
				try {
					value = parseFlowBridgeMessage(line);
				} catch (error) {
					finish(new Error("VS Code Flow bridge returned invalid JSON", { cause: error }));
					return;
				}
				if (!isFlowBridgeServerMessage(value)) {
					finish(new Error("VS Code Flow bridge returned an invalid response"));
					return;
				}
				if (!handshakeComplete) {
					if (value.type !== "hello_result" || value.id !== request.id) {
						finish(new Error("VS Code Flow bridge handshake response did not match the request"));
						return;
					}
					if (!value.ok || value.protocolVersion !== FLOW_BRIDGE_PROTOCOL_VERSION) {
						finish(new FlowBridgeUnavailableError(value.error ?? "VS Code Flow bridge handshake failed"));
						return;
					}
					handshakeComplete = true;
					socket?.write(encodeFlowBridgeMessage(request));
					return;
				}
				if (value.type !== "response" || value.id !== request.id) {
					finish(new Error("VS Code Flow bridge response did not match the request"));
					return;
				}
				if (!value.ok) {
					finish(new Error(value.error ?? "VS Code Flow bridge request failed"));
					return;
				}
				finish(undefined, value);
			};

			signal?.addEventListener("abort", onAbort, { once: true });
			socket = createConnection(discovery.socketPath);
			socket.on("connect", () => {
				socket?.write(
					encodeFlowBridgeMessage({
						type: "hello",
						id: request.id,
						protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
						token: discovery.token,
						workspaceRoot: this.workspaceRoot,
					}),
				);
			});
			socket.on("data", (chunk: Buffer | string) => {
				buffer += chunk.toString();
				if (Buffer.byteLength(buffer) > MAX_RESPONSE_BYTES) {
					finish(new Error("VS Code Flow bridge response exceeded the size limit"));
					return;
				}
				for (;;) {
					const newlineIndex = buffer.indexOf("\n");
					if (newlineIndex === -1) return;
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);
					if (line) handleLine(line);
					if (settled) return;
				}
			});
			socket.on("error", (error) => {
				finish(
					new FlowBridgeUnavailableError(`Could not connect to the VS Code Flow bridge: ${error.message}`, {
						cause: error,
					}),
				);
			});
			socket.on("close", () => {
				if (!settled) finish(new FlowBridgeUnavailableError("VS Code Flow bridge closed the connection"));
			});
		});
	}
}
