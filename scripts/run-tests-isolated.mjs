#!/usr/bin/env node

import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const tempParent = realpathSync(tmpdir());
const testRoot = mkdtempSync(join(tempParent, "pi-test-"));
const markerPath = join(testRoot, ".pi-test-owned");

function createEmptyFile(path) {
	closeSync(openSync(path, "w"));
}

function cleanup() {
	const relativePath = relative(tempParent, resolve(testRoot));
	const owned =
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath) &&
		existsSync(markerPath) &&
		!lstatSync(testRoot).isSymbolicLink();
	if (!owned) {
		throw new Error(`Refusing to remove unverified test directory: ${testRoot}`);
	}
	rmSync(testRoot, { force: true, recursive: true });
}

mkdirSync(join(testRoot, "home", ".config"), { recursive: true });
mkdirSync(join(testRoot, "tmp"), { recursive: true });
mkdirSync(join(testRoot, "cache", "npm"), { recursive: true });
createEmptyFile(markerPath);
createEmptyFile(join(testRoot, "npm-userconfig"));
createEmptyFile(join(testRoot, "npm-globalconfig"));

const gitAskpass = join(testRoot, process.platform === "win32" ? "git-askpass.cmd" : "git-askpass.sh");
writeFileSync(gitAskpass, process.platform === "win32" ? "@exit /b 1\r\n" : "#!/bin/sh\nexit 1\n");

const env = {
	PATH: process.env.PATH ?? "",
	PWD: process.cwd(),
	HOME: join(testRoot, "home"),
	USERPROFILE: join(testRoot, "home"),
	TMPDIR: join(testRoot, "tmp"),
	TMP: join(testRoot, "tmp"),
	TEMP: join(testRoot, "tmp"),
	XDG_CONFIG_HOME: join(testRoot, "home", ".config"),
	XDG_CACHE_HOME: join(testRoot, "cache"),
	LANG: "C",
	LC_ALL: "C",
	TZ: "UTC",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
	GIT_ASKPASS: gitAskpass,
	GIT_EDITOR: "true",
	GIT_SEQUENCE_EDITOR: "true",
	NPM_CONFIG_USERCONFIG: join(testRoot, "npm-userconfig"),
	NPM_CONFIG_GLOBALCONFIG: join(testRoot, "npm-globalconfig"),
	NPM_CONFIG_CACHE: join(testRoot, "cache", "npm"),
	PI_NO_LOCAL_LLM: "1",
	AWS_EC2_METADATA_DISABLED: "true",
};

for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "CI", "GITHUB_ACTIONS"]) {
	const value = process.env[name];
	if (value) env[name] = value;
}

console.log(`Running tests without API keys in isolated home: ${env.HOME}`);
let exitCode = 1;
try {
	const result = spawnSync("npm", ["test"], {
		env,
		stdio: "inherit",
		shell: process.platform === "win32",
	});
	if (result.error) throw result.error;
	exitCode = result.status ?? 1;
} finally {
	cleanup();
}

process.exitCode = exitCode;
