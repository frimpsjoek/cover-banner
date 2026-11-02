/*
Cinematic Covers (Obsidian plugin)

v0.5.2-local
- One ribbon icon opens a RIGHT-PANEL dashboard (like Notion controls)
- Dashboard provides actions (auto-set, Pexels picker, clear invalid, set icon)
- Banner styling controls: height, dim, bottom fade, radius, object-fit
- Default banner fallback when no frontmatter banner exists
- Banner renders in Reading view + Live Preview
*/

const obsidian = require("obsidian");
const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  requestUrl,
  Modal,
  TextComponent,
  debounce,
  ItemView,
  WorkspaceLeaf,
  setIcon,
  addIcon
} = obsidian;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;
const ICON_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg|ico)$/i;
const DEFAULT_CINEMATIC_BANNER =
  "https://images.unsplash.com/photo-1486854561807-38fc02359493?auto=format&fit=crop&w=2400&q=82";

const VIEW_TYPE = "cover-banner-dashboard";
const TOOL_ICON = "obsidian-banners-landscape";
const TOOL_ICON_SVG = '<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="16" width="84" height="68" rx="10"/><path d="m10 65 24-25 22 25 15-15 19 20"/><circle cx="70" cy="35" r="6"/></g>';

// Fonts are bundled in styles.css for offline use across devices.
// Inter is the best all-rounder for mixed Markdown, AI transcripts, and properties.
const CONTENT_FONT_PRESETS = {
  inter: {
    label: "Inter (recommended)",
    stack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  lato: { label: "Lato — everyday reading", stack: '"Lato", sans-serif' },
  openSans: { label: "Open Sans — clear and open", stack: '"Open Sans", "IBM Plex Sans", sans-serif' },
  notoSans: { label: "Noto Sans — clean reading", stack: '"Noto Sans", "IBM Plex Sans", sans-serif' },
  literata: { label: "Literata — book-style reading", stack: '"Literata", Georgia, serif' },
  theme: {
    label: "Theme default",
    stack: "var(--font-text-theme, -apple-system, BlinkMacSystemFont, sans-serif)"
  },
  atkinson: {
    label: "Atkinson Hyperlegible",
    // Atkinson has almost no Greek and no arrows: bundled IBM Plex Sans supplies them.
    // The newer Next family is used when installed, otherwise the bundled face.
    stack: '"Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  sourceSerif: {
    label: "Source Serif 4",
    stack: '"Source Serif 4", "Source Serif Pro", Georgia, serif'
  },
  plexSans: {
    label: "IBM Plex Sans",
    stack: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  plexMono: {
    label: "IBM Plex Mono",
    stack: '"IBM Plex Mono", "JetBrains Mono", "IBM Plex Sans", "SFMono-Regular", Menlo, Consolas, monospace'
  }
};

// Code faces are not bundled, so the picker flags any that are missing on this device.
const CODE_FONT_PRESETS = {
  theme: {
    label: "Theme default",
    stack: "var(--font-monospace)"
  },
  jetbrains: {
    label: "JetBrains Mono",
    family: "JetBrains Mono",
    stack: '"JetBrains Mono", "SFMono-Regular", Menlo, monospace'
  },
  fira: {
    label: "Fira Code",
    family: "Fira Code",
    stack: '"Fira Code", "JetBrains Mono", "SFMono-Regular", Menlo, monospace'
  },
  atkinsonMono: {
    label: "Atkinson Hyperlegible Mono",
    family: "Atkinson Hyperlegible Mono",
    stack: '"Atkinson Hyperlegible Mono", "JetBrains Mono", "SFMono-Regular", Menlo, monospace'
  },
  intel: {
    label: "Intel One Mono",
    family: "Intel One Mono",
    stack: '"Intel One Mono", "JetBrains Mono", "SFMono-Regular", Menlo, monospace'
  }
};

// Reading templates tune the rhythm of a note without changing its content.
// Fonts remain a separate choice so users can mix a layout with any installed
// font fallback they prefer.
const READING_TEMPLATE_PRESETS = {
  balanced: {
    label: "Balanced",
    description: "Clean, comfortable spacing for everyday notes",
    className: "cover-banner-template-balanced"
  },
  bookish: {
    label: "Bookish",
    description: "Relaxed paragraphs and softer section breaks for long reading",
    className: "cover-banner-template-bookish"
  },
  focused: {
    label: "Focused",
    description: "Larger type and generous spacing for distraction-free reading",
    className: "cover-banner-template-focused"
  },
  technical: {
    label: "Technical",
    description: "Tighter rhythm and stronger code surfaces for reference notes",
    className: "cover-banner-template-technical"
  }
};

// Resize new photo downloads once; never rewrite existing vault images.
async function optimizeBannerDownload(buffer, contentType) {
  if (!/^image\/(jpeg|png)(?:;|$)/i.test(contentType) || buffer.byteLength > 24 * 1024 * 1024) {
    return { buffer, contentType };
  }
  let bitmap;
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return { buffer, contentType };
    bitmap = await createImageBitmap(new Blob([buffer], { type: contentType }));
    const scale = Math.min(1, 1600 / bitmap.width, 1000 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { buffer, contentType };
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.type !== "image/webp" || blob.size >= buffer.byteLength) return { buffer, contentType };
    return { buffer: await blob.arrayBuffer(), contentType: "image/webp" };
  } catch {
    return { buffer, contentType };
  } finally {
    bitmap?.close();
  }
}

function normalizeFontSize(value) {
  const size = Number(value);
  return Number.isFinite(size) ? Math.min(32, Math.max(12, Math.round(size))) : 16;
}

function getContentFontStack(value) {
  return CONTENT_FONT_PRESETS[value]?.stack || CONTENT_FONT_PRESETS.inter.stack;
}

function getCodeFontStack(value) {
  return CODE_FONT_PRESETS[value]?.stack || CODE_FONT_PRESETS.theme.stack;
}

// CSS falls back silently when a family is absent, which makes a picker look broken.
// Compare text widths against two generics: a real font changes at least one.
function isFontInstalled(family) {
  const ctx = document.createElement("canvas").getContext("2d");
  const sample = "mmmmmmmmmmlllllliiiii0123456789";
  return ["monospace", "serif"].some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px "${family}", ${generic}`;
    return ctx.measureText(sample).width !== base;
  });
}

function codeFontLabel(preset) {
  return preset.family && !isFontInstalled(preset.family) ? `${preset.label} (not installed)` : preset.label;
}

const DEFAULT_SETTINGS = {
  // banner fields
  // Preferred primary field is `cover` (matches your vault convention).
  fieldPrimary: "cover",
  // Fallbacks for older notes / other conventions.
  fieldFallbacks: ["coverFilename", "banner"],

  // favicon (note icon) fields
  // (stored as emoji, iconify:<prefix>:<name>, or an image/favicon URL)
  faviconField: "favicon",

  // display
  heightPx: 300,
  dim: 0.18,
  fadeBottom: true,
  borderRadiusPx: 18,
  objectFit: "cover", // cover|contain|fill|scale-down|none

  // behavior
  pinBanner: false,
  parallaxEnabled: true,
  parallaxStrength: 0.22, // 0..1 (0.22 = subtle)

  autoUpdateEnabled: true,

  // UI
  showBannerButtons: true,
  hideProperties: false,
  hideTitle: false,
  contentFont: "inter",
  codeFont: "theme",
  contentFontSize: 16,
  readingTemplate: "balanced",
  enhancedMarkdown: true,
  formatAiChats: true,

  // defaults
  // defaultBanner can be a wikilink [[...]] or path or url
  defaultBanner: DEFAULT_CINEMATIC_BANNER,
  defaultFavicon: "📝",

  // autoset
  autoSetEnabled: false,
  autoSetOnOpen: false,
  autoSetUrlFieldCandidates: ["URL", "Url", "url", "source", "Source", "link", "href"],
  bannerFolder: ".attachments/banners",
  maxAutoSetPerSession: 50,

  // stock photo providers
  pexelsApiKey: "",
  pixabayApiKey: "",
  unsplashAccessKey: ""
};

function normalizeFieldValue(v) {
  if (!v) return null;
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== "string") return null;
  let s = v.trim();

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  const wiki = s.match(/^\[\[([^\]]+)\]\]$/);
  if (wiki) s = wiki[1].trim();

  if (s.includes("|")) s = s.split("|")[0].trim();

  return s || null;
}

function isHttpUrl(s) {
  return /^https?:\/\//i.test(s);
}

function isLikelyFaviconOrIconValue(value) {
  const s = normalizeFieldValue(value);
  if (!s) return false;

  let path = s;
  try {
    path = new URL(s).pathname || s;
  } catch {}

  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {}
  const lower = decodedPath.toLowerCase();
  const filename = lower.split("/").pop() || lower;
  return (
    /\.ico(?:$|[?#])/i.test(s) ||
    filename === "favicon" ||
    filename.startsWith("favicon.") ||
    lower.includes("/favicons/") ||
    filename.startsWith("apple-touch-icon") ||
    filename.startsWith("android-chrome") ||
    filename.startsWith("mstile-") ||
    filename.startsWith("site-icon")
  );
}

function isIconContentType(contentType) {
  const s = String(contentType || "").toLowerCase();
  return s.includes("image/x-icon") || s.includes("image/vnd.microsoft.icon");
}

function looksLikeMarkdownFile(file) {
  return file && file.extension && ["md", "markdown"].includes(file.extension.toLowerCase());
}

function safeFilenameBase(name) {
  return String(name || "banner")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim() || "banner";
}

function extFromContentType(ct) {
  if (!ct) return ".jpg";
  const s = ct.toLowerCase();
  if (s.includes("image/png")) return ".png";
  if (s.includes("image/webp")) return ".webp";
  if (s.includes("image/gif")) return ".gif";
  if (s.includes("image/svg")) return ".svg";
  if (s.includes("image/jpeg") || s.includes("image/jpg")) return ".jpg";
  return ".jpg";
}

function absolutizeUrl(maybeRelative, baseUrl) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickOgImage(html, baseUrl) {
  const decode = value => value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : "");
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
    }
    const name = (attrs.property || attrs.name || "").toLowerCase();
    if (!["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(name)) continue;
    const url = absolutizeUrl(attrs.content, baseUrl);
    if (url && isHttpUrl(url) && !isLikelyFaviconOrIconValue(url)) return url;
  }
  return null;
}

async function ensureFolder(app, folderPath) {
  // Obsidian throws if you try to create a folder that already exists.
  // Some vaults (sync, mobile, races) can also briefly report missing.
  // So we both pre-check and also ignore the "already exists" error.
  const norm = String(folderPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = norm.split("/").filter(Boolean);
  let current = "";
  for (const p of parts) {
    current = current ? `${current}/${p}` : p;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing) continue;
    try {
      await app.vault.createFolder(current);
    } catch (e) {
      const msg = String(e?.message || e || "").toLowerCase();
      // ignore any "already exists"-style error variants
      if (msg.includes("already exists") || msg.includes("eexist") || msg.includes("file already exists")) continue;
      throw e;
    }
  }
}

function coerceBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off", ""].includes(s)) return false;
  }
  return fallback;
}

class PexelsPickerModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.query = file?.basename || "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Pick a banner" });
    contentEl.createEl("p", { text: "Browse photo websites without an API key. Sign in on their website if needed, then paste a direct image URL below. Photo page links are not image URLs." });
    const sites = contentEl.createDiv({ cls: "cover-banner-picker__sites" });
    for (const [name, url] of [["Pexels", "https://www.pexels.com/"], ["Pixabay", "https://pixabay.com/"], ["Unsplash", "https://unsplash.com/"]]) {
      sites.createEl("a", { text: `Browse ${name}`, attr: { href: url, target: "_blank", rel: "noopener noreferrer", cls: "external-link" } });
    }
    const pasteRow = contentEl.createDiv({ cls: "cover-banner-picker__row" });
    const imageInput = new TextComponent(pasteRow);
    imageInput.setPlaceholder("Direct image URL (https://…)");
    imageInput.inputEl.setAttribute("aria-label", "Direct banner image URL");
    const apply = pasteRow.createEl("button", { text: "Use image", attr: { type: "button" } });
    apply.addEventListener("click", async () => {
      const url = imageInput.getValue().trim();
      if (!isHttpUrl(url)) { new Notice("Paste an HTTP or HTTPS image URL."); return; }
      apply.disabled = true;
      try {
        await this.plugin.setFrontmatterPrimary(this.file, url);
        this.plugin.requestRefresh();
        this.close();
      } catch { new Notice("Could not save this banner. Try again."); }
      finally { apply.disabled = false; }
    });
    contentEl.createEl("h3", { text: "Search Pexels with an API key" });

    const row = contentEl.createDiv({ cls: "cover-banner-picker__row" });
    row.createEl("label", { text: "Search" });
    const input = new TextComponent(row);
    input.setValue(this.query);

    const btn = row.createEl("button", { text: "Search" });

    const grid = contentEl.createDiv({ cls: "cover-banner-picker__grid" });

    const runSearch = async () => {
      grid.empty();
      const q = input.getValue().trim();
      if (!q) return;
      this.query = q;

      const key = (this.plugin.settings.pexelsApiKey || "").trim();
      if (!key) {
        new Notice("Cinematic Covers: set Pexels API key in plugin settings");
        return;
      }

      grid.createDiv({ text: "Searching…", cls: "cover-banner-picker__status" });

      const url = `https://api.pexels.com/v1/search?orientation=landscape&per_page=18&query=${encodeURIComponent(q)}`;
      let photos = [];
      try {
        const res = await requestUrl({ url, method: "GET", headers: { Authorization: key } });
        const j = res?.json;
        photos = Array.isArray(j?.photos) ? j.photos : [];
      } catch {
        grid.empty();
        grid.createDiv({ text: "Search failed.", cls: "cover-banner-picker__status" });
        return;
      }

      grid.empty();
      if (!photos.length) {
        grid.createDiv({ text: "No results.", cls: "cover-banner-picker__status" });
        return;
      }

      for (const p of photos) {
        const thumb = p?.src?.medium || p?.src?.small;
        const full = p?.src?.large2x || p?.src?.large || p?.src?.original;
        if (!thumb || !full) continue;

        const item = grid.createDiv({ cls: "cover-banner-picker__item" });
        const img = item.createEl("img", { attr: { src: thumb } });
        img.loading = "lazy";
        img.decoding = "async";
        item.createDiv({ text: p?.photographer ? `by ${p.photographer}` : "", cls: "cover-banner-picker__credit" });

        item.addEventListener("click", async () => {
          item.addClass("is-loading");
          const localLink = await this.plugin.downloadImageToVault(full, `pexels-${this.file.basename}`);
          if (localLink) {
            await this.plugin.setFrontmatterPrimary(this.file, localLink);
            new Notice("Cinematic Covers: banner set from Pexels");
            this.plugin.requestRefresh();
            this.close();
          } else {
            // Fallback to remote URL if binary download fails in the local environment.
            try {
              await this.plugin.setFrontmatterPrimary(this.file, full);
              new Notice("Cinematic Covers: banner set from Pexels URL");
              this.plugin.requestRefresh();
              this.close();
            } catch {
              new Notice("Cinematic Covers: failed to set image");
              item.removeClass("is-loading");
            }
          }
        });
      }
    };

    btn.addEventListener("click", runSearch);
    input.inputEl.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") runSearch();
    });

    if (this.plugin.settings.pexelsApiKey?.trim()) void runSearch();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ─── Emoji & Icon Picker Modal ─── */

