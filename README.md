# Cinematic Covers

Give Obsidian notes a calm, cinematic reading experience with Notion-style cover banners, subtle motion, note icons, and refined Markdown typography.

## What it adds

- Cinematic cover banners with a natural bottom fade
- Larger banner controls that appear on hover
- URL- and book-based automatic banner selection
- Optional Pexels image picker
- Emoji, Iconify, favicon, and local-image note icons
- Parallax motion, sticky banners, height, dimming, radius, and fit controls
- Hideable properties and note titles
- Enhanced styling for Markdown, code, JSON, JSONL, LaTeX, and AI transcripts
- Content font presets for reading, technical notes, and long-form writing
- A dashboard for per-note and global settings

## Quick start

1. Open **Settings → Community plugins → Browse**.
2. Search for **Cinematic Covers**.
3. Install and enable it.
4. Open the command palette and run **Cinematic Covers: Open dashboard**.
5. Choose a banner, adjust the appearance, and save.

The plugin works in both **Reading view** and **Live Preview**.

## Add a banner to a note

Add a supported field to the note’s YAML frontmatter:

```yaml
---
cover: "[[.attachments/banners/my-banner.jpg]]"
---
```

Supported banner formats include:

```yaml
cover: "[[image.png]]"
cover: "image.png"
cover: "path/to/image.png"
cover: "https://example.com/image.jpg"
```

The primary field is `cover`. The fallback fields `coverFilename` and `banner` are also supported.

## Automatic banners

When a note has no banner, **Auto-set banner (URL/Book)** tries to:

1. Find a page URL in fields such as `URL`, `url`, `source`, `link`, or `href`.
2. Download the page’s Open Graph or Twitter image.
3. Fall back to a Google Books cover based on the note title.
4. Use the default cinematic nature image if no source resolves.

Downloaded banners are saved in `.attachments/banners/` by default.

## Note icons

Set the `favicon` field to add a small icon beside the note title:

```yaml
---
favicon: "🧪"
---
```

Supported values include emoji, Iconify icons, favicon or image URLs, and local image paths. Icons are kept separate from banner sources, so a favicon will not become an oversized cover image.

## Appearance controls

Open the Cinematic Covers dashboard or plugin settings to control:

| Option | What it changes |
| --- | --- |
| Height | Cover height in pixels |
| Dim | Image darkness and text contrast |
| Bottom fade | Blends the image naturally into the note |
| Sticky pin | Keeps the banner visible while scrolling |
| Parallax | Adds gentle depth while scrolling |
| Radius | Rounds the banner corners |
| Fit | Controls how the image fills the cover |
| Banner buttons | Shows or hides hover controls |
| Hide properties | Hides rendered properties without removing frontmatter |
| Hide note title | Hides the rendered title without renaming the file |

## Markdown and AI notes

Enhanced Markdown styling improves headings, links, lists, tables, blockquotes, callouts, code blocks, JSON, JSONL, and LaTeX.

Common AI transcript labels are formatted automatically:

```text
System:
Developer:
User:
Assistant:
Tool:
```

## Content fonts

Use **Content font** in the dashboard or settings to choose the note’s prose font:

- **Inter** — best general-purpose choice for mixed notes
- **Source Serif 4** — comfortable for long-form reading
- **IBM Plex Mono** — ideal for technical notes and logs

Code blocks continue to use a monospace font for readability.

## Commands

- **Cinematic Covers: Open dashboard**
- **Cinematic Covers: Auto-set banner (URL/Book)**
- **Cinematic Covers: Pick banner from Pexels…**
- **Cinematic Covers: Clear invalid banner field**

You can also open the dashboard from the Cinematic Covers ribbon icon.

## Settings and privacy

API keys are entered locally in plugin settings and are not included in the plugin release. The published repository does not contain your `data.json` settings file.

Pexels and Pixabay are optional. You can use local images, URLs, Google Books, and the default banner without configuring an image-provider key.

## Troubleshooting

**The banner is not showing**

- Confirm the note is in Reading view or Live Preview.
- Check that the image path exists inside the vault.
- Run **Clear invalid banner field**, then set the banner again.

**The icon appears as a banner**

- Put the value in `favicon`, not `cover`.

**The properties are still visible**

- Enable **Hide properties** in the dashboard or plugin settings. This changes presentation only; it does not delete frontmatter.

## License

Cinematic Covers is released under the [MIT License](./LICENSE).
