import esbuild from "esbuild";
import process from "process";
import fs from "node:fs";
import path from "node:path";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

// Build straight into the live vault so `npm run dev` + Cmd+R is the whole
// edit loop. Override with VAULT_PLUGIN_DIR to build elsewhere.
const DEFAULT_VAULT_PLUGIN_DIR =
	"/Users/michael/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main-Vault/.obsidian/plugins/feel-the-notion";

const outDir = process.env.VAULT_PLUGIN_DIR ?? DEFAULT_VAULT_PLUGIN_DIR;

fs.mkdirSync(outDir, { recursive: true });

// manifest.json and styles.css are not bundled — Obsidian reads them from the
// plugin folder directly, so they have to be copied on every build.
const copyAssets = () => {
	for (const file of ["manifest.json", "styles.css"]) {
		if (fs.existsSync(file)) {
			fs.copyFileSync(file, path.join(outDir, file));
		}
	}
};

const assetsPlugin = {
	name: "copy-assets",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length === 0) {
				copyAssets();
				console.log(`[feel-the-notion] → ${outDir}`);
			}
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
