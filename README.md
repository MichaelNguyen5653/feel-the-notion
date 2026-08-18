# Feel the Notion

> Recommended plugin to enhance experience: [Bullet depth markers](https://community.obsidian.md/plugins/bullet-depth-markers)
>
> Recommended setting: Obsidian Settings → Files and Links → under Links, toggle on **Automatically update internal links**.

Notion-like block editing for Obsidian's Live Preview.

![Feel the Notion in use](docs/showcase.gif)

## Features

- **Hover handles** — a `+` and a drag handle follow the pointer down the gutter.
- **Drag whole blocks** — grabbing any line takes the block, children included, and drops it at a depth you choose with horizontal position.
- **Multi-block selection** — a drag across blocks paints whole blocks rather than a ragged text range.
- **Block-aware keys** — `Cmd+A` selects the block, then the note. `Backspace` at a block's start outdents, then drops the marker, then merges.
- **Insert menu** — type `/` on an empty block or mid-line, or click the `+`. Headings 1–5, callouts, code, math, tables, dividers, footnotes, images, and attachments.
- **`/page`** — creates a note beside the current one and links to it.
- **`/table of contents`** — a nested list of links to the note's headings, callout-aware.
- **Hide syntax markers** — optional: stops text shifting sideways as the caret enters `**bold**`.

Everything behavioural has a toggle in settings.

![The insert menu, opened by typing a slash](docs/insert-menu.png)

## Installation

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/MichaelNguyen5653/feel-the-notion/releases).
2. Put them in `<vault>/.obsidian/plugins/feel-the-notion/`.
3. Enable the plugin in Settings → Community plugins.

## Credits

Forked from [BCS1037/notion-block](https://github.com/BCS1037/notion-block) v1.4.0 (MIT).

## License

MIT. See [LICENSE](LICENSE).
