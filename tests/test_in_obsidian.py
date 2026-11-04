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
(dst / "data.json").write_text(json.dumps({"contentFont": "atkinson", "codeFont": "jetbrains", "bannerCorners": "top", "autoUpdateEnabled": False}))
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

```bash
cat > job.pbs <<'EOF'
#PBS -N test
heredocbody --flag ~/x
EOF
qsub job.pbs
```

```
Gamma_hole
  1.55                 ! core-hole width (eV)
All_conv               ! also write spectra
```

```
The result was great! This output is prose.
```

```fortran
! a fortran comment
program main
  x = 1.5  ! trailing
end program
```

```python
def add(a, b):
    return a + b
```

```json
{"key": 1}
```

> A quoted line.

User: a transcript line.

Paragraph after the block.

Inline $\chi_0$ and display:

$$\Gamma(E) = \Gamma_{\text{hole}} + \frac{1}{\pi}\arctan(x)$$
""")
(vault / "tall.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#345"/></svg>')
(vault / "Drag.md").write_text('---\ncover: "[[tall.svg]]"\n---\n\nDrag test.\n')
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
  const commands = ['git', 'cd', './setup.sh', 'source', 'alcf-tokens', 'uvx', 'make', 'mpirun', 'grep', 'conda', 'cat', 'qsub'];
  const found = new Set();
  for (const root of els) for (const e of root.querySelectorAll('.cb-sh-cmd')) found.add(e.textContent);
  return {
    missingCommands: commands.filter((c) => !found.has(c)),
    heredocColoured: ['heredocbody', 'EOF', '--flag'].filter((c) => found.has(c)),
    pct: chars ? Math.round(100 * coloured / chars) : null,
    bgDiff: bs ? Math.abs(grey(bs.backgroundColor) - grey(getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#fff')) : null,
    edges: [...document.querySelectorAll('pre, pre > code, blockquote, .math-block, .cover-banner-ai-message, .cm-line')].filter(vis).filter((e) => {
      const c = getComputedStyle(e), b = getComputedStyle(e, '::before');
      return parseFloat(c.borderLeftWidth) !== parseFloat(c.borderRightWidth) || c.borderLeftColor !== c.borderRightColor
        || c.boxShadow.split(/,(?![^(]*\\))/).some((x) => x.includes('inset') && parseFloat(x.replace(/^.*\\)\\s*/, '')) !== 0) || parseFloat(b.borderLeftWidth) > 0;
    }).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`).slice(0, 5),
    deck: Object.fromEntries(['comment', 'keyword', 'number'].map((t) => [t, [...document.querySelectorAll('.cb-sh-' + t)].filter(vis).map((e) => { const c = e.closest('.cm-line, code'); return [e.textContent, getComputedStyle(e).color !== getComputedStyle(c).color]; })])),
    fortran: (() => { const c = [...document.querySelectorAll('pre code.language-fortran')].filter(vis)[0]; return c ? c.querySelectorAll('span').length : null; })(),
    prosePlain: [...document.querySelectorAll('pre code, .cm-line')].filter(vis).filter((e) => e.textContent.includes('output is prose')).every((e) => !e.querySelector('.cb-sh')),
    themeColours: (() => {
      const probe = (cls, name) => {
        const e = [...document.querySelectorAll(cls)].find(vis);
        if (!e) return null;
        const v = document.createElement('span');
        v.style.color = `var(${name})`;
        e.parentElement.append(v);
        const want = getComputedStyle(v).color;
        v.remove();
        const deepest = e.querySelector('*') || e;
        return getComputedStyle(deepest).color === want;
      };
      return {cmd: probe('.cb-sh-cmd', '--code-function'), flag: probe('.cb-sh-flag', '--code-property'), comment: probe('.cb-sh-comment', '--code-comment'), number: probe('.cb-sh-number', '--code-value'), keyword: probe('.cb-sh-keyword', '--code-keyword')};
    })(),
    proseFont: (() => { const e = [...document.querySelectorAll('.markdown-preview-view p, .cm-line:not(.HyperMD-codeblock)')].find((x) => vis(x) && x.textContent.includes('Paragraph')); return e ? getComputedStyle(e).fontFamily : null; })(),
    shellBold: [...document.querySelectorAll('.cb-sh')].filter(vis).some((e) => parseInt(getComputedStyle(e).fontWeight) > 400),
    whiteSpace: reading[0] ? getComputedStyle(reading[0]).whiteSpace : null,
    bannerBottom: bannerBox?.bottom, titleTop: titleBox?.top,
    radius: banner ? getComputedStyle(banner).borderRadius : null,
    mathFragments: math ? math.getClientRects().length : null,
  };
}"""

port = 9346
proc = subprocess.Popen(
    ["/Applications/Obsidian.app/Contents/MacOS/Obsidian", f"--remote-debugging-port={port}", f"--user-data-dir={profile}"],
    stdout=open(work / "obsidian.log", "w"), stderr=subprocess.STDOUT, start_new_session=True)
