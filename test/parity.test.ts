import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Markdown, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { rewriteFileLinks, toFileUrl } from "../src/links.ts";

// Render through Pi's own Markdown component, before and after the rewrite. The visible text must not
// change, and every link Pi renders must end up with its local path resolved and everything else intact.
// This catches any place where the extension's lexer disagrees with Pi's.

const url = (href: string) => toFileUrl(href, "/w", "/home/me");
const theme = new Proxy({}, { get: () => (text: string) => text });
const OSC8 = /\x1b\]8;;([^\x1b\x07]*)(?:\x1b\\|\x07)/g;

function render(markdown: string) {
	const out = new Markdown(markdown, 0, 0, theme as never).render(200).join("\n");
	return {
		visible: out.replace(OSC8, "").replace(/ +$/gm, ""),
		targets: [...out.matchAll(OSC8)].map((match) => match[1]).filter(Boolean),
	};
}

const cases = [
	"See [report](out/report.txt).",
	"- `x\n  [a](a.md)` [a](a.md)",
	"> `x\n> [a](a.md)` [a](a.md)",
	"x\r\n[a](a.md)",
	"p\r\n\r\n[a](a.md)",
	"\t[a](a.md)",
	"- item\n\t- nested [a](a.md)",
	"costs $5 see [a](a.md)",
	"$x$ and [a](a.md)",
	"$$\n[a](a.md)\n$$",
	"\\[\n[a](a.md)\n\\]",
	"- [a\n  b](x.md) after",
	"> [a\n> b](x.md) after",
	"- one\n  two [a](a.md)\n- three [b](b.md)",
	"1. first\n   - nested [n](n.md)\n2. second `[c](c.md)` [d](d.md)",
	"> quote\n> > nested [q](q.md:12)",
	"| a | b |\n| --- | --- |\n| `[x](x.md)` | [y](y.md) |",
	'[a `x[0]` \\] b](<my dir/r(1).txt> "T")',
	'[ref][r] and [r]\n\n[r]: docs/a.md "Doc"',
	"`[a](a.md)` and \\[a](a.md)\n\n```\n[a](a.md)\n```\n",
	"[dev](localhost:5173) [w](www.pi.dev) [e](me@x.co) [web](https://pi.dev)",
	"[c](C#/notes.md) [i](issue#12.md) [m](README.md#install)",
	"~~[s](s.md)~~ **[b](b.md)** _[i](i.md)_",
	"<a href='h.md'>html</a> [after](after.md)",
	"Line one  \nline [two](two.md)",
	"# [h](h.md)\n\nText [t](t.md)",
	"[r]: a.md\n\n[r]: xxxx.md\n\n`[a](a.md)`\n\n[a](a.md)",
	"| [a\\|b](a.md) | `x\\|[c](c.md)` |\n| --- | --- |\n| [d](d.md) | e |",
	"~~`[a](a.md)~~` [b](b.md)",
	"~a [x](x.md) b~ and ~~[y](y.md)~~",
	"**中文[a](a.md)**の説明と*強調[b](b.md)*です",
	"Partial streaming [lin",
	"Partial streaming [link](out/rep",
];

describe("parity with Pi's renderer", () => {
	setCapabilityOverrides({ hyperlinks: true });

	for (const markdown of cases) {
		it(JSON.stringify(markdown), () => {
			const before = render(markdown);
			const after = render(rewriteFileLinks(markdown, url));
			assert.equal(after.visible, before.visible, "visible text changed");
			assert.deepEqual(
				after.targets,
				before.targets.map((target) => url(target) ?? target),
			);
		});
	}
});
