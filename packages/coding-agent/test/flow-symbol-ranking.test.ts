import { describe, expect, it } from "vitest";
import type { FlowSymbolCandidate } from "../src/core/flow/protocol.ts";
import { rankFlowSymbolCandidates } from "../src/core/flow/symbol-ranking.ts";

function candidate(name: string, relativePath: string, line: number, containerName?: string): FlowSymbolCandidate {
	return {
		name,
		qualifiedName: containerName ? `${containerName}.${name}` : name,
		...(containerName && { containerName }),
		kind: "function",
		relativePath,
		location: {
			uri: `file:///workspace/${relativePath}`,
			range: {
				start: { line, character: 0 },
				end: { line, character: name.length },
			},
		},
	};
}

describe("rankFlowSymbolCandidates", () => {
	it("orders exact, prefix, fuzzy, and path matches deterministically", () => {
		const results = rankFlowSymbolCandidates(
			[
				candidate("unrelated", "src/create-agent-session-helper.ts", 1),
				candidate("createAgentSessionRuntime", "src/runtime.ts", 2),
				candidate("createAgentNewSession", "src/fuzzy.ts", 3),
				candidate("createAgentSession", "src/sdk.ts", 4),
			],
			"createAgentSession",
		);

		expect(results.map((result) => result.name)).toEqual([
			"createAgentSession",
			"createAgentSessionRuntime",
			"createAgentNewSession",
			"unrelated",
		]);
	});

	it("prefers source symbols over tests when match quality is equal", () => {
		const results = rankFlowSymbolCandidates(
			[
				candidate("refreshTools", "test/refresh-tools.test.ts", 2),
				candidate("refreshTools", "src/refresh-tools.ts", 8),
			],
			"refreshTools",
		);

		expect(results.map((result) => result.relativePath)).toEqual([
			"src/refresh-tools.ts",
			"test/refresh-tools.test.ts",
		]);
	});

	it("deduplicates identical provider results", () => {
		const duplicate = candidate("createAgentSession", "src/sdk.ts", 4);
		expect(rankFlowSymbolCandidates([duplicate, duplicate], "createAgentSession")).toEqual([duplicate]);
	});
});
