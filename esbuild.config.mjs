import esbuild from "esbuild";
import process from "process";
import { execSync } from "child_process";

const prod = process.argv[2] === "production";

function getCommitHash() {
	try {
		return execSync("jj log -r @ --no-graph -T 'commit_id.short(8)'", { encoding: "utf8" }).trim();
	} catch {
		try {
			return execSync("git rev-parse --short=8 HEAD", { encoding: "utf8" }).trim();
		} catch {
			return "unknown";
		}
	}
}

const context = await esbuild.context({
	entryPoints: ["main.ts"],
	bundle: true,
	external: ["obsidian", "electron"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	platform: "node",
	define: {
		BUILD_COMMIT: JSON.stringify(getCommitHash()),
	},
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
