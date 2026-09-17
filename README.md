# Cover Banner

Displays a Notion-style banner at the top of notes in **Reading view** and **Live Preview**.

Frontmatter fields:
- Primary: `cover` (auto-set writes here)
- Fallbacks: `coverFilename`, `banner`
- Note icon: `favicon`

Supported banner values:
- `"[[image.png]]"`
- `"image.png"`
- `"path/to/image.png"`
- `"https://..."`

Notes without a custom banner use a cinematic misty evergreen mountain image from [Unsplash](https://unsplash.com/photos/white-fog-on-forest-jew8Kj3nFSs) by default. Replace it in Settings → Cover Banner → Default banner if you prefer another image.

Supported note icon values:
- Emoji, like `"📝"`
- Iconify icon, like `"iconify:bx:bxs-flask"`
- Favicon/image URL, like `"https://abs.twimg.com/favicons/twitter-pip.3.ico"`
- Local favicon/image path, like `"favicons/1.ico"`

## Enable
Obsidian → Settings → Community plugins → (turn off Restricted mode if needed) → Installed plugins → enable **Cover Banner**.

## Auto-set behavior
If a note has no banner set, the plugin will try:
1) If frontmatter contains a URL (keys include `URL` and `url` by default) → fetch `og:image` / `twitter:image` and download it.
2) Otherwise → query Google Books using the note title and download the cover.

Notes without existing YAML frontmatter are supported. The plugin can auto-create frontmatter keys when setting a banner.

Use **Hide inline properties** in the dashboard or settings to hide the rendered properties block while preserving the note's frontmatter data.

Use **Hide note title** to remove the rendered title while keeping the filename unchanged. **Enhanced Markdown styling** improves reading-view typography and presentation for headings, links, tables, lists, code, JSON/JSONL, and LaTeX. **AI chat formatting** recognizes common `System:`, `Developer:`, `User:`, `Assistant:`, and `Tool:` transcript labels.

Use **Content font** in the dashboard or settings to choose the note's prose font. **Inter** is the recommended all-round choice for mixed Markdown and AI notes; **Source Serif 4** suits long-form reading, and **IBM Plex Mono** suits technical notes. Code blocks always retain a monospace font.

If no valid image source resolves, the plugin still renders a default placeholder banner shell and action icons (when banner buttons are enabled), so you can set/fix a banner quickly.

Favicon/icon URLs are ignored as banner sources so they do not render as oversized banners. Put them in the `favicon` field to show them as the small note icon.

If the note icon is set with an empty value, the plugin uses a default note emoji (`📝`) unless you explicitly clear it.

Downloaded banners are saved to `.attachments/banners/` by default.

## Manual triggers
- Ribbon icon: **Open Cover Banner dashboard**
- Command palette:
  - **Cover Banner: Open dashboard**
  - **Cover Banner: Auto-set banner (URL/Book)**
  - **Cover Banner: Pick banner from Pexels…**
  - **Cover Banner: Clear invalid banner field (if not an image)**

## Customize
Settings → Cover Banner.
