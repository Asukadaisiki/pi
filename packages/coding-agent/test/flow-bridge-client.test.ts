import { randomUUID } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FlowBridgeClient } from "../src/core/flow/bridge-client.ts";
import {
	encodeFlowBridgeMessage,
	FLOW_BRIDGE_PROTOCOL_VERSION,
	type FlowBridgeDiscovery,
	type FlowSymbolCandidate,
	getFlowBridgeDiscoveryDirectory,
	getFlowBridgeDiscoveryPath,
	normalizeFlowWorkspaceRoot,
} from "../src/core/flow/protocol.ts";

const cleanupPaths: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolveClose) => {
					server.close(() => resolveClose());
				}),
		),
	);
	await Promise.all(cleanupPaths.splice(0).map((cleanupPath) => fs.rm(cleanupPath, { force: true, recursive: true })));
});

function startFakeBridge(
	socketPath: string,
	token: string,
	candidates: FlowSymbolCandidate[],
	methods: string[],
): Promise<Server> {
	const server = createServer((socket: Socket) => {
		let buffer = "";
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			for (;;) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) return;
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (!line) continue;
				const message = JSON.parse(line) as Record<string, unknown>;
				const id = typeof message.id === "string" ? message.id : "invalid";
				const params = message.params;
				const relationSymbol =
					typeof params === "object" && params !== null && "symbol" in params
						? (params as { symbol: FlowSymbolCandidate }).symbol
						: candidates[0];
				if (message.type === "hello") {
					socket.write(
						encodeFlowBridgeMessage({
							type: "hello_result",
							id,
							ok: message.token === token,
							protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
						}),
					);
					continue;
				}
				const method = typeof message.method === "string" ? message.method : "invalid";
				methods.push(method);
				socket.end(
					encodeFlowBridgeMessage({
						type: "response",
						id,
						ok: true,
						result:
							method === "ping"
								? { ready: true }
								: method === "searchSymbols"
									? candidates
									: method === "getSymbolRelations"
										? {
												anchor: relationSymbol,
												incomingCalls: {
													items: [{ node: relationSymbol, evidence: [relationSymbol.location] }],
													total: 1,
													truncated: false,
												},
												outgoingCalls: {
													items: [{ node: relationSymbol, evidence: [relationSymbol.location] }],
													total: 1,
													truncated: false,
												},
												definitions: { items: [], total: 0, truncated: false },
												implementations: { items: [], total: 0, truncated: false },
												references: { items: [], total: 0, truncated: false },
											}
										: { opened: true },
					}),
				);
			}
		});
	});
	servers.push(server);
	return new Promise((resolveStart, rejectStart) => {
		server.once("error", rejectStart);
		server.listen(socketPath, () => {
			server.off("error", rejectStart);
			resolveStart(server);
		});
	});
}

describe("FlowBridgeClient", () => {
	it("handshakes, ranks symbols, and opens the selected source location", async () => {
		const workspaceRoot = await fs.mkdtemp(join(tmpdir(), "asuka-flow-client-"));
		cleanupPaths.push(workspaceRoot);
		const canonicalRoot = normalizeFlowWorkspaceRoot(realpathSync.native(workspaceRoot));
		const token = randomUUID().replace(/-/g, "").repeat(2);
		const socketPath =
			process.platform === "win32"
				? `\\\\.\\pipe\\asuka-flow-test-${randomUUID()}`
				: join(workspaceRoot, "bridge.sock");
		const candidates: FlowSymbolCandidate[] = [
			{
				name: "createAgentSessionRuntime",
				qualifiedName: "createAgentSessionRuntime",
				kind: "function",
				relativePath: "src/runtime.ts",
				location: {
					uri: "file:///workspace/src/runtime.ts",
					range: { start: { line: 9, character: 0 }, end: { line: 9, character: 25 } },
				},
			},
			{
				name: "createAgentSession",
				qualifiedName: "createAgentSession",
				kind: "function",
				relativePath: "src/sdk.ts",
				location: {
					uri: "file:///workspace/src/sdk.ts",
					range: { start: { line: 3, character: 0 }, end: { line: 3, character: 18 } },
				},
			},
		];
		const methods: string[] = [];
		await startFakeBridge(socketPath, token, candidates, methods);
		await fs.mkdir(getFlowBridgeDiscoveryDirectory(), { recursive: true });
		const discoveryPath = getFlowBridgeDiscoveryPath(canonicalRoot);
		cleanupPaths.push(discoveryPath);
		const discovery: FlowBridgeDiscovery = {
			protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
			workspaceRoot: canonicalRoot,
			socketPath,
			token,
			pid: process.pid,
			createdAt: new Date().toISOString(),
		};
		await fs.writeFile(discoveryPath, JSON.stringify(discovery), "utf8");

		const client = new FlowBridgeClient(workspaceRoot, { requestTimeoutMs: 2000 });
		await client.ping();
		const results = await client.searchSymbols("createAgentSession");
		expect(results.map((result) => result.name)).toEqual(["createAgentSession", "createAgentSessionRuntime"]);

		await client.openLocation(results[0]!.location);
		const relations = await client.getSymbolRelations(results[0]!);
		expect(relations.anchor.name).toBe("createAgentSession");
		expect(relations.incomingCalls.total).toBe(1);
		expect(relations.outgoingCalls.items[0]?.evidence[0]?.range.start.line).toBe(3);
		expect(methods).toEqual(["ping", "searchSymbols", "openLocation", "getSymbolRelations"]);
	});
});