errors = []
try:
    with sync_playwright() as p:
        for _ in range(60):
            try:
                browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
                break
            except Exception:
                time.sleep(1)
        else:
            raise SystemExit("FAIL could not connect to Obsidian")
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
        if page is None:
            raise SystemExit("FAIL vault did not open")
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
            # The note is longer than the window; the title check is about the top of the note.
            # Obsidian restores the old scroll position some time after a mode switch, so wait until it holds.
            page.wait_for_function("""() => {
                const panes = [...document.querySelectorAll('.markdown-preview-view, .cm-scroller')];
                panes.forEach((e) => { e.scrollTop = 0; });
                window.__cbStable = panes.every((e) => e.scrollTop === 0) ? (window.__cbStable || 0) + 1 : 0;
                return window.__cbStable >= 5;
            }""", polling=200, timeout=15000)
            page.evaluate("window.__cbStable = 0")
            # The editor paints its lines after the mode switch; a block that never appears still fails below.
            try:
                page.wait_for_function("[...document.querySelectorAll('.markdown-preview-view pre code, .cm-line.HyperMD-codeblock')].some((e) => e.offsetParent !== null)", polling=100, timeout=8000)
            except Exception:
                print("note: code block not visible after 8 s")

        for theme, name in (("moonstone", "light"), ("obsidian", "dark")):
            page.evaluate("(t) => app.changeTheme ? app.changeTheme(t) : app.setTheme(t)", theme)
            page.wait_for_timeout(500)
            for mode, view in (("source", "live preview"), ("preview", "reading"), ("source", "back to live preview")):
                set_mode(mode)
                s = page.evaluate(SNAPSHOT)
                check(not s["missingCommands"], f"{name} {view}: every command name coloured", f"{s['pct']}% of characters, missing {s['missingCommands']}")
                check(s["bgDiff"] is not None and s["bgDiff"] >= 9, f"{name} {view}: code block separate from page", f"grey difference {s['bgDiff']}")
                check(not s["edges"], f"{name} {view}: no accent edge on any block", s["edges"])
                d = s["deck"]
                check(any(t == "! core-hole width (eV)" and c for t, c in d["comment"]), f"{name} {view}: ! comment coloured", d["comment"][:3])
                check(any(t == "Gamma_hole" and c for t, c in d["keyword"]), f"{name} {view}: deck keyword coloured", d["keyword"][:3])
                check(any(t == "1.55" and c for t, c in d["number"]), f"{name} {view}: deck number coloured", d["number"][:3])
                check(s["prosePlain"], f"{name} {view}: prose in a code block stays plain")
                if s["fortran"] is not None:
                    check(s["fortran"] > 0, f"{name} {view}: fortran block coloured", s["fortran"])
                check(all(v is True for v in s["themeColours"].values()), f"{name} {view}: code colours match the theme, without !important", s["themeColours"])
                check("Atkinson" in (s["proseFont"] or ""), f"{name} {view}: content font applies, without !important", (s["proseFont"] or "")[:40])
                check(not s["shellBold"], f"{name} {view}: shell colours are not bold")
                check(not s["heredocColoured"], f"{name} {view}: heredoc body stays plain", s["heredocColoured"])
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

        hidden_title = page.evaluate("""async () => {
            const view = document.querySelector('.workspace-leaf.mod-active .view-content');
            view.classList.add('cover-banner--hide-title');
            await new Promise((r) => setTimeout(r, 200));
            const shown = [...view.querySelectorAll('.inline-title')].filter((e) => getComputedStyle(e).display !== 'none').length;
            view.classList.remove('cover-banner--hide-title');
            return shown;
        }""")
        check(hidden_title == 0, "hide title still works without !important", hidden_title)
        fonts_ok = page.evaluate("""async () => {
            const names = ['Inter', 'Source Serif 4', 'IBM Plex Mono', 'IBM Plex Sans', 'Atkinson Hyperlegible', 'Lato', 'Open Sans', 'Noto Sans', 'Literata'];
            const out = {};
            for (const n of names) { const loaded = await document.fonts.load(`16px "${n}"`); out[n] = loaded.some((f) => f.family.replace(/["']/g, '') === n && f.status === 'loaded'); }
            return out;
        }""")
        check(all(fonts_ok.values()), "all nine bundled fonts load", fonts_ok)

        open_note("Drag.md", "preview")
        drag_box = page.evaluate("""() => { const b = [...document.querySelectorAll('.cover-banner')].find((e) => e.offsetParent !== null).getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + 60}; }""")
        read_drag = lambda: (vault / "Drag.md").read_text()
        page.mouse.move(drag_box["x"], drag_box["y"]); page.mouse.down(); page.mouse.up(); page.wait_for_timeout(600)
        check("banner_y" not in read_drag(), "drag: a plain click writes nothing")
        page.mouse.move(drag_box["x"], drag_box["y"]); page.mouse.down(); page.mouse.move(drag_box["x"], drag_box["y"] + 50, steps=5); page.mouse.up(); page.wait_for_timeout(1500)
        text = read_drag()
        y_lines = [l for l in text.split("\n") if l.startswith("banner_y:")]
        check(y_lines and float(y_lines[0].split(":")[1]) < 0.5, "drag: moving down saves a smaller banner_y", y_lines)
        drawn = page.evaluate("[...document.querySelectorAll('.cover-banner__img')].find((e) => e.offsetParent !== null)?.style.objectPosition")
        check(drawn and drawn.startswith("50%") and y_lines and abs(float(drawn.split()[1].rstrip("%")) - 100 * float(y_lines[0].split(":")[1])) < 0.2, "drag: position still applied after saving", drawn)
        for offset in (20, -30, 10):
            page.mouse.move(drag_box["x"], drag_box["y"]); page.mouse.down(); page.mouse.move(drag_box["x"], drag_box["y"] + offset, steps=5); page.mouse.up(); page.wait_for_timeout(800)
        lines = read_drag().split("\n")
        check(sum(l.startswith("banner_y:") for l in lines) == 1 and sum(l.startswith("banner_x:") for l in lines) == 1 and lines.count("---") == 2, "drag: repeated saves do not repeat frontmatter", lines[:8])

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
except Exception:
    print(f"Obsidian exit status at failure: {proc.poll()}; log at {work / 'obsidian.log'}")
    raise
finally:
    # Wait for the exit: a new run reuses this profile path, and a dying instance would block it.
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=20)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    time.sleep(2)

print(f"\n{results.count(False)} failure(s) of {len(results)}")
sys.exit(1 if False in results or not results else 0)
