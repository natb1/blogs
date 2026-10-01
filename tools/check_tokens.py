#!/usr/bin/env python3
"""Fail when a tokens.css's two dark blocks disagree.

CSS cannot share one body across a media-query boundary, so every themed sheet
writes its dark values twice: under prefers-color-scheme, guarded by
:root:not([data-theme="light"]), and under :root[data-theme="dark"]. A value
changed in one and forgotten in the other is a theme that switches halfway.

    python3 tools/check_tokens.py
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUTO = re.compile(r'@media \(prefers-color-scheme:\s*dark\)\{:root:not\(\[data-theme="light"\]\)\{(.*?)\}\}', re.S)
FORCED = re.compile(r':root\[data-theme="dark"\]\{(.*?)\}', re.S)


def decls(body):
    return dict(re.findall(r'(--[\w-]+)\s*:\s*([^;]+);', body))


def main():
    failed = False
    for sheet in sorted(ROOT.glob("**/tokens.css")):
        css, name = sheet.read_text(), sheet.relative_to(ROOT)
        auto, forced = AUTO.search(css), FORCED.search(css)
        if not auto and not forced:
            print(f"ok   {name} (no dark values)")
            continue
        if not (auto and forced):
            print(f"FAIL {name}: one dark block without the other")
            failed = True
            continue
        a, f = decls(auto.group(1)), decls(forced.group(1))
        diff = sorted(k for k in a.keys() | f.keys() if a.get(k) != f.get(k))
        if diff:
            print(f"FAIL {name}: dark blocks disagree on {', '.join(diff)}")
            failed = True
        else:
            print(f"ok   {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
