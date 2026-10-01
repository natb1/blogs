#!/usr/bin/env python3
"""Build one site folder into static files.

    python3 tools/build.py alpha            # → dist/alpha, drafts left out
    python3 tools/build.py alpha --drafts   # drafts included (previews)

What it writes, and for whom:

    index.html              the feed: mounts the engine's Blog layout
    feed/N.json             the pages load(cursor) fetches, newest first
    posts/<slug>/index.html each article as plain HTML — where links, crawlers,
                            feed readers and readers without JS land
    about/index.html        about.md, the same way
    feed.xml                RSS, linking the plain pages
    blogroll.opml           blogroll.yaml, for a feed reader to import
    engine/ · site.css      the engine's files and the site's tokens

A post is posts/YYYY-MM-DD-slug.md with front matter (title, date, draft). The
slug is the article's id everywhere: its hash in the feed, its folder in posts/.
"""
import argparse, datetime, html, json, re, shutil, sys
from email.utils import format_datetime
from pathlib import Path

import markdown, yaml

ROOT = Path(__file__).resolve().parent.parent
PAGE_SIZE = 5
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,600;1,400&display=swap">')
FRONT = re.compile(r"\A---\n(.*?)\n---\n?(.*)\Z", re.S)
NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)$")
esc = html.escape


def read_md(path):
    """(front matter, rendered HTML) of a markdown file."""
    m = FRONT.match(path.read_text())
    meta, body = (yaml.safe_load(m.group(1)) or {}, m.group(2)) if m else ({}, path.read_text())
    return meta, markdown.markdown(body, extensions=["fenced_code", "tables", "smarty"])


def read_posts(site_dir, drafts):
    posts = []
    for path in sorted((site_dir / "posts").glob("*.md")):
        named = NAME.match(path.stem)
        if not named:
            sys.exit(f"{path}: a post is named YYYY-MM-DD-slug.md")
        meta, body = read_md(path)
        if meta.get("draft") and not drafts:
            continue
        date = str(meta.get("date") or named.group(1))
        words = len(re.sub(r"<[^>]+>", " ", body).split())
        posts.append({"id": named.group(2), "title": meta.get("title") or named.group(2),
                      "date": date, "content": body,
                      "meta": f"{max(1, round(words / 220))} min read"})
    ids = [p["id"] for p in posts]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        sys.exit(f"{site_dir.name}: two posts share a slug: {', '.join(dupes)}")
    return sorted(posts, key=lambda p: p["date"], reverse=True)


def head(site, title, up, extra=""):
    return (f'<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{esc(title)}</title>\n{FONTS}\n'
            f'<link rel="stylesheet" href="{up}engine/tokens.css">\n'
            f'<link rel="stylesheet" href="{up}site.css">\n'
            f'<link rel="alternate" type="application/rss+xml" title="{esc(site["title"])}" href="{up}feed.xml">\n'
            f'{extra}')


def plain_page(site, up, title, body, meta="", foot=""):
    """A scriptless page: one article, or About. `up` is the way back to the
    site's root from where the page is served."""
    sub = f'<p class="page-sub">{esc(site["subtitle"])}</p>' if site.get("subtitle") else ""
    return (head(site, f'{title} — {site["title"]}', up,
                 f'<link rel="stylesheet" href="{up}engine/page.css">\n')
            + f'<header class="page-banner"><p class="page-site"><a href="{up or "./"}">{esc(site["title"])}</a></p>{sub}</header>\n'
            + f'<main class="page-main">\n<h1 class="page-title">{esc(title)}</h1>\n'
            + (f'<div class="page-meta">{meta}</div>\n' if meta else "")
            + f'<div class="page-body">\n{body}\n</div>\n'
            + (f'<footer class="page-foot">{foot}</footer>\n' if foot else "")
            + '</main>\n')


def feed_page(site, index, top):
    """The feed. Everything the script needs is data; the layout does the rest."""
    data = {"title": site["title"], "subtitle": site.get("subtitle", ""),
            "links": site.get("links") or [], "about": site.get("about"),
            "rail": site.get("rail") or {}, "index": index, "top": top,
            "blogroll": site["_blogroll"]}
    return (head(site, site["title"], "", '<link rel="stylesheet" href="engine/blog-layout.css">\n')
            + '<style>body{ margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans); }</style>\n'
            + '<div id="app"></div>\n'
            + '<noscript><p style="padding:24px">This blog loads its articles with JavaScript. '
            + 'Each one is also a plain page: ' + ", ".join(
                f'<a href="posts/{esc(p["id"])}/">{esc(p["title"])}</a>' for p in index) + '.</p></noscript>\n'
            + '<script src="engine/blog-layout.js"></script>\n'
            + f'<script>var SITE = {json.dumps(data).replace("</", "<\\/")};</script>\n'
            + '<script src="engine/site.js"></script>\n')


