// Compiles the pure, DOM-free modules under test to test/.build so the tests
// exercise shipped source rather than a copy.
//
// bundle:true is deliberate. With bundle:false, esbuild preserves relative
// import paths verbatim — `./dragRange` with no extension — which TypeScript
// accepts but Node's ESM loader rejects at runtime. Bundling makes each entry
// self-contained and sidesteps extension resolution entirely.
//
// @codemirror/* stays external so tests resolve the same single copy from
// node_modules that the harness uses. A second copy would break facet identity,
// exactly as it did with @codemirror/state and history().
import esbuild from "esbuild";

await esbuild.build({
	entryPoints: [
		"src/markerRanges.ts",
		"src/blockSelection.ts",
		"src/dragRange.ts",
		"src/planMove.ts",
	],
	outdir: "test/.build",
	format: "esm",
	bundle: true,
	external: ["@codemirror/*", "@lezer/*", "obsidian"],
	logLevel: "error",
});
