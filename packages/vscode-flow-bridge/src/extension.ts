import * as vscode from "vscode";
import { FlowBridgeServer } from "./bridge-server.ts";

class FlowBridgeController implements vscode.Disposable {
	private readonly output = vscode.window.createOutputChannel("asuka.pi Flow Bridge");
	private servers: FlowBridgeServer[] = [];

	async start(): Promise<void> {
		await this.restart();
	}

	async restart(): Promise<void> {
		await this.stopServers();
		const folders = vscode.workspace.workspaceFolders ?? [];
		for (const folder of folders) {
			if (folder.uri.scheme !== "file") continue;
			const server = new FlowBridgeServer(folder.uri.fsPath);
			try {
				await server.start();
				this.servers.push(server);
				this.output.appendLine(`Listening for ${server.root}`);
			} catch (error) {
				this.output.appendLine(
					`Failed to start for ${folder.uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
				);
				await server.dispose();
			}
		}
	}

	showStatus(): void {
		if (this.servers.length === 0) {
			void vscode.window.showWarningMessage("asuka.pi Flow Bridge is not serving a local workspace.");
			return;
		}
		void vscode.window.showInformationMessage(
			`asuka.pi Flow Bridge is serving ${this.servers.length} workspace${this.servers.length === 1 ? "" : "s"}.`,
		);
		this.output.show(true);
	}

	async dispose(): Promise<void> {
		await this.stopServers();
		this.output.dispose();
	}

	private async stopServers(): Promise<void> {
		const servers = this.servers;
		this.servers = [];
		await Promise.all(servers.map((server) => server.dispose()));
	}
}

let controller: FlowBridgeController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	controller = new FlowBridgeController();
	await controller.start();
	context.subscriptions.push(
		vscode.commands.registerCommand("asukaPi.flowBridgeStatus", () => controller?.showStatus()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void controller?.restart();
		}),
	);
}

export async function deactivate(): Promise<void> {
	await controller?.dispose();
	controller = undefined;
}
