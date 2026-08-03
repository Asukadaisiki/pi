import { existsSync, promises as fs, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP_NAME, getPackageDir, VERSION } from "./config.ts";
import { FlowBridgeClient } from "./core/flow/bridge-client.ts";
import { getFlowBridgeDiscoveryPath, isFlowBridgeDiscovery, normalizeFlowWorkspaceRoot } from "./core/flow/protocol.ts";
import { spawnProcessSync } from "./utils/child-process.ts";

const FLOW_BRIDGE_EXTENSION_ID = "asukadaisiki.asuka-pi-flow-bridge";
const FLOW_BRIDGE_VSIX_NAME = "asuka-pi-flow-bridge.vsix";

interface CommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

export interface FlowCommandRuntime {
	cwd: string;
	packageDir: string;
	fileExists(path: string): boolean;
	readTextFile(path: string): Promise<string>;
	runCommand(command: string, args: string[]): CommandResult;
	probeBridge(workspaceRoot: string): Promise<void>;
}

interface ParsedFlowCommand {
	command: "doctor" | "install" | "help";
	codeCommand?: string;
	error?: string;
}

function createDefaultRuntime(): FlowCommandRuntime {
	return {
		cwd: process.cwd(),
		packageDir: getPackageDir(),
		fileExists: existsSync,
		readTextFile: (path) => fs.readFile(path, "utf8"),
		runCommand: (command, args) => {
			const result = spawnProcessSync(command, args, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return {
				status: result.status,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? result.error?.message ?? "",
			};
		},
		probeBridge: async (workspaceRoot) => {
			const client = new FlowBridgeClient(workspaceRoot, { requestTimeoutMs: 2000 });
			await client.searchSymbols(`__asuka_pi_flow_doctor_${Date.now()}__`);
		},
	};
}

function parseFlowCommand(args: string[]): ParsedFlowCommand {
	const command = args[1];
	if (command === undefined || command === "help" || command === "--help" || command === "-h") {
		return { command: "help" };
	}
	if (command !== "install" && command !== "doctor") {
		return { command: "help", error: `Unknown flow command: ${command}` };
	}

	let codeCommand: string | undefined;
	for (let index = 2; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") return { command: "help" };
		if (arg === "--code") {
			const value = args[++index];
			if (!value) return { command, error: "--code requires a command or executable path" };
			codeCommand = value;
			continue;
		}
		return { command, error: `Unknown flow option: ${arg}` };
	}
	return { command, codeCommand };
}

function printFlowHelp(): void {
	console.log(`asuka.pi Flow Bridge

Usage:
  ${APP_NAME} flow install [--code <command>]
  ${APP_NAME} flow doctor  [--code <command>]

Commands:
  install   Install or update the bundled VS Code Flow Bridge extension
  doctor    Check the VS Code CLI, extension, workspace discovery, and bridge connection

Options:
  --code <command>   Use a specific VS Code CLI (for example code-insiders)`);
}

function canonicalizeWorkspaceRoot(workspaceRoot: string): string {
	const absoluteRoot = resolve(workspaceRoot);
	try {
		return normalizeFlowWorkspaceRoot(realpathSync.native(absoluteRoot));
	} catch {
		return normalizeFlowWorkspaceRoot(absoluteRoot);
	}
}

function findBundledVsix(runtime: FlowCommandRuntime): string | undefined {
	const candidates = [
		join(runtime.packageDir, "flow-bridge", FLOW_BRIDGE_VSIX_NAME),
		join(runtime.packageDir, "dist", "flow-bridge", FLOW_BRIDGE_VSIX_NAME),
	];
	return candidates.find((candidate) => runtime.fileExists(candidate));
}

function findInstalledExtensionVersion(output: string): string | undefined {
	const prefix = `${FLOW_BRIDGE_EXTENSION_ID}@`.toLowerCase();
	const entry = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.toLowerCase().startsWith(prefix));
	return entry?.slice(prefix.length);
}

function detectCodeCommand(
	runtime: FlowCommandRuntime,
	requestedCommand?: string,
): { command: string; version: string } | undefined {
	const envCommand = process.env.PI_FLOW_CODE_COMMAND?.trim();
	const candidates = requestedCommand
		? [requestedCommand]
		: [envCommand, "code", "code-insiders", "codium"].filter(
				(candidate): candidate is string => candidate !== undefined && candidate.length > 0,
			);
	for (const command of candidates) {
		const result = runtime.runCommand(command, ["--version"]);
		if (result.status !== 0) continue;
		return { command, version: result.stdout.trim().split(/\r?\n/, 1)[0] || "unknown" };
	}
	return undefined;
}

function printCheck(label: string, status: "ok" | "!!" | "--", detail: string): void {
	console.log(`[${status}] ${label.padEnd(14)} ${detail}`);
}

