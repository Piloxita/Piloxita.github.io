"""Static checks for the hard constraints. Run: python tests/check.py"""
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "0b526ab"  # the original homepage + privacy commit
fails = []


def check(ok, msg):
    print(("ok   " if ok else "FAIL ") + msg)
    if not ok:
        fails.append(msg)


def old(path):
    return subprocess.run(["git", "-C", str(ROOT), "show", f"525c914:{path}"],
                          capture_output=True, text=True, check=True).stdout


class Text(HTMLParser):
    """Collects visible text inside <main> (new) or <body> (old)."""

    def __init__(self, scope):
        super().__init__()
        self.scope, self.depth, self.out, self.skip = scope, 0, [], 0

    def handle_starttag(self, tag, attrs):
        if tag == self.scope:
            self.depth += 1
        if tag in ("style", "script"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag == self.scope:
            self.depth -= 1
        if tag in ("style", "script"):
            self.skip -= 1

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.out.append(data)

    def text(self):
        return " ".join(" ".join(self.out).split())


def text_of(html, scope):
    p = Text(scope)
    p.feed(html)
    return p.text()


index = (ROOT / "index.html").read_text()
privacy = (ROOT / "privacy.html").read_text()
assistant = (ROOT / "assistant/index.html").read_text()

# 1. Both verification tags, byte for byte, inside <head>.
head = index.split("</head>", 1)[0]
for line in old("index.html").splitlines():
    if "google-site-verification" in line:
        check(line in head, f"verification tag kept: {line[60:90]}...")

# 2. Privacy text: every word unchanged.
check(text_of(old("privacy.html"), "body") == text_of(privacy, "main"), "privacy.html text identical")
check("<title>Privacy policy · Piloxita Home Assistant</title>" in privacy, "privacy.html title kept")

# 3. Home Assistant section on the root page, with the old text and a privacy link.
old_home = text_of(old("index.html"), "body").replace("Piloxita Home Assistant", "", 1).replace("Privacy policy", "").strip()
ha = re.search(r'<li class="card panel ha" id="home-assistant">(.*?)</li>\s*</ul>\s*</div>\s*</section>', index, re.S)
check(bool(ha), "root page has #home-assistant section")
if ha:
    check(old_home in text_of("<main>" + ha.group(1) + "</main>", "main"), "HA section carries the old homepage text")
    check('href="privacy.html"' in ha.group(1), "HA section links privacy.html")
    check("<h3>Piloxita Home Assistant</h3>" in ha.group(1), "HA section clearly labelled")

# 4. assistant/ page has the old text and links ../privacy.html.
check(old_home in text_of(assistant, "main"), "assistant/ carries the old homepage text")
check('href="../privacy.html"' in assistant, "assistant/ links ../privacy.html")

# 5. No CDN at runtime, no employer names, local links resolve.
for f in ["index.html", "privacy.html", "assistant/index.html", "404.html", "js/main.js", "js/field.js", "css/site.css"]:
    s = (ROOT / f).read_text()
    check(not re.search(r'(src|href)="https?://(?!piloxita\.github\.io|github\.com|myaccount\.google|developers\.google)', s),
          f"{f}: no third-party runtime URLs")
    check(not re.search(r"trusting\s*social", s, re.I), f"{f}: no employer named")
    for ref in re.findall(r'(?:src|href)="([^"#:]+)"', s):
        if ref.startswith("/"):
            target = ROOT / ref.lstrip("/")
        else:
            target = (ROOT / f).parent / ref
        if ref.endswith("/"):
            target = target / "index.html"
        check(target.exists(), f"{f}: {ref} exists")

for v in ["three.module.min.js", "gsap.min.js", "ScrollTrigger.min.js", "VERSIONS.md"]:
    check((ROOT / "vendor" / v).exists(), f"vendor/{v} present")

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
