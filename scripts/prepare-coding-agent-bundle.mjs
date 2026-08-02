#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const codingAgentDir = join(repoRoot, "packages", "coding-agent");
const shrinkwrapPath = join(codingAgentDir, "npm-shrinkwrap.json");

const bundledPackages = [
	{ name: "@earendil-works/pi-agent-core", directory: "agent" },
	{ name: "@earendil-works/pi-ai", directory: "ai" },
	{ name: "@earendil-works/pi-tui", directory: "tui" },
];
const bundledPackageNames = new Set(bundledPackages.map((pkg) => pkg.name));

function copyRequired(source, target) {
	if (!existsSync(source)) {
		throw new Error(`Required bundle path does not exist: ${source}`);
	}
	cpSync(source, target, { recursive: true, force: true });
}

for (const bundledPackage of bundledPackages) {
	const sourceDir = join(repoRoot, "packages", bundledPackage.directory);
	const packageJsonPath = join(sourceDir, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (packageJson.name !== bundledPackage.name) {
		throw new Error(`Expected ${packageJsonPath} to declare ${bundledPackage.name}, found ${packageJson.name}`);
	}

	const targetDir = join(codingAgentDir, "node_modules", ...bundledPackage.name.split("/"));
	rmSync(targetDir, { force: true, recursive: true });
	mkdirSync(targetDir, { recursive: true });
	copyRequired(packageJsonPath, join(targetDir, "package.json"));
	copyRequired(join(sourceDir, "dist"), join(targetDir, "dist"));

	for (const optionalPath of ["README.md", "native"]) {
		const source = join(sourceDir, optionalPath);
		if (existsSync(source)) {
			copyRequired(source, join(targetDir, optionalPath));
		}
	}

	console.log(`Prepared ${bundledPackage.name}@${packageJson.version}`);
}

const shrinkwrap = JSON.parse(readFileSync(shrinkwrapPath, "utf8"));
for (const lockPath of Object.keys(shrinkwrap.packages)) {
	if (!lockPath.startsWith("node_modules/")) continue;
	const parts = lockPath.slice("node_modules/".length).split("/");
	const packageName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
	if (bundledPackageNames.has(packageName)) continue;

	const source = join(repoRoot, lockPath);
	if (!existsSync(source)) continue;
	const target = join(codingAgentDir, lockPath);
	rmSync(target, { force: true, recursive: true });
	mkdirSync(dirname(target), { recursive: true });
	copyRequired(source, target);
}

console.log("Prepared external runtime dependencies.");
