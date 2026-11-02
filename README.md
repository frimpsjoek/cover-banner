# Cinematic Covers

*Covers, fonts, and note styling.*

Give Obsidian notes a calm, cinematic reading experience with Notion-style cover banners, subtle motion, note icons, and refined Markdown typography.

## What it adds

- Cinematic cover banners with a natural bottom fade
- Larger banner controls that appear on hover
- URL- and book-based automatic banner selection
- Built-in covers that need no API key or network, and an optional Pexels image search
- Emoji, Iconify, favicon, and local-image note icons
- Parallax motion, sticky banners, height, dimming, radius, choice of rounded corners, and fit controls
- Hideable properties, raw frontmatter, and note titles, with a command and banner button to hide or show properties
- Enhanced styling for Markdown, code, JSON, JSONL, LaTeX, and AI transcripts
- Clearer shell code: commands, flags, and paths are coloured in Reading view and Live Preview
- Content font presets for reading, technical notes, and long-form writing
- Reading templates for balanced, bookish, focused, and technical notes
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

Auto-set runs when you use the command or button. To also run it when you open a note, turn on **Auto-set banner on open** in settings. It is off by default because it requests the note's URL or sends the note's title to Google Books, and writes the result to the note.

When a note has no banner, **Auto-set banner (URL/Book)** tries to:

1. Find a page URL in fields such as `URL`, `url`, `source`, `link`, or `href`.
2. Download the page’s Open Graph or Twitter image.
3. Fall back to a Google Books cover based on the note title.
4. Apply the configured default banner if no matching image resolves. If there is no valid default, create a small offline landscape SVG. Manual Auto-set reports when it uses a fallback; it does not create an empty cover field.

Downloaded banners are saved in `.attachments/banners/` by default.

## Browse photo sites without a key

Open **Pick a banner** to choose a built-in cover, which needs no API key or network. To use your own photos, add a Pexels API key to search from the picker, or browse Pexels, Pixabay, or Unsplash in your browser. Sign in on the provider website if needed, then paste a direct image URL into **Use image**. This sets a remote banner and requires network access to display it; it does not import your account or collections. Pexels API search remains available with an existing key. Pixabay and Unsplash key fields are reserved for future integrations; entering them does not currently enable in-plugin search.

Automatic login is not included. Unsplash requires an enabled parent application for its dynamic registration flow. Pexels and Pixabay's documented search APIs require keys.

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

Additional offline reading fonts: **Lato**, **Open Sans**, **Noto Sans**, and **Literata**. Select them under **Content font** in the dashboard or settings.

Use **Font size** in the dashboard or plugin settings to adjust text from **12–32 px** (default **16 px**) in Reading view and Live Preview. The chosen size takes precedence over template text sizing; templates still control spacing.

Font presets are bundled in the stylesheet and work offline without installing fonts on each device. Font licenses are included in `font-licenses/`.

Use **Content font** in the dashboard or settings to choose the note’s prose font:

- **Inter** — best general-purpose choice for mixed notes
- **Source Serif 4** — comfortable for long-form reading
- **IBM Plex Mono** — ideal for technical notes and logs

Use **Code font** to choose the face for code blocks and inline code. Code fonts are not bundled: one marked *(not installed)* shows the next available font.

Atkinson Hyperlegible has almost no Greek and no arrows, so IBM Plex Sans supplies those characters.

## Reading templates

Use **Reading template** in the dashboard or settings to change the note’s
spacing and reading rhythm without changing the Markdown itself:

- **Balanced** — comfortable everyday note styling
- **Bookish** — relaxed spacing for long-form reading
- **Focused** — larger type and generous whitespace
- **Technical** — tighter spacing for reference notes and code

Templates work in both Reading view and Live Preview. They can be combined
with any content font preset.

## Commands

- **Cinematic Covers: Open dashboard**
- **Cinematic Covers: Auto-set banner (URL/Book)**
- **Cinematic Covers: Pick a banner…**
- **Cinematic Covers: Clear invalid banner field**

You can also open the dashboard from the Cinematic Covers ribbon icon.

## Settings and privacy

API keys are entered locally in plugin settings and are not included in the plugin release. The published repository does not contain your `data.json` settings file.

Pexels and Pixabay are optional. You can use built-in covers, local images, URLs, Google Books, and the default banner without configuring an image-provider key. If the default photo cannot load, a built-in cover is shown instead.

## Image performance

New downloaded JPEG and PNG banners are resized proportionally to fit within 1600 × 1000 pixels, without upscaling, and encoded as WebP at 82% quality only if smaller. Existing vault images, remote URL banners, animated formats, and SVGs are not rewritten. Files over 24 MB and devices without the conversion APIs keep the original download. If conversion fails, the original is preserved.

Unchanged banners are reused across note refreshes, and images decode asynchronously. Picker thumbnails load lazily.

## Automatic updates

Version 0.5.8 includes automatic updates, enabled by default. It checks the public `frimpsjoek/cover-banner` GitHub repository at startup and every six hours, downloads newer stable releases, and asks you to restart Obsidian to apply them. No account or API key is needed. Disable this under **Settings → Cinematic Covers → Automatic updates** if you prefer manual updates. Use **Check now** there or the **Check for plugin updates** command for an immediate check.

Updates preserve `data.json`. The updater validates release identity and Obsidian compatibility, downloads all three required files before installation, and creates `.update-backup` copies. If a write fails, it attempts to restore the previous files. Network errors during background checks are logged without interrupting your work. Each device checks independently while Obsidian is running.

Install 0.5.8 once using the steps below to get the updater. Future releases must be published on GitHub with matching `main.js`, `styles.css`, and `manifest.json` assets. Keep the font license notices with distributed releases.

## Updating a manual installation

1. Disable the plugin in Obsidian's Community plugins settings.
2. Copy the new `main.js`, `styles.css`, and `manifest.json` into your vault's `.obsidian/plugins/cover-banner/` folder, replacing those three files. Keep `data.json` to preserve your settings.
3. Enable the plugin again. Confirm version **0.6.3** in Community plugins.
4. Repeat in each device's vault, or sync the updated plugin files and reload the plugin there.

The plugin folder stays named `cover-banner` even though its display name is Cinematic Covers.

## Device support

On phones and tablets, the dashboard opens in a full tab. Scroll inside it to reach all appearance controls. On desktop, it opens in the right sidebar. Appearance controls apply globally to open notes.

When copying or syncing this plugin to another device, include both `main.js` and `styles.css` alongside `manifest.json`. The stylesheet includes the fonts and presentation rules. Update all three files together, then disable and enable the plugin on that device to load the update. Local plugin settings may differ between devices depending on your sync setup.

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