async function installFlowBridge(runtime: FlowCommandRuntime, codeCommand?: string): Promise<boolean> {
	const vsixPath = findBundledVsix(runtime);
	if (!vsixPath) {
		console.error("[!!] bundled-vsix   missing from this pi installation");
		console.error(`Run \`${APP_NAME} update self\` and retry, or rebuild the local package.`);
		return false;
	}

	const code = detectCodeCommand(runtime, codeCommand);
	if (!code) {
		console.error("[!!] vscode-cli      code, code-insiders, and codium were not found");
		console.error("Install the VS Code command-line launcher or pass --code <path>.");
		return false;
	}

	console.log(`Installing ${FLOW_BRIDGE_EXTENSION_ID}@${VERSION}`);
	printCheck("vscode-cli", "ok", `${code.command} ${code.version}`);
	printCheck("bundled-vsix", "ok", vsixPath);
	const installResult = runtime.runCommand(code.command, ["--install-extension", vsixPath, "--force"]);
	if (installResult.status !== 0) {
		printCheck(
			"extension",
			"!!",
			installResult.stderr.trim() || installResult.stdout.trim() || "installation failed",
		);
		return false;
	}

	const listResult = runtime.runCommand(code.command, ["--list-extensions", "--show-versions"]);
	const installedVersion = listResult.status === 0 ? findInstalledExtensionVersion(listResult.stdout) : undefined;
	if (!installedVersion) {
		printCheck("extension", "!!", "VS Code did not report the installed Flow Bridge");
		return false;
	}

	printCheck("extension", "ok", `${FLOW_BRIDGE_EXTENSION_ID}@${installedVersion}`);
	console.log("");
	console.log("Next:");
	console.log("  1. Reload the VS Code window that contains this workspace.");
	console.log(`  2. Run \`${APP_NAME} flow doctor\` from the workspace terminal.`);
	return true;
}

async function doctorFlowBridge(runtime: FlowCommandRuntime, codeCommand?: string): Promise<boolean> {
	const workspaceRoot = canonicalizeWorkspaceRoot(runtime.cwd);
	const discoveryPath = getFlowBridgeDiscoveryPath(workspaceRoot);
	let ready = true;

	console.log("asuka.pi flow doctor");
	console.log(`workspace: ${workspaceRoot}`);
	console.log("");

	const code = detectCodeCommand(runtime, codeCommand);
	if (code) {
		printCheck("vscode-cli", "ok", `${code.command} ${code.version}`);
	} else {
		printCheck("vscode-cli", "!!", "not found");
		ready = false;
	}

	const vsixPath = findBundledVsix(runtime);
	if (vsixPath) {
		printCheck("bundled-vsix", "ok", vsixPath);
	} else {
		printCheck("bundled-vsix", "!!", "missing from this pi installation");
		ready = false;
	}

	let installedVersion: string | undefined;
	if (code) {
		const listResult = runtime.runCommand(code.command, ["--list-extensions", "--show-versions"]);
		installedVersion = listResult.status === 0 ? findInstalledExtensionVersion(listResult.stdout) : undefined;
	}
	if (!installedVersion) {
		printCheck("extension", "!!", `${FLOW_BRIDGE_EXTENSION_ID} is not installed`);
		ready = false;
	} else if (installedVersion !== VERSION) {
		printCheck("extension", "!!", `${installedVersion} installed; ${VERSION} expected`);
		ready = false;
	} else {
		printCheck("extension", "ok", `${FLOW_BRIDGE_EXTENSION_ID}@${installedVersion}`);
	}

	let discoveryAvailable = false;
	if (!runtime.fileExists(discoveryPath)) {
		printCheck("discovery", "!!", "not found for this workspace");
		ready = false;
	} else {
		try {
			const value = JSON.parse(await runtime.readTextFile(discoveryPath)) as unknown;
			if (!isFlowBridgeDiscovery(value)) {
				printCheck("discovery", "!!", "invalid or incompatible data");
				ready = false;
			} else if (normalizeFlowWorkspaceRoot(value.workspaceRoot) !== workspaceRoot) {
				printCheck("discovery", "!!", `serves a different workspace: ${value.workspaceRoot}`);
				ready = false;
			} else {
				discoveryAvailable = true;
				printCheck("discovery", "ok", `VS Code process ${value.pid}`);
			}
		} catch (error) {
			printCheck("discovery", "!!", error instanceof Error ? error.message : String(error));
			ready = false;
		}
	}

	if (discoveryAvailable) {
		try {
			await runtime.probeBridge(workspaceRoot);
			printCheck("bridge", "ok", "authenticated local connection");
		} catch (error) {
			printCheck("bridge", "!!", error instanceof Error ? error.message : String(error));
			ready = false;
		}
	} else {
		printCheck("bridge", "--", "skipped until discovery is available");
	}

	console.log("");
	if (ready) {
		console.log("Flow Bridge is ready. Use /flow <symbol> in interactive mode.");
	} else if (!installedVersion) {
		console.log(`Action: run \`${APP_NAME} flow install\`, then reload VS Code.`);
	} else {
		console.log("Action: reload VS Code with this exact workspace open, then run the doctor again.");
	}
	return ready;
}

export async function handleFlowCommand(
	args: string[],
	runtimeOverrides: Partial<FlowCommandRuntime> = {},
): Promise<boolean> {
	if (args[0] !== "flow") return false;

	const parsed = parseFlowCommand(args);
	if (parsed.error) {
		console.error(`Error: ${parsed.error}`);
		printFlowHelp();
		process.exitCode = 1;
		return true;
	}
	if (parsed.command === "help") {
		printFlowHelp();
		return true;
	}

	const runtime = { ...createDefaultRuntime(), ...runtimeOverrides };
	const ok =
		parsed.command === "install"
			? await installFlowBridge(runtime, parsed.codeCommand)
			: await doctorFlowBridge(runtime, parsed.codeCommand);
	process.exitCode = ok ? 0 : 1;
	return true;
}
