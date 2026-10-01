# blogs

Two blogs, one engine. The engine is the presentation: a banner, an endless feed
whose URL follows the reader, and a rail that scrolls on its own (top posts,
blogroll with OPML, archive with RSS). Each site is content and a few tokens.

```
engine/
  blog-layout.css · blog-layout.js   the layout; an app talks to it only through Blog.mount
  tokens.css                         default colours and typefaces
  demo.html                          the layout's harness, a blog written about itself
sites/
  alpha/  beta/                      one folder per blog, same shape:
    site.yaml                        title, subtitle, links, rail sections
    tokens.css                       the tokens this site changes
    blogroll.yaml                    the blogs it reads → blogroll.opml
    about.md
    posts/YYYY-MM-DD-slug.md         front matter: title, date, draft
tools/
  check_tokens.py                    fails when a sheet's two dark blocks disagree
```

## Status

The engine is moved in from where it was first built; the two sites are stubs.
Not yet written: the build that turns a site folder into static files — paged
feed JSON for `load(cursor)`, `feed.xml`, `blogroll.opml`, and a plain HTML page
per article so links, crawlers and readers without JS all land somewhere real.

## Try the layout

```sh
python3 -m http.server -d engine 8000   # then open http://localhost:8000/demo.html
```

## Checks

```sh
python3 tools/check_tokens.py
```

## Splitting later

The sites share a repo while the engine is still changing, so an engine change and
its fallout land in one commit. When the engine settles, or a site needs different
visibility (this repo is public — drafts included), `engine/` becomes its own repo
and each site pins a version of it.
