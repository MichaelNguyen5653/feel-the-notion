// Compiles the pure, DOM-free modules under test to test/.build so the tests
// exercise shipped source instead of a copy.
import esbuild from "esbuild";
await esbuild.build({
	entryPoints: ["src/markerRanges.ts", "src/blockSelection.ts", "src/dragRange.ts"],
	outdir: "test/.build",
	format: "esm",
	bundle: false,
	logLevel: "error",
});
