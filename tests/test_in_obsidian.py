# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Acceptance test in a real, isolated Obsidian: loads the plugin and checks what renders.

Usage: uv run tests/test_in_obsidian.py <work dir> <plugin folder> [obsidian asar]

Runs Obsidian with a throwaway profile and vault under <work dir>, so a running Obsidian,
its settings and its notes are not touched. Exit status 1 on any failure.
"""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

work, plugin, *rest = sys.argv[1:]
asar = rest[0] if rest else None
work = pathlib.Path(work)
shutil.rmtree(work, ignore_errors=True)
profile, vault = work / "profile", work / "vault"
profile.mkdir(parents=True)
dst = vault / ".obsidian/plugins/cover-banner"
dst.mkdir(parents=True)
if asar:
    shutil.copy(asar, profile / pathlib.Path(asar).name)
for name in ("main.js", "styles.css", "manifest.json"):
    shutil.copy(pathlib.Path(plugin) / name, dst / name)
(dst / "data.json").write_text(json.dumps({"contentFont": "atkinson", "codeFont": "jetbrains", "bannerCorners": "top"}))
(vault / ".obsidian/community-plugins.json").write_text("[]")
(vault / "Code.md").write_text(r"""# Code test

Paragraph before the block.

```bash
git clone https://github.com/argonne-lcf/Service_Enabled_Science && cd Service_Enabled_Science
./setup.sh && source .venv/bin/activate
alcf-tokens login --authorize-transfer home --authorize-transfer eagle   # browser login, paste code
uvx alcf-ai agent configure opencode      # or: claude / codex / pi
cd ~/QE-740-PDEP-wannier/West && make lwannier -j14
mpirun -n 1 ~/QE-740-PDEP-wannier/bin/lwannier.x -i wstat.in \
    2>&1 | grep -E "Stage [23]|Jacobi" > lwann_pol.out
conda create -n west python=3.10 -c conda-forge -y
```

Paragraph after the block.

Inline $\chi_0$ and display:

$$\Gamma(E) = \Gamma_{\text{hole}} + \frac{1}{\pi}\arctan(x)$$
""")
(vault / "Bad.md").write_text('---\ntopic: broken\nprovenance_key: "[DFT s.N]" = slide N of the deck\n---\n\nBody text of the note.\n')
(profile / "obsidian.json").write_text(json.dumps(
    {"vaults": {"testvault0000000": {"path": str(vault), "ts": int(time.time() * 1000), "open": True}}}))

results = []


def check(ok, label, detail=""):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'} {label}" + (f": {detail}" if detail != "" else ""))


# Colour coverage, background separation and geometry of what is visible right now.
SNAPSHOT = """() => {
  const vis = (e) => e && e.offsetParent !== null;
  const reading = [...document.querySelectorAll('.markdown-preview-view pre code.language-bash')].filter(vis);
  const live = [...document.querySelectorAll('.cm-line.HyperMD-codeblock:not(.HyperMD-codeblock-begin):not(.HyperMD-codeblock-end)')].filter(vis);
  const els = reading.length ? reading : live;
  let chars = 0, coloured = 0;
  for (const root of els) {
    const base = getComputedStyle(root).color;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode.textContent.replace(/\\s/g, '');
      if (!t) continue;
      chars += t.length;
      if (getComputedStyle(w.currentNode.parentElement).color !== base) coloured += t.length;
    }
  }
  const grey = (c) => { const x = document.createElement('canvas').getContext('2d', {willReadFrequently: true}); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return (d[0] + d[1] + d[2]) / 3; };
  const block = reading[0]?.closest('pre') || live[0];
  const bs = block ? getComputedStyle(block) : null;
  const banner = [...document.querySelectorAll('.cover-banner')].find(vis);
  const title = [...document.querySelectorAll('.inline-title')].find(vis);
  const bannerBox = banner?.getBoundingClientRect(), titleBox = title?.getBoundingClientRect();
  const math = [...document.querySelectorAll('.math-block')].filter(vis)[0];
  const commands = ['git', 'cd', './setup.sh', 'source', 'alcf-tokens', 'uvx', 'make', 'mpirun', 'grep', 'conda'];
  const found = new Set();
  for (const root of els) for (const e of root.querySelectorAll('.cb-sh-cmd')) found.add(e.textContent);
  return {
    missingCommands: commands.filter((c) => !found.has(c)),
    pct: chars ? Math.round(100 * coloured / chars) : null,
    bgDiff: bs ? Math.abs(grey(bs.backgroundColor) - grey(getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#fff')) : null,
    accentBar: bs ? (parseFloat(bs.borderLeftWidth) >= 2 || bs.boxShadow.includes('inset')) : null,
    whiteSpace: reading[0] ? getComputedStyle(reading[0]).whiteSpace : null,
    bannerBottom: bannerBox?.bottom, titleTop: titleBox?.top,
    radius: banner ? getComputedStyle(banner).borderRadius : null,
    mathFragments: math ? math.getClientRects().length : null,
  };
}"""

port = 9346
proc = subprocess.Popen(
    ["/Applications/Obsidian.app/Contents/MacOS/Obsidian", f"--remote-debugging-port={port}", f"--user-data-dir={profile}"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
errors = []
try:
    with sync_playwright() as p:
        for _ in range(60):
            try:
                browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                break
            except Exception:
                time.sleep(1)
        page = None
        for _ in range(60):
            for ctx in browser.contexts:
                for pg in ctx.pages:
                    try:
                        if pg.evaluate("typeof app !== 'undefined' && !!app.workspace && app.workspace.layoutReady"):
                            page = pg
                    except Exception:
                        pass
            if page:
                break
            time.sleep(1)
        page.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.evaluate("app.plugins.setEnable(true)")
        page.wait_for_timeout(1500)
        page.evaluate("document.querySelector('.modal-container .modal-close-button')?.click()")

        def open_note(path, mode="source", source=False):
            page.evaluate("""async ([path, mode, source]) => {
                const leaf = app.workspace.getLeaf();
                await leaf.openFile(app.vault.getAbstractFileByPath(path));
                await leaf.setViewState({type: 'markdown', state: {file: path, mode, source}});
            }""", [path, mode, source])
            page.wait_for_timeout(1200)

        open_note("Code.md")
        version = page.evaluate("async () => { await app.plugins.enablePlugin('cover-banner'); return app.plugins.plugins['cover-banner']?.manifest?.version; }")
        page.wait_for_timeout(2000)
        check(version, "plugin loads with a note open", version)

        def set_mode(mode):
            page.evaluate("""async (mode) => {
                const leaf = app.workspace.getMostRecentLeaf();
                const state = leaf.getViewState();
                state.state.mode = mode;
                state.state.source = false;
                await leaf.setViewState(state);
            }""", mode)
            page.wait_for_timeout(1500)

        for theme, name in (("moonstone", "light"), ("obsidian", "dark")):
            page.evaluate("(t) => app.changeTheme ? app.changeTheme(t) : app.setTheme(t)", theme)
            page.wait_for_timeout(500)
            for mode, view in (("source", "live preview"), ("preview", "reading"), ("source", "back to live preview")):
                set_mode(mode)
                s = page.evaluate(SNAPSHOT)
                check(not s["missingCommands"], f"{name} {view}: every command name coloured", f"{s['pct']}% of characters, missing {s['missingCommands']}")
                check(s["bgDiff"] is not None and s["bgDiff"] >= 9, f"{name} {view}: code block separate from page", f"grey difference {s['bgDiff']}")
                check(s["accentBar"], f"{name} {view}: code block has an accent edge")
                top, bottom = s["titleTop"], s["bannerBottom"]
                check(top is not None and bottom is not None and top >= bottom, f"{name} {view}: banner does not cover the title", f"title {top} banner bottom {bottom}")
            page.screenshot(path=str(work / f"code_{name}.png"))

        set_mode("preview")
        s = page.evaluate(SNAPSHOT)
        check(s["whiteSpace"] == "pre", "reading: long code lines scroll instead of wrapping", s["whiteSpace"])
        check(s["mathFragments"] == 1, "reading: display equation is one box", s["mathFragments"])
        page.screenshot(path=str(work / "math.png"))
        radius = s["radius"] or ""
        parts = radius.split()
        check(len(parts) == 4 and parts[0] != "0px" and parts[2] == "0px", "corners: top rounded, bottom square", radius)

        # Hide and show frontmatter, including frontmatter that is not valid YAML.
        open_note("Bad.md")
        visible_fm = """() => ({
            raw: [...document.querySelectorAll('.cm-line')].filter((e) => e.querySelector('.cm-hmd-frontmatter') || e.classList.contains('HyperMD-frontmatter')).filter((e) => e.offsetParent !== null && e.offsetHeight > 0).length,
            widget: [...document.querySelectorAll('.metadata-container')].filter((e) => e.offsetParent !== null && e.offsetHeight > 0).length,
            body: [...document.querySelectorAll('.cm-line')].some((e) => e.textContent.includes('Body text') && e.offsetHeight > 0),
        })"""
        shown = page.evaluate(visible_fm)
        check(shown["raw"] + shown["widget"] > 0, "frontmatter: shown by default", shown)
        toggled = page.evaluate("app.commands.executeCommandById('cover-banner:toggle-properties')")
        page.wait_for_timeout(800)
        hidden = page.evaluate(visible_fm)
        check(toggled and hidden["raw"] + hidden["widget"] == 0 and hidden["body"], "frontmatter: command hides it, body stays", hidden)
        page.screenshot(path=str(work / "frontmatter_hidden.png"))
        page.evaluate("app.commands.executeCommandById('cover-banner:toggle-properties')")
        page.wait_for_timeout(800)
        again = page.evaluate(visible_fm)
        check(again["raw"] + again["widget"] > 0, "frontmatter: command shows it again", again)

        check(not errors, "no console errors", errors[:3] if errors else "")
finally:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

print(f"\n{results.count(False)} failure(s) of {len(results)}")
sys.exit(1 if False in results or not results else 0)
