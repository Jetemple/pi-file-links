# pi-file-links

Makes local file links in [Pi](https://pi.dev)'s assistant replies clickable.

Models write file links as relative paths: `[report](out/report.txt)`. Pi passes that path to the terminal unchanged as an OSC 8 hyperlink, and terminals can't open a relative target because they don't know which directory Pi is running in. Clicking does nothing, or macOS shows error -50.

This extension resolves those links against the session's working directory before Pi renders them, so the terminal gets `file:///abs/path/out/report.txt`.

## Install

Requires Pi 0.84.0 or later.

```bash
pi install npm:pi-file-links
```

Or try it for one session:

```bash
pi -e npm:pi-file-links
```

## What gets rewritten

| Link destination | Result |
|---|---|
| `out/report.txt`, `./a.md`, `../b.md` | Resolved against the session cwd |
| `/abs/path.md` | `file:///abs/path.md` |
| `~/notes.md` | Resolved against your home directory |
| `src/app.ts:42`, `:42:7`, `:42-60` | Line suffix dropped (file URLs have no line syntax) |
| `docs/a.md#section`, `page.html?x=1` | Fragment and query after a file extension dropped |
| `https://…`, `mailto:…`, `file://…`, any other scheme | Unchanged |
| `localhost:5173`, `127.0.0.1:8080`, `www.example.com`, `me@example.com` | Unchanged |
| `#anchor`, `?query`, `//host/path` | Unchanged |

- Only assistant replies and thinking are rewritten. Your own messages are left alone.
- Links are found with Pi's Markdown lexer settings, so links inside code, math, and escaped brackets are never touched.
- Display only: the saved session keeps the original Markdown.
- If the terminal doesn't support hyperlinks, nothing changes, and Pi keeps printing the short relative path.

## Limits

- `file://` URLs point at the machine running the terminal. In SSH or container sessions they point at the wrong filesystem.
- Windows drive paths (`C:\…`) are not converted.
- Links resolve against the cwd at render time, so a resumed session resolves old links against its current cwd.
- Paths aren't checked for existence. A bare domain like `example.com` is treated as a file.
- Pi's math and strikethrough rules are copied from Pi 1.4.0 (`src/pi-parser.ts`), because Pi doesn't export its parser. `test/parity.test.ts` renders through Pi's own Markdown component to catch drift after a Pi upgrade.

## Development

```bash
npm install
npm test
npm run typecheck
pi -e ./extensions/file-links.ts
```

## License

MIT
