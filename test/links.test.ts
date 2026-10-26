import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rewriteFileLinks, toFileUrl } from "../src/links.ts";

const cwd = "/work/project";
const home = "/home/me";
const url = (href: string) => toFileUrl(href, cwd, home);
const rewrite = (markdown: string) => rewriteFileLinks(markdown, url);

describe("toFileUrl", () => {
	it("resolves the reported relative path against the session cwd", () => {
		assert.equal(
			url("build/runs/42/evidence/report.txt"),
			"file:///work/project/build/runs/42/evidence/report.txt",
		);
	});

	it("resolves ./, ../, absolute, and home paths", () => {
		assert.equal(url("./a.md"), "file:///work/project/a.md");
		assert.equal(url("../sibling/a.md"), "file:///work/sibling/a.md");
		assert.equal(url("/etc/hosts"), "file:///etc/hosts");
		assert.equal(url("~/notes.md"), "file:///home/me/notes.md");
		assert.equal(url("~"), "file:///home/me");
	});

	it("drops line suffixes, fragments, and queries", () => {
		assert.equal(url("src/app.ts:42"), "file:///work/project/src/app.ts");
		assert.equal(url("src/app.ts:42:7"), "file:///work/project/src/app.ts");
		assert.equal(url("src/app.ts:42-60"), "file:///work/project/src/app.ts");
		assert.equal(url("README.md#install"), "file:///work/project/README.md");
		assert.equal(url("page.html?x=1"), "file:///work/project/page.html");
	});

	it("encodes spaces and unicode once, including already-escaped input", () => {
		assert.equal(url("my dir/r(1).txt"), "file:///work/project/my%20dir/r(1).txt");
		assert.equal(url("docs/说明.md"), "file:///work/project/docs/%E8%AF%B4%E6%98%8E.md");
		assert.equal(url("docs/%E8%AF%B4%E6%98%8E.md"), "file:///work/project/docs/%E8%AF%B4%E6%98%8E.md");
		assert.equal(url("my%20dir/a.md"), "file:///work/project/my%20dir/a.md");
	});

	it("keeps # and ? that are part of the path", () => {
		assert.equal(url("C#/notes.md"), "file:///work/project/C%23/notes.md");
		assert.equal(url("issue#12.md"), "file:///work/project/issue%2312.md");
		assert.equal(url("docs/a.md#L10-L20"), "file:///work/project/docs/a.md");
		assert.equal(url("docs/a.md?next=/foo"), "file:///work/project/docs/a.md");
		assert.equal(url("README.md:42#intro"), "file:///work/project/README.md");
	});

	it("leaves URLs, anchors, queries, and network references alone", () => {
		for (const href of [
			"https://example.com/a.md",
			"http://localhost:8080/x",
			"mailto:a@b.co",
			"file:///already/absolute.md",
			"vscode://file/x.ts:3",
			"#section",
			"?q=1",
			"//host/share/a.md",
			"",
			"%E0%A4%A",
			"localhost:5173",
			"localhost",
			"127.0.0.1:8080/x",
			"[::1]:3000",
			"www.pi.dev",
			"me@x.co",
		]) {
			assert.equal(url(href), undefined, href);
		}
	});
});

describe("rewriteFileLinks", () => {
	it("rewrites an inline file link", () => {
		assert.equal(
			rewrite("See [report](out/report.txt)."),
			"See [report](<file:///work/project/out/report.txt>).",
		);
	});

	it("keeps the label and title source text intact", () => {
		assert.equal(
			rewrite('[a `x[0]` \\] b](<my dir/r(1).txt> "T")'),
			'[a `x[0]` \\] b](<file:///work/project/my%20dir/r(1).txt> "T")',
		);
	});

	it("rewrites reference links in place", () => {
		assert.equal(
			rewrite('[ref][r] and [r]\n\n[r]: docs/a.md "Doc"'),
			'[ref](<file:///work/project/docs/a.md> "Doc") and [r](<file:///work/project/docs/a.md> "Doc")\n\n[r]: docs/a.md "Doc"',
		);
	});

	it("does not touch code spans, code blocks, or escaped brackets", () => {
		const markdown = "`[a](a.md)` and \\[a](a.md)\n\n```\n[a](a.md)\n```\n";
		assert.equal(rewrite(markdown), markdown);
	});

	it("finds the real link after an identical one in a code span", () => {
		assert.equal(rewrite("`[a](a.md)` then [a](a.md)"), "`[a](a.md)` then [a](<file:///work/project/a.md>)");
	});

	it("rewrites links in lists, blockquotes, headings, emphasis, and tables", () => {
		const markdown = [
			"# [h](h.md)",
			"- item [l](l.md)",
			"> quote [q](q.md:12)",
			"**[b](b.md)**",
			"| col |",
			"| --- |",
			"| [t](t.md) |",
		].join("\n\n");
		const out = rewrite(markdown);
		for (const name of ["h", "l", "q", "b", "t"]) {
			assert.ok(out.includes(`(<file:///work/project/${name}.md>)`), `${name} in ${out}`);
		}
	});

	it("leaves web links and images alone", () => {
		const markdown = "[web](https://pi.dev) <https://pi.dev> www.pi.dev ![img](shot.png)";
		assert.equal(rewrite(markdown), markdown);
	});

	it("normalizes CRLF and tabs the way Pi does before lexing", () => {
		assert.equal(rewrite("x\r\n[a](a.md)"), "x\n[a](<file:///work/project/a.md>)");
		assert.equal(rewrite("\t[a](a.md)"), "   [a](<file:///work/project/a.md>)");
		assert.equal(rewrite("x\r\ny"), "x\r\ny");
	});

	it("does not edit a multi-line code span inside a list or blockquote", () => {
		assert.equal(rewrite("- `x\n  [a](a.md)` [a](a.md)"), "- `x\n  [a](a.md)` [a](<file:///work/project/a.md>)");
		assert.equal(rewrite("> `x\n> [a](a.md)` [a](a.md)"), "> `x\n> [a](a.md)` [a](<file:///work/project/a.md>)");
	});

	it("leaves links inside math alone, as Pi does", () => {
		for (const markdown of ["costs $5 see [a](a.md)", "$$\n[a](a.md)\n$$"]) {
			assert.equal(rewrite(markdown), markdown);
		}
	});

	it("stays fast on long streamed replies", () => {
		const markdown = "[a](a.md) ".repeat(16000);
		const start = performance.now();
		rewrite(markdown);
		assert.ok(performance.now() - start < 500, `took ${performance.now() - start}ms`);
	});

	it("returns plain text unchanged", () => {
		assert.equal(rewrite("no links here"), "no links here");
		assert.equal(rewrite(""), "");
	});
});
