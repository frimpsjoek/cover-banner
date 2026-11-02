# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""Check which fonts Chromium really paints, using the plugin's own main.js and styles.css.

Usage: uv run tests/test_font_presets.py   (from the repository root; needs Google Chrome)

Obsidian runs on Chromium, so CSS.getPlatformFontsForNode reports what it would paint.
Exit status 1 on any failure. Atkinson Hyperlegible Next and the code fonts are not
bundled, so those cases need them installed on this machine.
"""
import json
import pathlib
import re
import subprocess
import sys

from playwright.sync_api import sync_playwright

LATIN = "Dielectric screening converges slowly with basis size."
SCIENCE = "χ₀ ε⁻¹ Σ ω λ α → ≈ ± ⟨ψ|∇|ψ⟩ ΔE = 2.1 eV"

main_js = pathlib.Path("main.js").read_text()
css = pathlib.Path("styles.css").read_text()
snippet = "\n".join(
    m.group(0)
    for name in ("CONTENT_FONT_PRESETS", "CODE_FONT_PRESETS")
    if (m := re.search(rf"const {name} = \{{.*?\n\}};", main_js, re.S))
)
names = re.findall(r"const (\w+_FONT_PRESETS)", snippet)
tables = json.loads(subprocess.run(
    ["node", "-e", snippet + f"\nconsole.log(JSON.stringify({{{','.join(names)}}}))"],
    capture_output=True, text=True, check=True,
).stdout)

# Font each preset must paint for Latin text.
EXPECT = {
    ("CONTENT_FONT_PRESETS", "inter"): "Inter",
    ("CONTENT_FONT_PRESETS", "lato"): "Lato",
    ("CONTENT_FONT_PRESETS", "openSans"): "Open Sans",
    ("CONTENT_FONT_PRESETS", "notoSans"): "Noto Sans",
    ("CONTENT_FONT_PRESETS", "literata"): "Literata",
    ("CONTENT_FONT_PRESETS", "atkinson"): "Atkinson Hyperlegible Next",
    ("CONTENT_FONT_PRESETS", "sourceSerif"): "Source Serif 4",
    ("CONTENT_FONT_PRESETS", "plexSans"): "IBM Plex Sans",
    ("CONTENT_FONT_PRESETS", "plexMono"): "IBM Plex Mono",
    ("CODE_FONT_PRESETS", "jetbrains"): "JetBrains Mono",
    ("CODE_FONT_PRESETS", "fira"): "Fira Code",
    ("CODE_FONT_PRESETS", "atkinsonMono"): "Atkinson Hyperlegible Mono",
    ("CODE_FONT_PRESETS", "intel"): "Intel One Mono",
}
# A serif or last-resort face inside these stacks means a Greek fallback is missing.
BAD_FALLBACKS = ("Times", "LastResort", "Courier")

failures = []


def report(ok, label):
    print(f"{'PASS' if ok else 'FAIL'} {label}")
    if not ok:
        failures.append(label.split(":")[0])


def painted(cdp, selector):
    root = cdp.send("DOM.getDocument", {"depth": -1})["root"]["nodeId"]
    node = cdp.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
    fonts = cdp.send("CSS.getPlatformFontsForNode", {"nodeId": node})["fonts"]
    return {f["familyName"]: f["glyphCount"] for f in fonts}


def load(page, html):
    page.set_content(html)
    page.evaluate("""async () => {
        await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
        await document.fonts.ready;
    }""")


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page()
    cdp = page.context.new_cdp_session(page)
    cdp.send("DOM.enable")
    cdp.send("CSS.enable")

    for (table, key), want in EXPECT.items():
        preset = tables.get(table, {}).get(key)
        if preset is None:
            report(False, f"{table}.{key}: preset missing")
            continue
        load(page, f"<style>{css}\np {{ font-family: {preset['stack']}; font-size: 17px; }}</style>"
                   f"<p id=a>{LATIN}</p><p id=b>{SCIENCE}</p>")
        latin, sci = painted(cdp, "#a"), painted(cdp, "#b")
        ok = len(latin) == 1 and next(iter(latin)).startswith(want)
        ok = ok and not any(bad in font for font in sci for bad in BAD_FALLBACKS)
        report(ok, f"{table}.{key}: latin={latin} science={sci}")

    # Real note markup: code must keep the code font in both views, prose the prose font.
    content = tables["CONTENT_FONT_PRESETS"]["atkinson"]["stack"]
    code_table = tables.get("CODE_FONT_PRESETS")
    code = code_table["jetbrains"]["stack"] if code_table else '"Menlo"'
    variables = f"--cover-banner-content-font:{content};--cover-banner-code-font:{code}"
    load(page, f"""<style>{css}\n.cover-banner--content-font {{ {variables} }}</style>
      <div class="cover-banner--content-font">
      <div class="markdown-preview-view markdown-rendered">
        <p id=rp>{LATIN}<code id=ri>inline_code()</code></p><pre id=rb><code>x -> y != z</code></pre>
      </div>
      <div class="markdown-source-view"><div class="cm-content">
        <div class="cm-line" id=lp>{LATIN}</div>
        <div class="cm-line HyperMD-codeblock" id=lb>x -> y != z</div>
        <div class="cm-line"><span class="cm-inline-code" id=li>inline_code()</span></div>
      </div></div></div>""")
    for selector, label in (("#ri", "reading inline"), ("#rb code", "reading block"),
                            ("#lb", "live preview block"), ("#li", "live preview inline")):
        fonts = painted(cdp, selector)
        report(list(fonts) == ["JetBrains Mono"], f"code font, {label}: {fonts}")
    for selector, label in (("#rp", "reading"), ("#lp", "live preview")):
        fonts = painted(cdp, selector)
        report(any(f.startswith("Atkinson Hyperlegible") for f in fonts), f"prose font, {label}: {fonts}")
    feature = page.evaluate("getComputedStyle(document.querySelector('#rb code')).fontFeatureSettings")
    report('"calt" 0' in feature, f"ligatures off in code: {feature}")

    # The picker's probe must tell a present family from an absent one.
    probe = re.search(r"function isFontInstalled\(.*?\n\}", main_js, re.S)
    if probe is None:
        report(False, "isFontInstalled: missing")
    else:
        for family, want in [("JetBrains Mono", True), ("Not A Real Font", False)]:
            got = page.evaluate(f"({probe.group(0)})({json.dumps(family)})")
            report(got == want, f"isFontInstalled({family!r}) = {got}")
    browser.close()

print(f"\n{len(failures)} failure(s)" + (": " + ", ".join(failures) if failures else ""))
sys.exit(1 if failures else 0)
