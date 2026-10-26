import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MarkdownTransformContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { Markdown, setCapabilityOverrides } from "@earendil-works/pi-tui";
import extension from "../extensions/file-links.ts";

type Handler = (event: unknown, ctx: { cwd: string }) => void;

function load() {
	let transformer: MarkdownTransformer | undefined;
	const handlers = new Map<string, Handler>();
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerMarkdownTransformer: (fn: MarkdownTransformer) => {
			transformer = fn;
		},
	};
	extension(pi as never);
	assert.ok(transformer, "transformer registered");
	return { transform: transformer, startSession: (cwd: string) => handlers.get("session_start")?.({}, { cwd }) };
}

const context = (messageType: MarkdownTransformContext["messageType"]): MarkdownTransformContext => ({
	messageType,
	isStreaming: false,
	availableWidth: 120,
});

function osc8Targets(markdown: string, transform: (markdown: string) => string): string[] {
	const theme = new Proxy({}, { get: () => (text: string) => text });
	const lines = new Markdown(markdown, 0, 0, theme as never, undefined, { transform }).render(200);
	return [...lines.join("\n").matchAll(/\x1b\]8;;([^\x1b\x07]+)(?:\x1b\\|\x07)/g)].map((match) => match[1]);
}

describe("extension", () => {
	it("resolves against the session cwd, not process.cwd()", () => {
		setCapabilityOverrides({ hyperlinks: true });
		const { transform, startSession } = load();
		startSession("/Users/me/project");
		assert.equal(
			transform("[r](build/report.txt)", context("assistant")),
			"[r](<file:///Users/me/project/build/report.txt>)",
		);
	});

	it("rewrites thinking but not user messages", () => {
		setCapabilityOverrides({ hyperlinks: true });
		const { transform, startSession } = load();
		startSession("/w");
		assert.equal(transform("[a](a.md)", context("assistant-thinking")), "[a](<file:///w/a.md>)");
		assert.equal(transform("[a](a.md)", context("user")), "[a](a.md)");
	});

	it("does nothing when the terminal has no hyperlink support", () => {
		setCapabilityOverrides({ hyperlinks: false });
		const { transform, startSession } = load();
		startSession("/w");
		assert.equal(transform("[a](a.md)", context("assistant")), "[a](a.md)");
	});

	it("makes Pi's renderer emit an absolute file URL in the OSC 8 hyperlink", () => {
		setCapabilityOverrides({ hyperlinks: true });
		const { transform, startSession } = load();
		startSession("/Users/me/project");
		const target = "build/runs/42/evidence/report.txt";
		const markdown = `[Current full generated report](${target}) and [web](https://pi.dev)`;

		assert.deepEqual(
			osc8Targets(markdown, (md) => md),
			[target, "https://pi.dev"],
			"baseline: Pi emits the relative target unchanged",
		);
		assert.deepEqual(osc8Targets(markdown, (md) => transform(md, context("assistant"))), [
			`file:///Users/me/project/${target}`,
			"https://pi.dev",
		]);
	});
});
