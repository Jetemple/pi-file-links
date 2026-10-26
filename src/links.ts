import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Token, Tokens } from "@earendil-works/pi-tui";
import { createPiParser } from "./pi-parser.ts";

const parser = createPiParser();
const inlineRules = parser.Lexer.rules.inline.gfm;

const SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
// `localhost:5173`, `127.0.0.1:8080/x`, `[::1]:3000`: dev servers, not `file:line` references.
const HOST = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-fA-F:]+\])(?::\d+)?(?:[/?#]|$)/i;
const WEB = /^www\./i;
const EMAIL = /^[^\s/@]+@[^\s/@]+\.[a-zA-Z]{2,}$/;
// `README.md#install`, `page.html?x=1`, `README.md:42#intro`. Only after a file extension and optional line
// suffix, so `C#/notes.md` and `issue#12.md` stay whole.
const FRAGMENT = /(\.[a-zA-Z\d]+(?::\d+(?:[-:]\d+)?)?)[?#].*$/;
// `src/app.ts:42`, `src/app.ts:42:7`, `src/app.ts:42-60`
const LINE_SUFFIX = /:\d+(?:[-:]\d+)?$/;
const PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/;

/**
 * Map a Markdown link destination to an absolute `file://` URL, or return undefined to leave it alone.
 *
 * Converted: relative paths, `./` and `../` paths, absolute paths, and `~/` paths.
 * Left alone: anything with a URI scheme, `#anchors`, `?queries`, `//network` references,
 * `localhost` and IP addresses, `www.` hosts, and email addresses.
 * A trailing `:line`, `:line:col`, or `:start-end` is dropped because file URLs have no line syntax.
 * A `#fragment` or `?query` after a file extension is dropped for the same reason.
 */
export function toFileUrl(href: string, cwd: string, home: string = homedir()): string | undefined {
	if (!href || href.startsWith("#") || href.startsWith("?") || href.startsWith("//")) return undefined;
	if (HOST.test(href) || WEB.test(href) || EMAIL.test(href)) return undefined;

	let target = href.replace(FRAGMENT, "$1").replace(LINE_SUFFIX, "");
	if (!target || SCHEME.test(target)) return undefined;

	if (PERCENT_ESCAPE.test(target)) {
		try {
			target = decodeURIComponent(target);
		} catch {
			return undefined;
		}
	}
	if (target === "~" || target.startsWith("~/")) target = home + target.slice(1);

	return pathToFileURL(isAbsolute(target) ? target : resolve(cwd, target)).href;
}

/**
 * Rewrite local-file link destinations in Markdown to absolute `file://` URLs.
 *
 * Links are found with Pi's lexer settings, so links inside code, math, and
 * escaped brackets are never touched. Each link is rewritten in place as an inline link; its label and
 * title keep their original source text. If a token can't be placed in the source, the rest of that
 * block is left alone rather than risk editing the wrong span.
 */
export function rewriteFileLinks(markdown: string, toUrl: (href: string) => string | undefined): string {
	// Lex what Pi lexes: Pi swaps tabs for three spaces before parsing, and marked folds CRLF into LF.
	const source = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "   ");
	const edits: Array<{ start: number; end: number; text: string }> = [];
	let blockEnd = 0;

	for (const block of parser.lexer(source)) {
		// Blocks are searched for rather than summed: marked drops some source, such as duplicate link definitions.
		const blockStart = source.indexOf(block.raw, blockEnd);
		if (blockStart < 0) break;
		blockEnd = blockStart + block.raw.length;
		let cursor = blockStart;

		for (const token of leafTokens(block)) {
			const span = locate(source, token.raw, cursor, blockEnd);
			if (!span) break;
			cursor = span.end;
			if (token.type !== "link") continue;

			const link = token as Tokens.Link;
			const url = toUrl(link.href);
			const text = url === undefined ? undefined : rebuildLink(link, source.slice(span.start, span.end), url);
			if (text !== undefined) edits.push({ ...span, text });
		}
	}

	if (edits.length === 0) return markdown;
	const parts: string[] = [];
	let position = 0;
	for (const edit of edits) {
		parts.push(source.slice(position, edit.start), edit.text);
		position = edit.end;
	}
	parts.push(source.slice(position));
	return parts.join("");
}

/**
 * Find a token's source span at or after `from`. Inside lists and blockquotes, marked strips each line's
 * indent and `>` marker from nested tokens, so a multi-line raw may have extra prefix at each line start.
 * Inside tables, marked unescapes `\|` in cell tokens.
 */
function locate(source: string, raw: string, from: number, limit: number): { start: number; end: number } | undefined {
	if (!raw) return { start: from, end: from };
	let start: number;
	let end: number;
	if (raw.includes("\n") || raw.includes("|")) {
		const lines = raw.split("\n").map((line) => escapeRegExp(line).replaceAll("\\|", "\\\\?\\|"));
		const pattern = new RegExp(lines.join("\\n[ >]*"), "g");
		pattern.lastIndex = from;
		const match = pattern.exec(source);
		if (!match) return undefined;
		start = match.index;
		end = start + match[0].length;
	} else {
		start = source.indexOf(raw, from);
		end = start + raw.length;
	}
	return start < 0 || end > limit ? undefined : { start, end };
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Leaf tokens in source order. Links count as leaves so their labels are not searched separately. */
function* leafTokens(token: Token): Generator<Token> {
	if (token.type === "link") {
		yield token;
		return;
	}
	if (token.type === "list") {
		for (const item of (token as Tokens.List).items) yield* leafTokens(item);
		return;
	}
	if (token.type === "table") {
		const table = token as Tokens.Table;
		for (const cell of table.header) yield* children(cell.tokens);
		for (const row of table.rows) for (const cell of row) yield* children(cell.tokens);
		return;
	}
	if ("tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
		yield* children(token.tokens);
		return;
	}
	yield token;
}

function* children(tokens: Token[]): Generator<Token> {
	for (const token of tokens) yield* leafTokens(token);
}

function rebuildLink(link: Tokens.Link, raw: string, url: string): string | undefined {
	const inline = inlineRules.link.exec(raw);
	if (inline && inline[0] === raw) {
		const title = inline[3] ? ` ${inline[3]}` : "";
		return `[${inline[1]}](<${url}>${title})`;
	}
	// Reference links (`[label][ref]`, `[label][]`, `[label]`) take their destination from a definition elsewhere.
	const reference = inlineRules.reflink.exec(raw) ?? inlineRules.nolink.exec(raw);
	if (reference && reference[0] === raw) {
		const title = link.title ? ` "${link.title.replace(/["\\]/g, "\\$&")}"` : "";
		return `[${reference[1]}](<${url}>${title})`;
	}
	return undefined;
}