def rss(site, posts):
    base = site["base_url"].rstrip("/")
    items = []
    for p in posts:
        url = f'{base}/posts/{p["id"]}/'
        when = datetime.datetime.strptime(p["date"][:10], "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
        items.append(f'  <item><title>{esc(p["title"])}</title><link>{esc(url)}</link>'
                     f'<guid>{esc(url)}</guid><pubDate>{format_datetime(when)}</pubDate>'
                     f'<description>{esc(p["content"])}</description></item>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
            f'<title>{esc(site["title"])}</title><link>{esc(base)}/</link>'
            f'<description>{esc(site.get("subtitle", ""))}</description>\n'
            + "\n".join(items) + '\n</channel></rss>\n')


def opml(site, roll):
    rows = "\n".join(
        f'  <outline type="rss" text="{esc(b["title"])}" htmlUrl="{esc(b["site"])}"'
        + (f' xmlUrl="{esc(b["feed"])}"' if b.get("feed") else "") + '/>' for b in roll)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head>'
            f'<title>{esc(site["title"])} — blogroll</title></head><body>\n{rows}\n</body></opml>\n')


def build(name, drafts, out_root):
    src = ROOT / "sites" / name
    if not (src / "site.yaml").exists():
        sys.exit(f"no such site: sites/{name}")
    site = yaml.safe_load((src / "site.yaml").read_text())
    site["_blogroll"] = roll = yaml.safe_load((src / "blogroll.yaml").read_text()) or []
    posts = read_posts(src, drafts)
    index = [{"id": p["id"], "title": p["title"], "date": p["date"]} for p in posts]
    known = {p["id"] for p in posts}
    top = (site.get("rail") or {}).get("top") or []
    # A top post that is a draft is fine in a production build; one that is no
    # post at all is a typo.
    every = {NAME.match(f.stem).group(2) for f in (src / "posts").glob("*.md")}
    typos = [t for t in top if t not in every]
    if typos:
        sys.exit(f"{name}: rail.top names no such post: {', '.join(typos)}")

    out = out_root / name
    if out.exists():
        shutil.rmtree(out)
    (out / "engine").mkdir(parents=True)
    for f in ("tokens.css", "blog-layout.css", "blog-layout.js", "page.css", "site.js"):
        shutil.copy(ROOT / "engine" / f, out / "engine" / f)
    shutil.copy(src / "tokens.css", out / "site.css")

    pages = [posts[i:i + PAGE_SIZE] for i in range(0, len(posts), PAGE_SIZE)] or [[]]
    (out / "feed").mkdir()
    for n, page in enumerate(pages, 1):
        (out / "feed" / f"{n}.json").write_text(json.dumps(
            {"articles": page, "next": n + 1 if n < len(pages) else None}))

    for p in posts:
        d = out / "posts" / p["id"]
        d.mkdir(parents=True)
        when = datetime.datetime.strptime(p["date"][:10], "%Y-%m-%d")
        meta = f'<time datetime="{esc(p["date"])}">{when.strftime("%B %-d, %Y")}</time> · {p["meta"]}'
        (d / "index.html").write_text(plain_page(
            site, "../../", p["title"], p["content"], meta,
            f'<a href="../../#{esc(p["id"])}">Read it in the feed</a> · <a href="../../feed.xml">RSS</a>'))

    if (src / "about.md").exists():
        meta, body = read_md(src / "about.md")
        (out / "about").mkdir()
        (out / "about" / "index.html").write_text(plain_page(site, "../", meta.get("title") or "About", body))

    (out / "index.html").write_text(feed_page(site, index, [t for t in top if t in known]))
    (out / "feed.xml").write_text(rss(site, posts))
    (out / "blogroll.opml").write_text(opml(site, roll))
    (out / "404.html").write_text(plain_page(
        site, "/", "Not found",   # served at any depth, so its paths are absolute
        '<p>Nothing lives at this address. <a href="/">Back to the blog.</a></p>'))
    print(f"built {name}: {len(posts)} post(s), {len(pages)} feed page(s) → {out.relative_to(ROOT)}"
          + ("" if posts else "  (no published posts — the feed is empty)"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("site", nargs="+")
    ap.add_argument("--drafts", action="store_true", help="include posts marked draft")
    ap.add_argument("--out", default="dist", type=Path)
    a = ap.parse_args()
    for s in a.site:
        build(s, a.drafts, (ROOT / a.out).resolve())
