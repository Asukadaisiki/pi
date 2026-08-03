import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FLOW_BRIDGE_PROTOCOL_VERSION,
	getFlowBridgeDiscoveryPath,
	normalizeFlowWorkspaceRoot,
} from "../src/core/flow/protocol.ts";
import { type FlowCommandRuntime, handleFlowCommand } from "../src/flow-cli.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
	process.exitCode = undefined;
	vi.restoreAllMocks();
	await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function createRuntime(options: { extensionVersion?: string; discovery?: boolean } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "asuka-flow-cli-"));
	cleanupPaths.push(cwd);
	const workspaceRoot = normalizeFlowWorkspaceRoot(realpathSync.native(cwd));
	const discoveryPath = getFlowBridgeDiscoveryPath(workspaceRoot);
	const commands: Array<{ command: string; args: string[] }> = [];
	const runtime: Partial<FlowCommandRuntime> = {
		cwd,
		packageDir: cwd,
		fileExists: (path) =>
			path.endsWith("asuka-pi-flow-bridge.vsix") || (options.discovery === true && path === discoveryPath),
		readTextFile: async () =>
			JSON.stringify({
				protocolVersion: FLOW_BRIDGE_PROTOCOL_VERSION,
				workspaceRoot,
				socketPath: "test-pipe",
				token: "a".repeat(64),
				pid: 1234,
				createdAt: "2026-08-03T00:00:00.000Z",
			}),
		runCommand: (command, args) => {
			commands.push({ command, args });
			if (args[0] === "--version") return { status: 0, stdout: "1.131.0\ncommit\nx64\n", stderr: "" };
			if (args[0] === "--list-extensions") {
				const extension = options.extensionVersion
					? `asukadaisiki.asuka-pi-flow-bridge@${options.extensionVersion}\n`
					: "";
				return { status: 0, stdout: extension, stderr: "" };
			}
			return { status: 0, stdout: "installed\n", stderr: "" };
		},
		probeBridge: async () => undefined,
	};
	return { commands, runtime };
}

describe("flow CLI", () => {
	it("ignores non-flow commands", async () => {
		await expect(handleFlowCommand(["--version"])).resolves.toBe(false);
	});

	it("installs the bundled VSIX through the detected VS Code CLI", async () => {
		const { commands, runtime } = await createRuntime({ extensionVersion: "0.0.3" });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await expect(handleFlowCommand(["flow", "install"], runtime)).resolves.toBe(true);

		expect(process.exitCode).toBe(0);
		expect(commands).toContainEqual({
			command: "code",
			args: ["--install-extension", expect.stringMatching(/asuka-pi-flow-bridge\.vsix$/), "--force"],
		});
		expect(log).toHaveBeenCalledWith(expect.stringContaining("Reload the VS Code window"));
	});

	it("reports a ready bridge only after extension, discovery, and connection checks pass", async () => {
		const { runtime } = await createRuntime({ discovery: true, extensionVersion: "0.0.3" });
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await expect(handleFlowCommand(["flow", "doctor"], runtime)).resolves.toBe(true);

		expect(process.exitCode).toBe(0);
		expect(log).toHaveBeenCalledWith("[ok] bridge         authenticated local connection");
		expect(log).toHaveBeenCalledWith("Flow Bridge is ready. Use /flow <symbol> in interactive mode.");
	});

	it("points an unconfigured workspace to the installer", async () => {
		const { runtime } = await createRuntime();
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await expect(handleFlowCommand(["flow", "doctor"], runtime)).resolves.toBe(true);

		expect(process.exitCode).toBe(1);
		expect(log).toHaveBeenCalledWith("[!!] extension      asukadaisiki.asuka-pi-flow-bridge is not installed");
		expect(log).toHaveBeenCalledWith("Action: run `pi flow install`, then reload VS Code.");
	});
});