const COMMON_EMOJIS = [
  "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊",
  "😇","🥰","😍","🤩","😘","😋","😛","😜","🤪","😎",
  "🤓","🧐","🤔","🤗","🤭","🤫","🤥","😶","😏","😒",
  "🙄","😬","😮‍💨","😌","😔","😪","🤤","😴","😷","🤒",
  "🤕","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","😈",
  "👻","💀","☠️","👽","🤖","🎃","👋","✋","🖐️","🤚",
  "👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👍",
  "👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤝",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔",
  "💕","💞","💓","💗","💖","💘","💝","💟","⭐","🌟",
  "✨","⚡","🔥","💥","🌈","☀️","🌤️","⛅","🌧️","❄️",
  "🎯","🎪","🎭","🎨","🎬","🎤","🎧","🎵","🎶","🎹",
  "🎸","🎺","🥁","🎲","♟️","🎮","🕹️","🧩","🎰","🏆",
  "🥇","🥈","🥉","🏅","🎖️","📚","📖","📝","✏️","🖊️",
  "📌","📎","🔗","📁","📂","🗂️","📊","📈","📉","🗒️",
  "💻","🖥️","⌨️","🖱️","💾","💿","📱","☎️","📡","🔋",
  "🔬","🔭","🧪","🧫","🧬","💊","💉","🩺","🩻","🏥",
  "🏠","🏢","🏗️","🏭","🏛️","⛪","🕌","🕍","🛕","⛩️",
  "🚀","✈️","🚁","🛸","🚂","🚗","🚕","🚌","🚎","🏎️",
  "🌍","🌎","🌏","🗺️","🧭","🏔️","⛰️","🌋","🗻","🏕️",
  "🌲","🌳","🌴","🌵","🌾","🌿","☘️","🍀","🍁","🍂",
  "🍎","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🍑",
  "☕","🍵","🧃","🍺","🍷","🍸","🧋","🥤","🍩","🍪",
  "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
];

class IconPickerModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.activeTab = "emoji";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cover-banner-icon-picker");

    this.modalEl.style.width = "440px";

    // Tab bar
    const tabBar = contentEl.createDiv({ cls: "cb-icon-picker__tabs" });
    const emojiTab = tabBar.createEl("button", { text: "Emoji", cls: "cb-icon-picker__tab is-active" });
    const iconsTab = tabBar.createEl("button", { text: "Icons", cls: "cb-icon-picker__tab" });

    const body = contentEl.createDiv({ cls: "cb-icon-picker__body" });

    const setActiveTab = (tab) => {
      this.activeTab = tab;
      emojiTab.toggleClass("is-active", tab === "emoji");
      iconsTab.toggleClass("is-active", tab === "icons");
      body.empty();
      if (tab === "emoji") this.renderEmojiTab(body);
      else this.renderIconsTab(body);
    };

    emojiTab.addEventListener("click", () => setActiveTab("emoji"));
    iconsTab.addEventListener("click", () => setActiveTab("icons"));

    // Clear button
    const footer = contentEl.createDiv({ cls: "cb-icon-picker__footer" });
    const clearBtn = footer.createEl("button", { text: "Clear note icon", cls: "cb-icon-picker__clear" });
    clearBtn.addEventListener("click", async () => {
      await this.plugin.setFaviconField(this.file, "", { allowEmpty: true });
      this.plugin.requestRefresh();
      this.close();
    });

    setActiveTab("emoji");
  }

  renderEmojiTab(container) {
    const filter = container.createEl("input", {
      type: "text",
      placeholder: "Filter emojis…",
      cls: "cb-icon-picker__search",
    });

    const grid = container.createDiv({ cls: "cb-icon-picker__emoji-grid" });

    const renderEmojis = (term) => {
      grid.empty();
      const lc = term.toLowerCase();
      const list = lc ? COMMON_EMOJIS.filter(e => e.includes(lc)) : COMMON_EMOJIS;
      for (const emoji of list) {
        const cell = grid.createDiv({ cls: "cb-icon-picker__emoji-cell", text: emoji });
        cell.addEventListener("click", async () => {
          await this.plugin.setFaviconField(this.file, emoji);
          this.plugin.requestRefresh();
          this.close();
        });
      }
      if (list.length === 0) {
        grid.createDiv({ cls: "cb-icon-picker__empty", text: "No matches" });
      }
    };

    filter.addEventListener("input", () => renderEmojis(filter.value.trim()));
    renderEmojis("");
    setTimeout(() => filter.focus(), 50);
  }

  renderIconsTab(container) {
    const row = container.createDiv({ cls: "cb-icon-picker__search-row" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "Search Boxicons…",
      cls: "cb-icon-picker__search",
    });
    const searchBtn = row.createEl("button", { text: "Search" });

    const grid = container.createDiv({ cls: "cb-icon-picker__icon-grid" });
    const status = container.createDiv({ cls: "cb-icon-picker__status" });

    const doSearch = async () => {
      const term = input.value.trim();
      if (!term) return;
      grid.empty();
      status.textContent = "Searching…";

      try {
        const res = await requestUrl({
          url: `https://api.iconify.design/search?query=${encodeURIComponent(term)}&prefix=bx&limit=60`,
        });
        const data = JSON.parse(res.text);
        const icons = data.icons || [];
        status.textContent = icons.length ? `${icons.length} icons found` : "No icons found";

        for (const fullName of icons) {
          const parts = fullName.split(":");
          const prefix = parts[0];
          const name = parts[1];
          const cell = grid.createDiv({ cls: "cb-icon-picker__icon-cell" });
          // Load SVG inline
          requestUrl({ url: `https://api.iconify.design/${prefix}/${name}.svg` })
            .then(r => { cell.innerHTML = r.text; })
            .catch(() => { cell.textContent = "?"; });

          cell.addEventListener("click", async () => {
            await this.plugin.setFaviconField(this.file, `iconify:${fullName}`);
            this.plugin.requestRefresh();
            this.close();
          });
        }
      } catch (err) {
        status.textContent = "Search failed — check your connection";
      }
    };

    searchBtn.addEventListener("click", doSearch);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") doSearch();
    });
    setTimeout(() => input.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CoverBannerDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Cinematic Covers";
  }

  getIcon() {
    return TOOL_ICON;
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    // nothing
  }

  render() {
    const scrollTop = this.contentEl.querySelector(".cover-banner-dashboard")?.scrollTop || 0;
    this.containerEl.addClass("cover-banner-dashboard-view");
    this.contentEl.empty();
    this.contentEl.addClass("cover-banner-dashboard-host");
    const el = this.contentEl.createDiv({ cls: "cover-banner-dashboard" });
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Cover and reading settings");

    const header = el.createDiv({ cls: "cover-banner-dashboard__header" });
    header.createEl("h3", { text: "Cinematic Covers" });
    header.createDiv({ text: "Covers, fonts, and note styling.", cls: "cover-banner-dashboard__sub" });

    const file = this.plugin.getCurrentMarkdownFile();
    const fileName = file?.basename || "(no note selected)";
    header.createDiv({ text: fileName, cls: "cover-banner-dashboard__sub" });

    const actions = el.createDiv({ cls: "cover-banner-dashboard__actions" });

    const mkBtn = (icon, label, onClick) => {
      const b = actions.createEl("button", { cls: "cover-banner-dashboard__action", attr: { type: "button", "aria-label": label, title: label } });
      setIcon(b, icon);
      b.addEventListener("click", onClick);
      return b;
    };

    mkBtn("wand-sparkles", "Auto-set banner (URL/Book)", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      const ok = await this.plugin.autoSetForFile(f, { force: true, createEmptyOnFail: true });
      new Notice(ok ? "Cinematic Covers: banner set" : "Cinematic Covers: no banner found");
      this.plugin.requestRefresh();
      this.render();
    });

    mkBtn("image-plus", "Pick a banner…", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      new PexelsPickerModal(this.app, this.plugin, f).open();
    });

    mkBtn("eraser", "Clear invalid banner field", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      const cleared = await this.plugin.clearInvalidPrimaryField(f);
      new Notice(cleared ? "Cleared invalid banner field" : "Nothing to clear");
      this.plugin.requestRefresh();
      this.render();
    });

    // note icon row
    const iconRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    iconRow.createDiv({ text: "Note icon", cls: "cover-banner-dashboard__label" });
    const iconInput = iconRow.createEl("input", { type: "text" });
    iconInput.placeholder = "📝, iconify:bx:bxs-flask, or https://...ico";
    iconInput.value = this.plugin.getFaviconValueForActive() || this.plugin.settings.defaultFavicon || "📝";
    const iconSave = iconRow.createEl("button", { text: "Set" });
    const iconClear = iconRow.createEl("button", { text: "Clear" });
    iconSave.addEventListener("click", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      await this.plugin.setFaviconField(f, iconInput.value.trim());
      this.plugin.requestRefresh();
    });
    iconClear.addEventListener("click", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      await this.plugin.setFaviconField(f, "", { allowEmpty: true });
      iconInput.value = "";
      this.plugin.requestRefresh();
    });

    // Settings panel
    el.createEl("hr");
    el.createEl("h4", { text: "Appearance" });

    const addRange = (label, min, max, step, getVal, setVal) => {
      const row = el.createDiv({ cls: "cover-banner-dashboard__row" });
      row.createDiv({ text: label, cls: "cover-banner-dashboard__label" });
      const input = row.createEl("input", { type: "range" });
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(getVal());
      const val = row.createDiv({ text: String(getVal()), cls: "cover-banner-dashboard__value" });
      input.addEventListener("input", async () => {
        val.setText(input.value);
        await setVal(Number(input.value));
        this.plugin.requestRefresh();
      });
    };

    addRange("Height", 120, 520, 10, () => this.plugin.settings.heightPx, async (n) => {
      this.plugin.settings.heightPx = Math.round(n);
      await this.plugin.saveSettings();
    });

    addRange("Dim", 0, 0.8, 0.05, () => this.plugin.settings.dim, async (n) => {
      this.plugin.settings.dim = Math.max(0, Math.min(1, n));
      await this.plugin.saveSettings();
    });

    addRange("Radius", 0, 40, 1, () => this.plugin.settings.borderRadiusPx, async (n) => {
      this.plugin.settings.borderRadiusPx = Math.round(n);
      await this.plugin.saveSettings();
    });

    const fadeRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    fadeRow.createDiv({ text: "Bottom fade", cls: "cover-banner-dashboard__label" });
    const fadeToggle = fadeRow.createEl("input", { type: "checkbox" });
    fadeToggle.checked = !!this.plugin.settings.fadeBottom;
    fadeToggle.addEventListener("change", async () => {
      this.plugin.settings.fadeBottom = !!fadeToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const pinRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    pinRow.createDiv({ text: "Sticky (pin)", cls: "cover-banner-dashboard__label" });
    const pinToggle = pinRow.createEl("input", { type: "checkbox" });
    pinToggle.checked = !!this.plugin.settings.pinBanner;
    pinToggle.addEventListener("change", async () => {
      this.plugin.settings.pinBanner = !!pinToggle.checked;
      await this.plugin.saveSettings();
      new Notice(`Cinematic Covers: pinBanner = ${this.plugin.settings.pinBanner ? "ON" : "OFF"}`);
      this.plugin.refreshAllViewBanners();
      this.plugin.refreshDashboard();
    });

    const parRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    parRow.createDiv({ text: "Parallax", cls: "cover-banner-dashboard__label" });
    const parToggle = parRow.createEl("input", { type: "checkbox" });
    parToggle.checked = !!this.plugin.settings.parallaxEnabled;
    parToggle.addEventListener("change", async () => {
      this.plugin.settings.parallaxEnabled = !!parToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    addRange("Parallax strength", 0, 1, 0.05, () => this.plugin.settings.parallaxStrength ?? 0.35, async (n) => {
      this.plugin.settings.parallaxStrength = Math.max(0, Math.min(1, n));
      await this.plugin.saveSettings();
    });

    const btnRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    btnRow.createDiv({ text: "Banner buttons", cls: "cover-banner-dashboard__label" });
    const btnToggle = btnRow.createEl("input", { type: "checkbox" });
    btnToggle.checked = !!this.plugin.settings.showBannerButtons;
    btnToggle.addEventListener("change", async () => {
      this.plugin.settings.showBannerButtons = !!btnToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const propertiesRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    propertiesRow.createDiv({ text: "Hide properties", cls: "cover-banner-dashboard__label" });
    const propertiesToggle = propertiesRow.createEl("input", { type: "checkbox" });
    propertiesToggle.checked = !!this.plugin.settings.hideProperties;
    propertiesToggle.addEventListener("change", async () => {
      this.plugin.settings.hideProperties = !!propertiesToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const titleRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    titleRow.createDiv({ text: "Hide title", cls: "cover-banner-dashboard__label" });
    const titleToggle = titleRow.createEl("input", { type: "checkbox" });
    titleToggle.checked = !!this.plugin.settings.hideTitle;
    titleToggle.addEventListener("change", async () => {
      this.plugin.settings.hideTitle = !!titleToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const markdownRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    markdownRow.createDiv({ text: "Enhanced Markdown", cls: "cover-banner-dashboard__label" });
    const markdownToggle = markdownRow.createEl("input", { type: "checkbox" });
    markdownToggle.checked = !!this.plugin.settings.enhancedMarkdown;
    markdownToggle.addEventListener("change", async () => {
      this.plugin.settings.enhancedMarkdown = !!markdownToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const chatRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    chatRow.createDiv({ text: "AI chat formatting", cls: "cover-banner-dashboard__label" });
    const chatToggle = chatRow.createEl("input", { type: "checkbox" });
    chatToggle.checked = !!this.plugin.settings.formatAiChats;
    chatToggle.addEventListener("change", async () => {
      this.plugin.settings.formatAiChats = !!chatToggle.checked;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const fontRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    fontRow.createDiv({ text: "Content font", cls: "cover-banner-dashboard__label" });
    const fontSelect = fontRow.createEl("select");
    for (const [value, preset] of Object.entries(CONTENT_FONT_PRESETS)) {
      const option = fontRow.ownerDocument.createElement("option");
      option.value = value;
      option.text = preset.label;
      option.selected = (this.plugin.settings.contentFont || "inter") === value;
      fontSelect.appendChild(option);
    }
    fontSelect.addEventListener("change", async () => {
      this.plugin.settings.contentFont = fontSelect.value;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    addRange("Font size (px)", 12, 32, 1, () => normalizeFontSize(this.plugin.settings.contentFontSize), async (value) => {
      this.plugin.settings.contentFontSize = normalizeFontSize(value);
      await this.plugin.saveSettings();
    });

    const codeFontRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    codeFontRow.createDiv({ text: "Code font", cls: "cover-banner-dashboard__label" });
    const codeFontSelect = codeFontRow.createEl("select");
    for (const [value, preset] of Object.entries(CODE_FONT_PRESETS)) {
      const option = codeFontRow.ownerDocument.createElement("option");
      option.value = value;
      option.text = codeFontLabel(preset);
      option.selected = (this.plugin.settings.codeFont || "theme") === value;
      codeFontSelect.appendChild(option);
    }
    codeFontSelect.addEventListener("change", async () => {
      this.plugin.settings.codeFont = codeFontSelect.value;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    const templateRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    templateRow.createDiv({ text: "Reading template", cls: "cover-banner-dashboard__label" });
    const templateSelect = templateRow.createEl("select");
    for (const [value, preset] of Object.entries(READING_TEMPLATE_PRESETS)) {
      const option = templateRow.ownerDocument.createElement("option");
      option.value = value;
      option.text = preset.label;
      option.selected = (this.plugin.settings.readingTemplate || "balanced") === value;
      templateSelect.appendChild(option);
    }
    templateSelect.addEventListener("change", async () => {
      this.plugin.settings.readingTemplate = templateSelect.value;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });
    const templateHelp = el.createDiv({ cls: "cover-banner-dashboard__hint" });
    const updateTemplateHelp = () => {
      const preset = READING_TEMPLATE_PRESETS[templateSelect.value] || READING_TEMPLATE_PRESETS.balanced;
      templateHelp.setText(preset.description);
    };
    templateSelect.addEventListener("change", updateTemplateHelp);
    updateTemplateHelp();

    const fitRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    fitRow.createDiv({ text: "Fit", cls: "cover-banner-dashboard__label" });
    const fit = fitRow.createEl("select");
    for (const opt of ["cover", "contain", "fill", "scale-down", "none"]) {
      const o = fitRow.ownerDocument.createElement("option");
      o.value = opt;
      o.text = opt;
      if (this.plugin.settings.objectFit === opt) o.selected = true;
      fit.appendChild(o);
    }
    fit.addEventListener("change", async () => {
      this.plugin.settings.objectFit = fit.value;
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    el.createEl("h4", { text: "Defaults" });
    const defRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    defRow.createDiv({ text: "Default banner", cls: "cover-banner-dashboard__label" });
    const defInput = defRow.createEl("input", { type: "text" });
    defInput.placeholder = "[[path/to/default.jpg]]";
    defInput.value = this.plugin.settings.defaultBanner || "";
    defInput.addEventListener("change", async () => {
      this.plugin.settings.defaultBanner = defInput.value.trim();
      await this.plugin.saveSettings();
      this.plugin.requestRefresh();
    });

    el.createEl("h4", { text: "Pexels" });
    const keyRow = el.createDiv({ cls: "cover-banner-dashboard__row" });
    keyRow.createDiv({ text: "API key", cls: "cover-banner-dashboard__label" });
    const keyInput = keyRow.createEl("input", { type: "password" });
    keyInput.value = this.plugin.settings.pexelsApiKey || "";
    keyInput.placeholder = "Pexels API key";
    keyInput.addEventListener("change", async () => {
      this.plugin.settings.pexelsApiKey = keyInput.value;
      await this.plugin.saveSettings();
      new Notice("Cinematic Covers: saved Pexels key");
    });
    el.scrollTop = scrollTop;
  }
}

module.exports = class CoverBannerPlugin extends Plugin {
  async onload() {
    addIcon(TOOL_ICON, TOOL_ICON_SVG);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    let didMigrate = false;
    const fontSize = normalizeFontSize(this.settings.contentFontSize);
    if (fontSize !== this.settings.contentFontSize) {
      this.settings.contentFontSize = fontSize;
      didMigrate = true;
    }

    // normalize boolean settings that might have been serialized oddly
    const boolFields = [
      "autoUpdateEnabled",
      "pinBanner",
      "parallaxEnabled",
      "showBannerButtons",
      "hideProperties",
      "hideTitle",
      "enhancedMarkdown",
      "formatAiChats",
      "fadeBottom",
      "autoSetEnabled",
      "autoSetOnOpen"
    ];
    for (const key of boolFields) {
      const normalized = coerceBoolean(this.settings[key], DEFAULT_SETTINGS[key]);
      if (this.settings[key] !== normalized) {
        this.settings[key] = normalized;
        didMigrate = true;
      }
    }

    if (!CODE_FONT_PRESETS[this.settings.codeFont]) {
      this.settings.codeFont = DEFAULT_SETTINGS.codeFont;
      didMigrate = true;
    }

    if (!CONTENT_FONT_PRESETS[this.settings.contentFont]) {
      this.settings.contentFont = DEFAULT_SETTINGS.contentFont;
      didMigrate = true;
    }

    if (!READING_TEMPLATE_PRESETS[this.settings.readingTemplate]) {
      this.settings.readingTemplate = DEFAULT_SETTINGS.readingTemplate;
      didMigrate = true;
    }

    // migrate older settings
    if (!Array.isArray(this.settings.fieldFallbacks)) {
      this.settings.fieldFallbacks = [this.settings.fieldFallback || "banner", "cover"].filter(Boolean);
      didMigrate = true;
    }
    delete this.settings.fieldFallback;

    // migrate to `cover` as primary banner field (your preferred convention)
    // If user never explicitly changed it, we switch it.
    if (!this.settings.fieldPrimary || this.settings.fieldPrimary === "coverFilename") {
      this.settings.fieldPrimary = "cover";
      didMigrate = true;
    }
    // ensure legacy field is still recognized
    if (Array.isArray(this.settings.fieldFallbacks) && !this.settings.fieldFallbacks.includes("coverFilename")) {
      this.settings.fieldFallbacks.unshift("coverFilename");
      didMigrate = true;
    }
    // if old fallbacks included `cover` (common earlier default), remove it to avoid redundancy
    if (Array.isArray(this.settings.fieldFallbacks) && this.settings.fieldFallbacks.includes("cover")) {
      this.settings.fieldFallbacks = this.settings.fieldFallbacks.filter((k) => k !== "cover");
      didMigrate = true;
    }

    // migrate old icon field name to faviconField
    if (!this.settings.faviconField) {
      this.settings.faviconField = this.settings.iconField || "favicon";
      didMigrate = true;
    }
    delete this.settings.iconField;

    if (!normalizeFieldValue(this.settings.defaultFavicon)) {
      this.settings.defaultFavicon = "📝";
      didMigrate = true;
    }

    if (didMigrate) {
      // persist migration so data.json reflects the active settings
      await this.saveData(this.settings);
      new Notice("Cinematic Covers: migrated settings (primary field = cover)");
      console.log("CoverBanner: migrated settings", this.settings);
    }

    this._autoSetCount = 0;
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoUpdateEnabled) void this.checkForUpdates();
    });
    this.registerInterval(setInterval(() => {
      if (this.settings.autoUpdateEnabled) void this.checkForUpdates();
    }, 6 * 60 * 60 * 1000));
    this.addCommand({ id: "check-for-updates", name: "Check for plugin updates", callback: () => this.checkForUpdates(true) });

    // Parallax bookkeeping (view-content el -> { banner, onScroll })
    this._parallaxMap = new WeakMap();

    // register dashboard view
    this.registerView(VIEW_TYPE, (leaf) => new CoverBannerDashboardView(leaf, this));

    // SINGLE ribbon icon: open dashboard
    this.addRibbonIcon(TOOL_ICON, "Cinematic Covers dashboard", async () => {
      await this.openDashboard();
    });

    // keep settings tab (optional; dashboard is primary UX)
    this.addSettingTab(new CoverBannerSettingTab(this.app, this));

    // debounced refresh for banners
    this._refreshDebounced = debounce(() => this.refreshAllViewBanners(), 200, true);

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this._refreshDebounced();
      this.refreshDashboard();
    }));
    // Some Obsidian versions replace note-view content during layout changes.
    // Reapply presentation classes after that replacement so the hide options
    // remain effective across desktop versions and workspace restores.
    this.registerEvent(this.app.workspace.on("layout-change", () => this._refreshDebounced()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this._refreshDebounced()));

    this.app.workspace.onLayoutReady(() => this.requestRefresh());
    this.registerEvent(this.app.workspace.on("file-open", () => this._refreshDebounced()));
    this.registerMarkdownPostProcessor(() => this._refreshDebounced());

    // Commands (also accessible via dashboard buttons)
    this.addCommand({
      id: "cover-banner-open-dashboard",
      name: "Open dashboard",
      callback: () => this.openDashboard()
    });

    this.addCommand({
      id: "cover-banner-pexels-picker",
      name: "Pick a banner…",
      callback: async () => {
        const file = this.getCurrentMarkdownFile();
        if (!looksLikeMarkdownFile(file)) {
          new Notice("Cinematic Covers: no active note");
          return;
        }
        new PexelsPickerModal(this.app, this, file).open();
      }
    });

    this.addCommand({
      id: "cover-banner-autoset",
      name: "Auto-set banner (URL/Book)",
      callback: async () => {
        const file = this.getCurrentMarkdownFile();
        if (!looksLikeMarkdownFile(file)) {
          new Notice("Cinematic Covers: no active note");
          return;
        }
        const ok = await this.autoSetForFile(file, { force: true, createEmptyOnFail: true });
        new Notice(ok ? "Cinematic Covers: banner set" : "Cinematic Covers: no banner found");
        this.requestRefresh();
      }
    });

    this.addCommand({
      id: "cover-banner-clear-invalid",
      name: "Clear invalid banner field (if not an image)",
      callback: async () => {
        const file = this.getCurrentMarkdownFile();
        if (!looksLikeMarkdownFile(file)) {
          new Notice("Cinematic Covers: no active note");
          return;
        }
        const cleared = await this.clearInvalidPrimaryField(file);
        new Notice(cleared ? `Cinematic Covers: cleared ${this.settings.fieldPrimary}` : "Cinematic Covers: nothing to clear");
        this.requestRefresh();
      }
    });

    // Auto-set on open
    this._maybeAutoSetDebounced = debounce(() => this.maybeAutoSetForActiveFile(), 900, true);
    if (this.settings.autoSetEnabled && this.settings.autoSetOnOpen) {
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => this._maybeAutoSetDebounced()));
    }
  }

  onunload() {
    // best-effort: detach dashboard leaves
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.detach());
  }

  async checkForUpdates(manual = false) {
    if (this._updating) return;
    this._updating = true;
    try {
      const dir = this.manifest.dir;
      if (!dir) throw new Error("Plugin installation folder is unavailable.");
      const adapter = this.app.vault.adapter;
      // Read the installed manifest: a downloaded update may be awaiting restart.
      const installed = JSON.parse(await adapter.read(`${dir}/manifest.json`));
      const response = await requestUrl({ url: "https://api.github.com/repos/frimpsjoek/cover-banner/releases/latest", headers: { Accept: "application/vnd.github+json" } });
      const release = response.json;
      if (release.draft || release.prerelease) throw new Error("No stable release available.");
      const version = String(release.tag_name || "").replace(/^v/, "");
      const parts = value => {
        if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error("Invalid release version.");
        return value.split(".").map(Number);
      };
      const newer = (a, b) => {
        const x = parts(a), y = parts(b);
        for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
        return false;
      };
      if (!newer(version, installed.version)) {
        if (manual) new Notice(installed.version !== this.manifest.version
          ? "Cinematic Covers: update installed. Restart Obsidian to finish."
          : "Cinematic Covers is up to date.");
        return;
      }
      const names = ["main.js", "styles.css", "manifest.json"];
      const files = {};
      for (const name of names) {
        const asset = release.assets?.find(a => a.name === name);
        const prefix = "https://github.com/frimpsjoek/cover-banner/releases/download/";
        if (!asset?.browser_download_url?.startsWith(prefix)) throw new Error(`Release is missing ${name}.`);
        const result = await requestUrl({ url: asset.browser_download_url });
        if (!result.text?.trim()) throw new Error(`Downloaded ${name} is empty.`);
        files[name] = result.text;
      }
      const manifest = JSON.parse(files["manifest.json"]);
      if (manifest.id !== this.manifest.id || manifest.version !== version) throw new Error("Release manifest does not match this plugin.");
      if (manifest.minAppVersion && newer(manifest.minAppVersion, obsidian.apiVersion)) throw new Error("Update Obsidian before installing this plugin release.");
      // Download and validate everything first. Back up before replacing any file.
      const backups = {};
      for (const name of names) backups[name] = await adapter.read(`${dir}/${name}`);
      for (const name of names) await adapter.write(`${dir}/${name}.update-backup`, backups[name]);
      const changed = [];
      try {
        for (const name of names) {
          changed.push(name);
          await adapter.write(`${dir}/${name}`, files[name]);
        }
      } catch (error) {
        const failures = [];
        for (const name of changed.reverse()) {
          try { await adapter.write(`${dir}/${name}`, backups[name]); }
          catch { failures.push(name); }
        }
        if (failures.length) throw new Error(`Restore ${failures.join(", ")} from the .update-backup files in the plugin folder.`);
        throw error;
      }
      new Notice(`Cinematic Covers ${version} installed. Restart Obsidian to finish updating.`, 15000);
    } catch (error) {
      console.error("Cinematic Covers update failed", error);
      if (manual) new Notice(`Cinematic Covers: update failed. ${error.message}`, 10000);
    } finally {
      this._updating = false;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  requestRefresh() {
    this.refreshAllViewBanners();
  }

  refreshAllViewBanners() {
    const leaves = this.getMarkdownLeaves();
    for (const leaf of leaves) this.refreshViewBannerForLeaf(leaf);
  }

  decorateAiChatBlocks(root) {
    root.querySelectorAll(".cover-banner-ai-message").forEach((el) => {
      el.classList.remove("cover-banner-ai-message", "cover-banner-ai-system", "cover-banner-ai-developer", "cover-banner-ai-user", "cover-banner-ai-assistant", "cover-banner-ai-tool");
      delete el.dataset.coverBannerAiRole;
    });

    const rolePattern = /^\s*(?:\*\*|__)?\s*(system|developer|user|assistant|tool)\s*:?(?:\*\*|__)?(?:\s|$)/i;
    const candidates = root.querySelectorAll(
      ".markdown-preview-view p, .markdown-preview-view li, .markdown-preview-view blockquote, " +
      "[data-message-author-role], [data-role]"
    );

    candidates.forEach((el) => {
      const explicitRole = el.getAttribute("data-message-author-role") || el.getAttribute("data-role");
      const text = String(el.textContent || "");
      const match = explicitRole
        ? [null, explicitRole]
        : text.match(rolePattern);
      const role = String(match?.[1] || "").toLowerCase();
      if (!["system", "developer", "user", "assistant", "tool"].includes(role)) return;

      el.classList.add("cover-banner-ai-message", `cover-banner-ai-${role}`);
      el.dataset.coverBannerAiRole = role;
    });
  }

  async openDashboard() {
    this._dashboardFile = this.getCurrentMarkdownFile();
    // Open a full tab on mobile so controls have usable screen space.
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = obsidian.Platform?.isMobile
      ? this.app.workspace.getLeaf(true)
      : this.app.workspace.getRightLeaf(false);
    if (!leaf) leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshDashboard() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view && typeof view.render === "function") {
      view.render();
    }
  }

  getActiveFile() {
    return this.app.workspace.getActiveFile?.();
  }

  getMarkdownLeaves() {
    return (this.app.workspace.getLeavesOfType?.("markdown") || []).filter((leaf) => this.isMarkdownLeaf(leaf));
  }

  isMarkdownLeaf(leaf) {
    const view = leaf?.view;
    const file = view?.file;
    if (!looksLikeMarkdownFile(file)) return false;
    if (typeof view?.getViewType === "function" && view.getViewType() !== "markdown") return false;
    return true;
  }

  getActiveMarkdownLeaf() {
    const ws = this.app.workspace;
    const activeLeaf = ws.getActiveLeaf?.();
    if (this.isMarkdownLeaf(activeLeaf)) return activeLeaf;

    const activeFile = this.getActiveFile();
    if (looksLikeMarkdownFile(activeFile)) {
      const sameFileLeaf = (ws.getLeavesOfType?.("markdown") || []).find((leaf) => {
        return leaf?.view?.file?.path === activeFile.path;
      });
      if (this.isMarkdownLeaf(sameFileLeaf)) return sameFileLeaf;
    }

    const fallback = (ws.getLeavesOfType?.("markdown") || []).find((leaf) => this.isMarkdownLeaf(leaf));
    return fallback || null;
  }

  getCurrentMarkdownFile() {
    const active = this.getActiveFile();
    if (looksLikeMarkdownFile(active)) return active;
    if (looksLikeMarkdownFile(this._dashboardFile)) return this._dashboardFile;
    const leaf = this.getActiveMarkdownLeaf();
    const file = leaf?.view?.file;
    if (looksLikeMarkdownFile(file)) return file;
    return null;
  }

  getFrontmatterForFile(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter || null;
  }

  getFrontmatterSafe(file) {
    return this.getFrontmatterForFile(file) || {};
  }

  getBannerValueFromFrontmatter(fm) {
    const primary = normalizeFieldValue(fm?.[this.settings.fieldPrimary]);
    if (primary) return primary;
    for (const key of this.settings.fieldFallbacks || []) {
      const v = normalizeFieldValue(fm?.[key]);
      if (v) return v;
    }
    return null;
  }

  getFaviconValueFromFrontmatter(fm) {
    return normalizeFieldValue(fm?.[this.settings.faviconField || "favicon"]) || null;
  }

  getFaviconValueForActive() {
    const file = this.getCurrentMarkdownFile();
    if (!looksLikeMarkdownFile(file)) return null;
    const fm = this.getFrontmatterSafe(file);
    return this.getFaviconValueFromFrontmatter(fm);
  }

  async setFaviconField(file, emoji, { allowEmpty = false } = {}) {
    const key = this.settings.faviconField || "favicon";
    const fallback = normalizeFieldValue(this.settings.defaultFavicon) || "📝";
    const normalized = normalizeFieldValue(emoji);
    const value = normalized || (allowEmpty ? "" : fallback);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[key] = value;
    });
  }

  findUrlInFrontmatter(fm) {
    if (!fm) return null;
    for (const k of this.settings.autoSetUrlFieldCandidates || []) {
      const s = normalizeFieldValue(fm[k]);
      if (s && isHttpUrl(s)) return s;
    }
    return null;
  }

  resolveBannerValueToSrc(file, value) {
    if (!value) return null;
    if (isHttpUrl(value)) {
      if (isLikelyFaviconOrIconValue(value)) return null;
      return value;
    }

    // normalize
    let v = String(value || "").trim();
    v = v.replace(/^\.\//, "");
    if (isLikelyFaviconOrIconValue(v)) return null;

    // Prefer direct-path lookup (works well for hidden folders like .attachments)
    // If the value is a real vault path, use it.
    const direct = this.app.vault.getAbstractFileByPath(v);
    if (direct && direct.path) {
      // Only allow images
      if (!IMAGE_EXT_RE.test(direct.path) || isLikelyFaviconOrIconValue(direct.path)) return null;
      return this.app.vault.getResourcePath(direct);
    }

    // Fallback: Obsidian link resolution
    // IMPORTANT: allow extensionless wikilinks like [[cover]] that resolve to cover.jpg
    const dest = this.app.metadataCache.getFirstLinkpathDest(v, file.path);
    if (dest) {
      if (!IMAGE_EXT_RE.test(dest.path) || isLikelyFaviconOrIconValue(dest.path)) return null;
      return this.app.vault.getResourcePath(dest);
    }

    // Last resort: construct a resource URL via the adapter directly.
    // This handles files in hidden folders (e.g. .attachments/) that may
    // not appear in the vault index or metadata cache.
    if (IMAGE_EXT_RE.test(v) && !isLikelyFaviconOrIconValue(v) && this.app.vault.adapter?.getResourcePath) {
      return this.app.vault.adapter.getResourcePath(v);
    }

    return null;
  }

  resolveNoteIconValueToSrc(file, value) {
    if (!value) return null;
    const raw = normalizeFieldValue(value);
    if (!raw) return null;
    if (isHttpUrl(raw)) return raw;
    if (!ICON_IMAGE_EXT_RE.test(raw) && !isLikelyFaviconOrIconValue(raw)) return null;

    let v = String(raw || "").trim();
    v = v.replace(/^\.\//, "");

    const direct = this.app.vault.getAbstractFileByPath(v);
    if (direct && direct.path) return this.app.vault.getResourcePath(direct);

    const dest = this.app.metadataCache.getFirstLinkpathDest(v, file.path);
    if (dest) return this.app.vault.getResourcePath(dest);

    if (this.app.vault.adapter?.getResourcePath) {
      return this.app.vault.adapter.getResourcePath(v);
    }

    return null;
  }

  refreshViewBannerForLeaf(leaf) {
    const view = leaf?.view;
    const file = view?.file;
    if (!looksLikeMarkdownFile(file)) return;

    const root = view.containerEl;
    if (!root) return;
    const document = root.ownerDocument;

    root.classList.toggle("cover-banner--hide-properties", !!this.settings.hideProperties);
    root.classList.toggle("cover-banner--hide-title", !!this.settings.hideTitle);
    root.classList.toggle("cover-banner--enhanced-markdown", !!this.settings.enhancedMarkdown);
    root.classList.toggle("cover-banner--content-font", true);
    for (const preset of Object.values(READING_TEMPLATE_PRESETS)) {
      root.classList.toggle(preset.className, false);
    }
    const template = READING_TEMPLATE_PRESETS[this.settings.readingTemplate] || READING_TEMPLATE_PRESETS.balanced;
    root.classList.add(template.className);
    root.style.setProperty("--cover-banner-content-font", getContentFontStack(this.settings.contentFont));
    root.style.setProperty("--cover-banner-code-font", getCodeFontStack(this.settings.codeFont));
    root.style.setProperty("--cover-banner-font-size", `${normalizeFontSize(this.settings.contentFontSize)}px`);
    if (this.settings.enhancedMarkdown && this.settings.formatAiChats) {
      this.decorateAiChatBlocks(root);
    } else {
      root.querySelectorAll(".cover-banner-ai-message").forEach((el) => {
        el.classList.remove("cover-banner-ai-message", "cover-banner-ai-system", "cover-banner-ai-developer", "cover-banner-ai-user", "cover-banner-ai-assistant", "cover-banner-ai-tool");
        delete el.dataset.coverBannerAiRole;
      });
    }

    // insert above properties
    const viewContent = root.querySelector(".view-content") || root;

    // Keep presentation state on the element that owns Obsidian's rendered
    // title, properties, and note content. Those elements can be created or
    // replaced after this refresh, so the CSS state must live above them.
    viewContent.classList.toggle("cover-banner--hide-title", !!this.settings.hideTitle);
    viewContent.classList.toggle("cover-banner--hide-properties", !!this.settings.hideProperties);

    const fm = this.getFrontmatterSafe(file);
    const rawValue = this.getBannerValueFromFrontmatter(fm) || normalizeFieldValue(this.settings.defaultBanner);
    const src = this.resolveBannerValueToSrc(file, rawValue);
    const renderKey = JSON.stringify([file.path, src, this.getFaviconValueFromFrontmatter(fm),
      ...["heightPx", "dim", "borderRadiusPx", "objectFit", "fadeBottom", "pinBanner",
        "showBannerButtons", "parallaxEnabled", "parallaxStrength", "defaultFavicon"].map(key => this.settings[key])]);
    viewContent.querySelectorAll(".cover-banner__properties-hidden").forEach(el => {
      el.classList.toggle("cover-banner__properties-hidden", !!this.settings.hideProperties);
    });
    const existingBanner = viewContent.querySelector(".cover-banner");
    if (existingBanner?._renderKey === renderKey) return;

    // cleanup old parallax handler for this scroll container (if any)
    try {
      const prev = this._parallaxMap?.get(viewContent);
      if (prev?.onScroll) {
        const target = prev.scrollTarget || viewContent;
        target.removeEventListener("scroll", prev.onScroll);
        if (target !== document) document.removeEventListener("scroll", prev.onScroll);
      }
      if (prev?.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(prev.raf);
    } catch {}

    // remove existing banners
    root.querySelectorAll(".cover-banner").forEach((el) => {
      if (typeof el._scrollAwayCleanup === "function") el._scrollAwayCleanup();
      el.remove();
    });

    const isPinned = coerceBoolean(this.settings.pinBanner, false);
    const showBannerButtons = coerceBoolean(this.settings.showBannerButtons, true);

    viewContent.querySelectorAll(
      ".metadata-container, .metadata-properties, .markdown-properties, [data-type=\"properties\"]"
    ).forEach((props) => {
      props.classList.toggle("cover-banner__properties-hidden", !!this.settings.hideProperties);
    });

    const banner = document.createElement("div");
    banner.className = "cover-banner";
    banner._renderKey = renderKey;
    banner.style.setProperty("--cover-banner-height", `${this.settings.heightPx}px`);
    banner.style.setProperty("--cover-banner-dim", String(this.settings.dim));
    banner.style.setProperty("--cover-banner-radius", `${this.settings.borderRadiusPx}px`);
    banner.style.setProperty("--cover-banner-fit", this.settings.objectFit || "cover");
    banner.toggleAttribute("data-fade", !!this.settings.fadeBottom);
    banner.classList.toggle("cover-banner--pinned", isPinned);
    if (isPinned) {
      banner.style.setProperty("position", "sticky");
      banner.style.setProperty("top", "0");
      banner.style.setProperty("z-index", "40");
    } else {
      banner.style.setProperty("position", "relative");
      banner.style.setProperty("top", "auto");
      banner.style.setProperty("z-index", "30");
    }

    let imgEl = null;
    if (src) {
      const img = document.createElement("img");
      img.className = "cover-banner__img";
      img.alt = "";
      img.decoding = "async";
      img.setAttribute("fetchpriority", "high");
      img.src = src;
      banner.appendChild(img);
      imgEl = img;
    } else {
      banner.classList.add("is-default");
    }

    // Notion-style icon row (bottom-right)
    if (showBannerButtons) {
      const actions = document.createElement("div");
      actions.className = "cover-banner__actions";

      const mkAction = (icon, label, onClick) => {
        const b = document.createElement("button");
        b.className = "cover-banner__action";
        b.type = "button";
        b.setAttr?.("aria-label", label);
        b.setAttribute("aria-label", label);
        setIcon(b, icon);
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onClick?.();
        });
        return b;
      };

      actions.appendChild(
        mkAction(TOOL_ICON, "Open Cinematic Covers dashboard", () => this.openDashboard())
      );

      actions.appendChild(
        mkAction("image", "Pick banner from Pexels", () => {
          const f = this.getCurrentMarkdownFile();
          if (!looksLikeMarkdownFile(f)) {
            new Notice("Cinematic Covers: no active note");
            return;
          }
          new PexelsPickerModal(this.app, this, f).open();
        })
      );

      actions.appendChild(
        mkAction("sparkles", "Auto-set banner", async () => {
          const f = this.getCurrentMarkdownFile();
          if (!looksLikeMarkdownFile(f)) {
            new Notice("Cinematic Covers: no active note");
            return;
          }
          const ok = await this.autoSetForFile(f, { force: true, createEmptyOnFail: true });
          new Notice(ok ? "Cinematic Covers: banner set" : "Cinematic Covers: no banner found");
          this.requestRefresh();
        })
      );

      actions.appendChild(
        mkAction("x-circle", "Clear invalid banner field", async () => {
          const f = this.getCurrentMarkdownFile();
          if (!looksLikeMarkdownFile(f)) {
            new Notice("Cinematic Covers: no active note");
            return;
          }
          const cleared = await this.clearInvalidPrimaryField(f);
          new Notice(cleared ? `Cinematic Covers: cleared ${this.settings.fieldPrimary}` : "Cinematic Covers: nothing to clear");
          this.requestRefresh();
        })
      );

      actions.appendChild(
        mkAction("pin", isPinned ? "Unpin banner" : "Pin banner", async () => {
          this.settings.pinBanner = !coerceBoolean(this.settings.pinBanner, false);
          await this.saveSettings();
          new Notice(`Cinematic Covers: pinBanner = ${this.settings.pinBanner ? "ON" : "OFF"}`);
          this.refreshAllViewBanners();
          this.refreshDashboard();
        })
      );

      actions.appendChild(
        mkAction("smile-plus", "Pick note emoji/icon", () => {
          const f = this.getCurrentMarkdownFile();
          if (!looksLikeMarkdownFile(f)) { new Notice("Cinematic Covers: no active note"); return; }
          new IconPickerModal(this.app, this, f).open();
        })
      );

      banner.appendChild(actions);
    }

    const favicon = this.getFaviconValueFromFrontmatter(fm) || normalizeFieldValue(this.settings.defaultFavicon);
    if (favicon) {
      const iconEl = document.createElement("div");
      iconEl.className = "cover-banner__icon";
      const fallbackIcon = normalizeFieldValue(this.settings.defaultFavicon) || "📝";
      const showFallbackIcon = () => {
        iconEl.empty?.();
        iconEl.textContent = fallbackIcon;
      };
      if (favicon.startsWith("iconify:")) {
        const rest = favicon.slice(8); // e.g. "bx:bxs-flask"
        const [prefix, name] = rest.split(":");
        requestUrl({ url: `https://api.iconify.design/${prefix}/${name}.svg` })
          .then(r => { iconEl.innerHTML = r.text; })
          .catch(showFallbackIcon);
      } else {
        const iconSrc = this.resolveNoteIconValueToSrc(file, favicon);
        if (iconSrc) {
          const img = document.createElement("img");
          img.className = "cover-banner__icon-img";
          img.alt = "";
          img.src = iconSrc;
          img.addEventListener("error", showFallbackIcon, { once: true });
          iconEl.appendChild(img);
        } else {
          iconEl.textContent = favicon;
        }
      }
      banner.appendChild(iconEl);
    }

    // Insert banner in viewContent (safe position — image always renders here)
    if (props && props.parentElement === viewContent) viewContent.insertBefore(banner, props);
    else viewContent.prepend(banner);

    // Find the VISIBLE inner scroll container (skip hidden/inactive views)
    const innerScroller = [
      viewContent.querySelector(".markdown-preview-view"),
      viewContent.querySelector(".cm-scroller")
    ].find(el => el && el.offsetHeight > 0) || null;

    // When NOT pinned, float the banner above the scroll container and
    // translate it upward in sync with the scroll so it scrolls away naturally.
    if (!isPinned && innerScroller) {
      const bannerH = Number(this.settings.heightPx) || 240;

      // Collapse the banner's flow space so the scroll container fills view-content
      banner.style.marginBottom = `-${bannerH}px`;

      // Reserve space at the top of the scroll container for the banner overlay
      const existingPadding = parseFloat(getComputedStyle(innerScroller).paddingTop) || 0;
      innerScroller.style.paddingTop = `${existingPadding + bannerH}px`;

      const onScrollAway = () => {
        const y = innerScroller.scrollTop || 0;
        const pull = Math.min(y, bannerH);
        const fade = Math.max(0, Math.min(1, pull / bannerH));
        if (pull <= 0) {
          banner.style.transform = "";
          banner.style.clipPath = "";
          banner.style.opacity = "";
          banner.style.visibility = "";
          banner.style.pointerEvents = "";
        } else if (pull >= bannerH) {
          banner.style.transform = `translateY(-${bannerH}px)`;
          banner.style.clipPath = "inset(100% 0 0 0)";
          banner.style.opacity = "0";
          banner.style.visibility = "hidden";
          banner.style.pointerEvents = "none";
        } else {
          banner.style.transform = `translateY(-${pull}px)`;
          banner.style.clipPath = `inset(${pull}px 0 0 0)`;
          // Let the banner recede as it moves away instead of disappearing
          // abruptly at the top edge.
          banner.style.opacity = String(1 - fade * 0.7);
          banner.style.visibility = "";
          banner.style.pointerEvents = "";
        }
      };
      innerScroller.addEventListener("scroll", onScrollAway, { passive: true });
      onScrollAway();

      banner._scrollAwayCleanup = () => {
        innerScroller.removeEventListener("scroll", onScrollAway);
        innerScroller.style.paddingTop = existingPadding > 0 ? `${existingPadding}px` : "";
      };
    }

    // Align the note icon closer to the text column start (Notion-like), not the far-left edge.
    const updateLayoutAnchors = () => {
      try {
        const candidates = [
          props || null,
          viewContent.querySelector(".markdown-preview-sizer"),
          viewContent.querySelector(".markdown-preview-view"),
          viewContent.querySelector(".markdown-source-view.mod-cm6 .cm-contentContainer"),
          viewContent.querySelector(".cm-contentContainer"),
          viewContent.querySelector(".cm-sizer")
        ].filter(Boolean);

        const contentAnchor = candidates.find((el) => el.getBoundingClientRect?.().width > 0);
        const bannerRect = banner.getBoundingClientRect();
        let left = 20;
        if (contentAnchor) {
          const anchorRect = contentAnchor.getBoundingClientRect();
          left = Math.max(16, Math.round(anchorRect.left - bannerRect.left + 8));
        } else {
          const css = getComputedStyle(viewContent);
          const lineWidth = Number.parseFloat(css.getPropertyValue("--file-line-width"));
          if (Number.isFinite(lineWidth) && lineWidth > 0 && bannerRect.width > lineWidth) {
            left = Math.max(16, Math.round((bannerRect.width - lineWidth) / 2 + 8));
          }
        }
        banner.style.setProperty("--cover-banner-content-left", `${left}px`);
      } catch {}
    };
    updateLayoutAnchors();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(updateLayoutAnchors);

    // Parallax effect: translate the image inside the banner based on scroll
    const scrollTarget = innerScroller || viewContent;
    if (this.settings.parallaxEnabled && imgEl && scrollTarget && typeof scrollTarget.addEventListener === "function") {
      let raf = 0;
      const bannerH = Number(this.settings.heightPx) || 240;
      const strength = Math.max(0, Math.min(1, Number(this.settings.parallaxStrength ?? 0.35)));
      // Keep the depth effect atmospheric instead of allowing the image to
      // visibly detach from the content while scrolling.
      const maxShift = Math.max(0, Math.round(bannerH * 0.22));

      // Make the image taller so translating it doesn't reveal empty space.
      imgEl.style.height = `calc(100% + ${maxShift}px)`;
      imgEl.style.willChange = "transform";

      const apply = () => {
        raf = 0;
        const y = scrollTarget.scrollTop || 0;
        const shift = Math.max(0, Math.min(maxShift, y * strength));
        imgEl.style.transform = `translate3d(0, ${-shift}px, 0)`;
      };

      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(apply);
      };

      scrollTarget.addEventListener("scroll", onScroll, { passive: true });

      // initial position
      apply();
      this._parallaxMap?.set(viewContent, { banner, onScroll, raf, scrollTarget });
    }
  }

  async refreshActiveViewBanner() {
    const leaf = this.getActiveMarkdownLeaf();
    if (!leaf) return;
    this.refreshViewBannerForLeaf(leaf);
  }

  async maybeAutoSetForActiveFile() {
    if (!this.settings.autoSetEnabled) return;
    if (this._autoSetCount >= this.settings.maxAutoSetPerSession) return;

    const file = this.getCurrentMarkdownFile();
    if (!looksLikeMarkdownFile(file)) return;

    const fm = this.getFrontmatterSafe(file);

    if (this.getBannerValueFromFrontmatter(fm)) return;

    const ok = await this.autoSetForFile(file, { force: false, createEmptyOnFail: false });
    if (ok) {
      this._autoSetCount++;
      this.requestRefresh();
    }
  }

  async autoSetForFile(file, { force, createEmptyOnFail }) {
    const fm = this.getFrontmatterSafe(file);
    if (!force && this.getBannerValueFromFrontmatter(fm)) return false;

    const url = this.findUrlInFrontmatter(fm);
    if (url) {
      const ok = await this.autoSetFromUrl(file, url);
      if (ok) return true;
    }

    const ok2 = await this.autoSetFromGoogleBooks(file);
    if (ok2) return true;

    // Ordinary notes often have no page URL and are not books. Always provide
    // a usable default rather than creating an empty cover field.
    const configured = normalizeFieldValue(this.settings.defaultBanner);
    if (configured && this.resolveBannerValueToSrc(file, configured)) {
      await this.setFrontmatterPrimary(file, configured);
      if (createEmptyOnFail) new Notice("No matching photo found; applied the default banner.");
      return true;
    }
    await ensureFolder(this.app, this.settings.bannerFolder);
    const path = `${this.settings.bannerFolder}/default-landscape.svg`;
    if (!await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.write(path, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#172c49"/><stop offset="1" stop-color="#a0bbbd"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h1600v600H0z"/><circle fill="#f8dda6" cx="1220" cy="150" r="65"/><path fill="#426775" d="m0 440 350-280 390 300 360-230 500 260v110H0z"/><path fill="#223f51" d="m0 550 450-220 430 230 400-240 320 160v120H0z"/></svg>');
    }
    await this.setFrontmatterPrimary(file, `[[${path}]]`);
    if (createEmptyOnFail) new Notice("No matching photo found; applied an offline landscape banner.");
    return true;
  }

  async ensurePrimaryFieldExists(file) {
    const key = this.settings.fieldPrimary || "coverFilename";
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (fm[key] === undefined) fm[key] = "";
    });
  }

  async autoSetFromUrl(file, pageUrl) {
    try {
      const res = await requestUrl({ url: pageUrl, method: "GET" });
      const type = res?.headers?.["content-type"] || res?.headers?.["Content-Type"] || "";
      if (/^image\//i.test(type)) {
        const link = await this.downloadImageToVault(pageUrl, file.basename);
        if (!link) return false;
        await this.setFrontmatterPrimary(file, link);
        return true;
      }
      const html = res?.text;
      if (!html) return false;

      const imgUrl = pickOgImage(html, pageUrl);
      if (!imgUrl) return false;

      const localLink = await this.downloadImageToVault(imgUrl, file.basename);
      if (!localLink) return false;

      await this.setFrontmatterPrimary(file, localLink);
      return true;
    } catch {
      return false;
    }
  }

  async autoSetFromGoogleBooks(file) {
    try {
      const title = file.basename;
      if (!title || title.length < 3) return false;

      const q = encodeURIComponent(`intitle:${title}`);
      const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books`;
      const res = await requestUrl({ url, method: "GET" });
      const data = res?.json;
      const items = data?.items;
      if (!Array.isArray(items) || items.length === 0) return false;

      let imageUrl = null;
      for (const it of items) {
        const links = it?.volumeInfo?.imageLinks;
        if (!links) continue;
        imageUrl = links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail || null;
        if (imageUrl) break;
      }
      if (!imageUrl) return false;

      imageUrl = imageUrl.replace(/^http:\/\//i, "https://");
      try {
        const u = new URL(imageUrl);
        if (u.searchParams.has("zoom")) u.searchParams.set("zoom", "2");
        imageUrl = u.toString();
      } catch {}

      const localLink = await this.downloadImageToVault(imageUrl, `book-${file.basename}`);
      if (!localLink) return false;

      await this.setFrontmatterPrimary(file, localLink);
      return true;
    } catch {
      return false;
    }
  }

  async downloadImageToVault(imageUrl, nameHint) {
    try {
      let r;
      try {
        r = await requestUrl({
          url: imageUrl,
          method: "GET",
          contentType: "arraybuffer",
          headers: {
            Accept: "image/*",
            "User-Agent": "Mozilla/5.0"
          }
        });
      } catch (e) {
        r = await requestUrl({
          url: imageUrl,
          method: "GET",
          headers: {
            Accept: "image/*",
            "User-Agent": "Mozilla/5.0"
          }
        });
      }

      const arrayBuffer = r?.arrayBuffer;
      const contentType = r?.headers?.["content-type"] || r?.headers?.["Content-Type"] || "";
      const status = r?.status;

      if ((status && (status < 200 || status >= 300)) || (contentType && !/^image\//i.test(contentType))) return null;

      if (!arrayBuffer) {
        console.error("CoverBanner: download missing arrayBuffer", { imageUrl, status, contentType, keys: r ? Object.keys(r) : null });
        new Notice(`Cinematic Covers: failed to download (status ${status ?? "?"})`);
        return null;
      }

      if (isLikelyFaviconOrIconValue(imageUrl) || isIconContentType(contentType)) {
        console.warn("CoverBanner: skipping favicon/icon image for banner", { imageUrl, contentType });
        return null;
      }

      const optimized = await optimizeBannerDownload(arrayBuffer, contentType);
      const ext = extFromContentType(optimized.contentType);
      try {
        await ensureFolder(this.app, this.settings.bannerFolder);
      } catch (e) {
        const msg = String(e?.message || e || "");
        if (!msg.toLowerCase().includes("already exists")) throw e;
      }

      const base = safeFilenameBase(nameHint);
      const stamp = Date.now().toString(36);
      const filename = `${base}-${stamp}${ext}`;
      const destPath = `${this.settings.bannerFolder}/${filename}`;

      const bytes = new Uint8Array(optimized.buffer);
      const existing = this.app.vault.getAbstractFileByPath(destPath);
      if (!existing) await this.app.vault.createBinary(destPath, bytes);

      return `[[${destPath}]]`;
    } catch (e) {
      console.error("CoverBanner: downloadImageToVault error", e);
      new Notice("Cinematic Covers: download error (see console)");
      return null;
    }
  }

  async setFrontmatterPrimary(file, wikilinkValue) {
    const key = this.settings.fieldPrimary || "coverFilename";
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[key] = String(wikilinkValue);
    });
  }

  async clearInvalidPrimaryField(file) {
    const key = this.settings.fieldPrimary || "coverFilename";
    const fm = this.getFrontmatterForFile(file);
    if (!fm) return false;

    const v = normalizeFieldValue(fm[key]);
    if (!v) return false;

    if (isHttpUrl(v)) {
      if (!isLikelyFaviconOrIconValue(v)) return false;
      await this.app.fileManager.processFrontMatter(file, (fm2) => {
        fm2[key] = "";
      });
      return true;
    }

    if (!IMAGE_EXT_RE.test(v) || isLikelyFaviconOrIconValue(v)) {
      await this.app.fileManager.processFrontMatter(file, (fm2) => {
        fm2[key] = "";
      });
      return true;
    }

    return false;
  }
};

class CoverBannerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cinematic Covers" });
    containerEl.createEl("p", { text: `Version: ${this.plugin.manifest.version}` });
    new Setting(containerEl)
      .setName("Auto-set banner on open")
      .setDesc("When you open a note with no banner, look for one and write it to the note. This requests the note's URL, or sends the note's title to Google Books.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoSetEnabled && this.plugin.settings.autoSetOnOpen).onChange(async (value) => {
        this.plugin.settings.autoSetEnabled = value;
        this.plugin.settings.autoSetOnOpen = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Automatic updates")
      .setDesc("Check GitHub on startup and every six hours. Download stable releases automatically; restart Obsidian to apply. Settings are preserved.")
      .addToggle(t => t.setValue(this.plugin.settings.autoUpdateEnabled).onChange(async value => {
        this.plugin.settings.autoUpdateEnabled = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Check for updates")
      .setDesc("Download the latest compatible release from frimpsjoek/cover-banner.")
      .addButton(b => b.setButtonText("Check now").onClick(async () => {
        b.setDisabled(true);
        try { await this.plugin.checkForUpdates(true); } finally { b.setDisabled(false); }
      }));
    containerEl.createEl("p", { text: "Most controls are available in the right-panel dashboard (ribbon icon), but core settings live here." });

    containerEl.createEl("h3", { text: "Storage" });
    new Setting(containerEl)
      .setName("Banner download folder")
      .setDesc("Folder inside your vault to save downloaded banner images.")
      .addText((t) =>
        t
          .setPlaceholder(".attachments/banners")
          .setValue(this.plugin.settings.bannerFolder || "")
          .onChange(async (v) => {
            this.plugin.settings.bannerFolder = (v || "").trim() || ".attachments/banners";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sticky (pin) banner")
      .setDesc("If enabled, the banner stays pinned at the top while you scroll the note.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.pinBanner).onChange(async (v) => {
          this.plugin.settings.pinBanner = !!v;
          await this.plugin.saveSettings();
          new Notice(`Cinematic Covers: pinBanner = ${this.plugin.settings.pinBanner ? "ON" : "OFF"}`);
          this.plugin.refreshAllViewBanners();
          this.plugin.refreshDashboard();
        })
      );

    new Setting(containerEl)
      .setName("Parallax")
      .setDesc("If enabled, the banner image moves slightly as you scroll (Notion-style depth).")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.parallaxEnabled).onChange(async (v) => {
          this.plugin.settings.parallaxEnabled = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    new Setting(containerEl)
      .setName("Parallax strength")
      .setDesc("0 = off. Higher = more movement.")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.parallaxStrength ?? 0.35)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.parallaxStrength = Math.max(0, Math.min(1, v));
            await this.plugin.saveSettings();
            this.plugin.requestRefresh();
          })
      );

    new Setting(containerEl)
      .setName("Banner buttons")
      .setDesc("Show Notion-style action icons at the bottom-right of the banner.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.showBannerButtons).onChange(async (v) => {
          this.plugin.settings.showBannerButtons = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    new Setting(containerEl)
      .setName("Hide inline properties")
      .setDesc("Hide the rendered properties block beneath the banner without removing its frontmatter data.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.hideProperties).onChange(async (v) => {
          this.plugin.settings.hideProperties = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    new Setting(containerEl)
      .setName("Hide note title")
      .setDesc("Hide the rendered title while keeping the note filename and content unchanged.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.hideTitle).onChange(async (v) => {
          this.plugin.settings.hideTitle = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    new Setting(containerEl)
      .setName("Enhanced Markdown styling")
      .setDesc("Improve headings, links, tables, code blocks, JSON/JSONL, LaTeX, and reading rhythm.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.enhancedMarkdown).onChange(async (v) => {
          this.plugin.settings.enhancedMarkdown = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    new Setting(containerEl)
      .setName("AI chat formatting")
      .setDesc("Style common System, Developer, User, Assistant, and Tool transcript blocks.")
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.formatAiChats).onChange(async (v) => {
          this.plugin.settings.formatAiChats = !!v;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        })
      );

    containerEl.createEl("h3", { text: "Typography" });
    new Setting(containerEl)
      .setName("Content font")
      .setDesc("Inter is recommended for mixed Markdown and AI notes. Choose Source Serif 4 for long-form reading or IBM Plex Mono for technical notes. Fonts are bundled for offline use.")
      .addDropdown((d) => {
        for (const [value, preset] of Object.entries(CONTENT_FONT_PRESETS)) {
          d.addOption(value, preset.label);
        }
        d.setValue(this.plugin.settings.contentFont || DEFAULT_SETTINGS.contentFont);
        d.onChange(async (value) => {
          this.plugin.settings.contentFont = CONTENT_FONT_PRESETS[value] ? value : DEFAULT_SETTINGS.contentFont;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        });
      });

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("Note text size in pixels, from 12 to 32. Applies in Reading view and Live Preview.")
      .addSlider(slider => slider.setLimits(12, 32, 1)
        .setValue(normalizeFontSize(this.plugin.settings.contentFontSize))
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.contentFontSize = normalizeFontSize(value);
          this.plugin.requestRefresh();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Code font")
      .setDesc("Font for code blocks and inline code. These fonts are not bundled: one marked (not installed) shows the next available font. Ligatures stay off so code shows the characters as typed.")
      .addDropdown((d) => {
        for (const [value, preset] of Object.entries(CODE_FONT_PRESETS)) {
          d.addOption(value, codeFontLabel(preset));
        }
        d.setValue(this.plugin.settings.codeFont || DEFAULT_SETTINGS.codeFont);
        d.onChange(async (value) => {
          this.plugin.settings.codeFont = CODE_FONT_PRESETS[value] ? value : DEFAULT_SETTINGS.codeFont;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        });
      });

    new Setting(containerEl)
      .setName("Reading template")
      .setDesc("Choose a reusable spacing and hierarchy style for notes. This changes presentation only; your Markdown stays untouched.")
      .addDropdown((d) => {
        for (const [value, preset] of Object.entries(READING_TEMPLATE_PRESETS)) {
          d.addOption(value, preset.label);
        }
        d.setValue(this.plugin.settings.readingTemplate || DEFAULT_SETTINGS.readingTemplate);
        d.onChange(async (value) => {
          this.plugin.settings.readingTemplate = READING_TEMPLATE_PRESETS[value]
            ? value
            : DEFAULT_SETTINGS.readingTemplate;
          await this.plugin.saveSettings();
          this.plugin.requestRefresh();
        });
      });

    containerEl.createEl("h3", { text: "Defaults" });
    new Setting(containerEl)
      .setName("Default banner")
      .setDesc("Used when a note has no banner frontmatter. Leave empty to use the built-in abstract fallback.")
      .addText((t) =>
        t
          .setPlaceholder("[[path/to/default.jpg]]")
          .setValue(this.plugin.settings.defaultBanner || "")
          .onChange(async (v) => {
            this.plugin.settings.defaultBanner = (v || "").trim();
            await this.plugin.saveSettings();
            this.plugin.requestRefresh();
          })
      );

    new Setting(containerEl)
      .setName("Default note icon")
      .setDesc("Emoji to show on notes that have no note icon frontmatter.")
      .addText((t) =>
        t
          .setPlaceholder("⬚")
          .setValue(this.plugin.settings.defaultFavicon || "")
          .onChange(async (v) => {
            this.plugin.settings.defaultFavicon = (v || "").trim();
            await this.plugin.saveSettings();
            this.plugin.requestRefresh();
          })
      );

    containerEl.createEl("h3", { text: "Stock photo providers" });

    new Setting(containerEl)
      .setName("Pexels API key")
      .addText((t) =>
        t
          .setPlaceholder("your api key")
          .setValue(this.plugin.settings.pexelsApiKey || "")
          .onChange(async (v) => {
            this.plugin.settings.pexelsApiKey = (v || "").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Pixabay API key")
      .setDesc("(Not wired up yet) Used for stock banner search.")
      .addText((t) =>
        t
          .setPlaceholder("your api key")
          .setValue(this.plugin.settings.pixabayApiKey || "")
          .onChange(async (v) => {
            this.plugin.settings.pixabayApiKey = (v || "").trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Unsplash access key")
      .setDesc("(Not wired up yet) Used for stock banner search.")
      .addText((t) =>
        t
          .setPlaceholder("your access key")
          .setValue(this.plugin.settings.unsplashAccessKey || "")
          .onChange(async (v) => {
            this.plugin.settings.unsplashAccessKey = (v || "").trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
