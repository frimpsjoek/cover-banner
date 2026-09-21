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
  setIcon
} = obsidian;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;
const ICON_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg|ico)$/i;
const DEFAULT_CINEMATIC_BANNER =
  "https://images.unsplash.com/photo-1486854561807-38fc02359493?auto=format&fit=crop&w=2400&q=82";

const VIEW_TYPE = "cover-banner-dashboard";

// Curated stacks keep the selector useful without downloading fonts into the vault.
// Inter is the best all-rounder for mixed Markdown, AI transcripts, and properties.
const CONTENT_FONT_PRESETS = {
  inter: {
    label: "Inter (recommended)",
    stack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  theme: {
    label: "Theme default",
    stack: "var(--font-text-theme, var(--font-text))"
  },
  atkinson: {
    label: "Atkinson Hyperlegible",
    stack: '"Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
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
    stack: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace'
  }
};

function getContentFontStack(value) {
  return CONTENT_FONT_PRESETS[value]?.stack || CONTENT_FONT_PRESETS.inter.stack;
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

  // UI
  showBannerButtons: true,
  hideProperties: false,
  hideTitle: false,
  contentFont: "inter",
  enhancedMarkdown: true,
  formatAiChats: true,

  // defaults
  // defaultBanner can be a wikilink [[...]] or path or url
  defaultBanner: DEFAULT_CINEMATIC_BANNER,
  defaultFavicon: "📝",

  // autoset
  autoSetEnabled: true,
  autoSetOnOpen: true,
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
  const candidates = [];
  const metas = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["'][^>]*>/ig,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["'][^>]*>/ig,
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["'][^>]*>/ig,
    /<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["'][^>]*>/ig
  ];

  for (const re of metas) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = (m[1] || "").trim();
      if (!u) continue;
      const abs = absolutizeUrl(u, baseUrl);
      if (abs && !isLikelyFaviconOrIconValue(abs)) candidates.push(abs);
    }
  }

  return candidates.length ? candidates[0] : null;
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
    contentEl.createEl("h2", { text: "Pick banner from Pexels" });

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

    setTimeout(runSearch, 100);
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
    return "image";
  }

  async onOpen() {
    this.render();
  }

  async onClose() {
    // nothing
  }

  render() {
    const el = this.containerEl;
    el.empty();
    el.addClass("cover-banner-dashboard");

    const header = el.createDiv({ cls: "cover-banner-dashboard__header" });
    header.createEl("h3", { text: "Cinematic Covers" });

    const file = this.plugin.getCurrentMarkdownFile();
    const fileName = file?.basename || "(no note selected)";
    header.createDiv({ text: fileName, cls: "cover-banner-dashboard__sub" });

    const actions = el.createDiv({ cls: "cover-banner-dashboard__actions" });

    const mkBtn = (label, onClick) => {
      const b = actions.createEl("button", { text: label });
      b.addEventListener("click", onClick);
      return b;
    };

    mkBtn("Auto-set banner (URL/Book)", async () => {
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

    mkBtn("Pick banner from Pexels…", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      new PexelsPickerModal(this.app, this.plugin, f).open();
    });

    mkBtn("Clear invalid coverFilename", async () => {
      const f = this.plugin.getCurrentMarkdownFile();
      if (!looksLikeMarkdownFile(f)) {
        new Notice("Cinematic Covers: no active note");
        return;
      }
      const cleared = await this.plugin.clearInvalidPrimaryField(f);
      new Notice(cleared ? "Cleared coverFilename" : "Nothing to clear");
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
  }
}

module.exports = class CoverBannerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    let didMigrate = false;

    // normalize boolean settings that might have been serialized oddly
    const boolFields = [
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

    if (!CONTENT_FONT_PRESETS[this.settings.contentFont]) {
      this.settings.contentFont = DEFAULT_SETTINGS.contentFont;
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

    // Parallax bookkeeping (view-content el -> { banner, onScroll })
    this._parallaxMap = new WeakMap();

    // register dashboard view
    this.registerView(VIEW_TYPE, (leaf) => new CoverBannerDashboardView(leaf, this));

    // SINGLE ribbon icon: open dashboard
    this.addRibbonIcon("layout-dashboard", "Cinematic Covers dashboard", async () => {
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
    this.registerEvent(this.app.metadataCache.on("changed", () => this._refreshDebounced()));

    setTimeout(() => this._refreshDebounced(), 1200);

    // Commands (also accessible via dashboard buttons)
    this.addCommand({
      id: "cover-banner-open-dashboard",
      name: "Open dashboard",
      callback: () => this.openDashboard()
    });

    this.addCommand({
      id: "cover-banner-pexels-picker",
      name: "Pick banner from Pexels…",
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

  async saveSettings() {
    await this.saveData(this.settings);
  }

  requestRefresh() {
    this._refreshDebounced();
    this.refreshDashboard();
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
    // open in right leaf
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getRightLeaf(false);
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
    const leaf = this.getActiveMarkdownLeaf();
    const file = leaf?.view?.file;
    if (looksLikeMarkdownFile(file)) return file;
    const active = this.getActiveFile();
    if (looksLikeMarkdownFile(active)) return active;
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

    root.classList.toggle("cover-banner--hide-title", !!this.settings.hideTitle);
    root.classList.toggle("cover-banner--enhanced-markdown", !!this.settings.enhancedMarkdown);
    root.style.setProperty("--cover-banner-content-font", getContentFontStack(this.settings.contentFont));
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

    const fm = this.getFrontmatterSafe(file);

    const rawValue = this.getBannerValueFromFrontmatter(fm) || normalizeFieldValue(this.settings.defaultBanner);
    const src = this.resolveBannerValueToSrc(file, rawValue);
    const isPinned = coerceBoolean(this.settings.pinBanner, false);
    const showBannerButtons = coerceBoolean(this.settings.showBannerButtons, true);

    const props = viewContent.querySelector(".metadata-container, .markdown-properties");
    if (props) props.classList.toggle("cover-banner__properties-hidden", !!this.settings.hideProperties);

    const banner = document.createElement("div");
    banner.className = "cover-banner";
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
        mkAction("layout-dashboard", "Open Cinematic Covers dashboard", () => this.openDashboard())
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

    if (createEmptyOnFail) await this.ensurePrimaryFieldExists(file);
    return false;
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

      if (!arrayBuffer) {
        console.error("CoverBanner: download missing arrayBuffer", { imageUrl, status, contentType, keys: r ? Object.keys(r) : null });
        new Notice(`Cinematic Covers: failed to download (status ${status ?? "?"})`);
        return null;
      }

      if (isLikelyFaviconOrIconValue(imageUrl) || isIconContentType(contentType)) {
        console.warn("CoverBanner: skipping favicon/icon image for banner", { imageUrl, contentType });
        return null;
      }

      const ext = extFromContentType(contentType);
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

      const bytes = new Uint8Array(arrayBuffer);
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
    containerEl.createEl("p", { text: "Version: v0.5.2-local" });
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
      .setDesc("Inter is recommended for mixed Markdown and AI notes. Choose Source Serif 4 for long-form reading or IBM Plex Mono for technical notes. Fonts use installed system fallbacks.")
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
