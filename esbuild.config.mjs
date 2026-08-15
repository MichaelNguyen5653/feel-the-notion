import esbuild from "esbuild";
import process from "process";
import fs from "node:fs";
import path from "node:path";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

// A production build lands in the repo root, which is where Obsidian's own
// release workflow and its community-plugin tooling expect main.js to be — a
// build that only ever wrote into somebody's vault produced no release asset
// at all on CI.
//
// A dev build writes straight into the vault instead, so `npm run dev` + Cmd+R
// stays the whole edit loop. VAULT_PLUGIN_DIR overrides either.
const DEFAULT_VAULT_PLUGIN_DIR =
	"/Users/michael/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main-Vault/.obsidian/plugins/feel-the-notion";

const vaultDir = process.env.VAULT_PLUGIN_DIR ?? DEFAULT_VAULT_PLUGIN_DIR;
const outDir = prod ? "." : vaultDir;

fs.mkdirSync(outDir, { recursive: true });

// manifest.json and styles.css are not bundled — Obsidian reads them from the
// plugin folder directly, so they have to be copied on every build.
const copyAssets = (target) => {
	if (path.resolve(target) === path.resolve(".")) return;
	for (const file of ["manifest.json", "styles.css"]) {
		if (fs.existsSync(file)) {
			fs.copyFileSync(file, path.join(target, file));
		}
	}
};

// After a production build, mirror the result into the vault when one is there.
// Keeps the local loop working without making the build depend on a vault
// existing, which is what broke CI.
const mirrorToVault = () => {
	if (!fs.existsSync(vaultDir)) return null;
	fs.copyFileSync("main.js", path.join(vaultDir, "main.js"));
	copyAssets(vaultDir);
	return vaultDir;
};

const assetsPlugin = {
	name: "copy-assets",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			copyAssets(outDir);
			const mirrored = prod ? mirrorToVault() : null;
			console.log(`[feel-the-notion] → ${path.resolve(outDir)}`);
			if (mirrored) console.log(`[feel-the-notion] → ${mirrored}`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: path.join(outDir, "main.js"),
	plugins: [assetsPlugin],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
