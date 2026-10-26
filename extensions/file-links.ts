import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import { rewriteFileLinks, toFileUrl } from "../src/links.ts";

/**
 * Make local file links in assistant replies clickable.
 *
 * Terminals need an absolute URL in an OSC 8 hyperlink, but models write `[report](out/report.txt)`.
 * This resolves those links against the session's working directory before Pi renders them.
 * Display only: the saved session keeps the original Markdown.
 */
export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
	});

	pi.registerMarkdownTransformer((markdown, context) => {
		// Without hyperlink support Pi prints the destination inline, where the short relative path reads better.
		if (context.messageType === "user" || !getCapabilities().hyperlinks) return markdown;
		return rewriteFileLinks(markdown, (href) => toFileUrl(href, cwd));
	});
}
