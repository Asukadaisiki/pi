import { randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join, resolve } from "node:path";
import type {
	FlowBridgeDiscovery,
	FlowBridgeHelloRequest,
	FlowBridgeRequest,
	FlowBridgeResponse,
} from "asuka.pi/flow-protocol";
import {
	encodeFlowBridgeMessage,
	FLOW_BRIDGE_PROTOCOL_VERSION,
	getFlowBridgeDiscoveryDirectory,
	getFlowBridgeDiscoveryPath,
	getFlowBridgeWorkspaceKey,
	isFlowBridgeClientMessage,
	isFlowBridgeDiscovery,
	normalizeFlowWorkspaceRoot,
	parseFlowBridgeMessage,
} from "asuka.pi/flow-protocol";
import { FlowSemanticService } from "./semantic-service.ts";

const MAX_REQUEST_BYTES = 1024 * 1024;

function canonicalizeWorkspaceRoot(workspaceRoot: string): string {
	const absoluteRoot = resolve(workspaceRoot);
	try {
		return normalizeFlowWorkspaceRoot(realpathSync.native(absoluteRoot));
	} catch {
		return normalizeFlowWorkspaceRoot(absoluteRoot);
	}
}

export class FlowBridgeServer {
	private readonly workspaceRoot: string;
	private readonly token = randomBytes(32).toString("hex");
	private readonly socketPath: string;
	private readonly discoveryPath: string;
	private readonly semanticService: FlowSemanticService;
	private readonly sockets = new Set<Socket>();
	private server: Server | undefined;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = canonicalizeWorkspaceRoot(workspaceRoot);
		const suffix = `${process.pid}-${this.token.slice(0, 12)}`;
		this.socketPath =
			process.platform === "win32"
				? `\\\\.\\pipe\\asuka-pi-flow-${getFlowBridgeWorkspaceKey(this.workspaceRoot).slice(0, 16)}-${suffix}`
				: join(getFlowBridgeDiscoveryDirectory(), `bridge-${suffix}.sock`);
		this.discoveryPath = getFlowBridgeDiscoveryPath(this.workspaceRoot);
		this.semanticService = new FlowSemanticService(this.workspaceRoot);
	}

	get root(): string {
		return this.workspaceRoot;
	}

	async start(): Promise<void> {
		await fs.mkdir(getFlowBridgeDiscoveryDirectory(), { recursive: true, mode: 0o700 });
		this.server = createServer((socket) => this.accept(socket));
		await new Promise<void>((resolveStart, rejectStart) => {
			const server = this.server;
			if (!server) {
				rejectStart(new Error("Flow bridge server was not created"));
				return;
			}
			server.once("error", rejectStart);
			server.listen(this.socketPath, () => {
				server.off("error", rejectStart);
				resolveStart();
			});
		});

		const discovery: FlowBridgeDiscovery = {
			protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
			workspaceRoot: this.workspaceRoot,
			socketPath: this.socketPath,
			token: this.token,
			pid: process.pid,
			createdAt: new Date().toISOString(),
		};
		const temporaryPath = `${this.discoveryPath}.${process.pid}.${this.token.slice(0, 8)}.tmp`;
		await fs.writeFile(temporaryPath, `${JSON.stringify(discovery)}\n`, { encoding: "utf8", mode: 0o600 });
		await fs.rename(temporaryPath, this.discoveryPath);
	}

	async dispose(): Promise<void> {
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		if (this.server) {
			await new Promise<void>((resolveClose) => this.server?.close(() => resolveClose()));
			this.server = undefined;
		}
		if (process.platform !== "win32") {
			await fs.unlink(this.socketPath).catch(() => undefined);
		}
		await this.removeOwnedDiscovery();
	}

	private async removeOwnedDiscovery(): Promise<void> {
		try {
			const value = JSON.parse(await fs.readFile(this.discoveryPath, "utf8")) as unknown;
			if (isFlowBridgeDiscovery(value) && value.token === this.token) {
				await fs.unlink(this.discoveryPath);
			}
		} catch {
			// Discovery may already have been replaced or removed.
		}
	}

	private accept(socket: Socket): void {
		this.sockets.add(socket);
		let buffer = "";
		let authenticated = false;
		let requestQueue = Promise.resolve();
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
				socket.destroy(new Error("Flow bridge request exceeded the size limit"));
				return;
			}
			for (;;) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) break;
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) continue;
				requestQueue = requestQueue
					.then(async () => {
						const value = parseFlowBridgeMessage(line);
						if (!isFlowBridgeClientMessage(value)) throw new Error("Invalid Flow bridge request");
						if (!authenticated) {
							if (value.type !== "hello") throw new Error("Flow bridge handshake required");
							authenticated = this.authenticate(value);
							socket.write(
								encodeFlowBridgeMessage({
									type: "hello_result",
									id: value.id,
									ok: authenticated,
									protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
									...(!authenticated && { error: "Flow bridge authentication failed" }),
								}),
							);
							if (!authenticated) socket.end();
							return;
						}
						if (value.type !== "request") throw new Error("Unexpected Flow bridge handshake");
						const response = await this.handleRequest(value);
						socket.write(encodeFlowBridgeMessage(response));
					})
					.catch((error: unknown) => {
						const response: FlowBridgeResponse = {
							type: "response",
							id: "invalid",
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						};
						socket.end(encodeFlowBridgeMessage(response));
					});
			}
		});
		socket.once("close", () => this.sockets.delete(socket));
		socket.once("error", () => this.sockets.delete(socket));
	}

	private authenticate(request: FlowBridgeHelloRequest): boolean {
		return (
			request.protocolVersion === FLOW_BRIDGE_PROTOCOL_VERSION &&
			request.token === this.token &&
			normalizeFlowWorkspaceRoot(request.workspaceRoot) === this.workspaceRoot
		);
	}

	private async handleRequest(request: FlowBridgeRequest): Promise<FlowBridgeResponse> {
		try {
			if (request.method === "searchSymbols") {
				const result = await this.semanticService.searchSymbols(request.params.query);
				return { type: "response", id: request.id, ok: true, result };
			}
			await this.semanticService.openLocation(request.params.location);
			return { type: "response", id: request.id, ok: true, result: { opened: true } };
		} catch (error) {
			return {
				type: "response",
				id: request.id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
}
