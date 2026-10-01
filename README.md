# blogs

Two blogs, one engine. The engine is the presentation: a banner, an endless feed
whose URL follows the reader, and a rail that scrolls on its own (top posts,
blogroll with OPML, archive with RSS). Each site is content and a few tokens.

```
engine/
  blog-layout.css · blog-layout.js   the layout; an app talks to it only through Blog.mount
  tokens.css                         default colours and typefaces
  site.js                            a built site's feed page: mounts the layout from site data
  page.css                           plain pages — one article, About — with no script
  demo.html                          the layout's harness, a blog written about itself
sites/
  alpha/  beta/                      one folder per blog, same shape:
    site.yaml                        title, subtitle, links, rail sections
    tokens.css                       the tokens this site changes
    blogroll.yaml                    the blogs it reads → blogroll.opml
    about.md
    posts/YYYY-MM-DD-slug.md         front matter: title, date, draft
tools/
  build.py                           a site folder → static files in dist/
  check_tokens.py                    fails when a sheet's two dark blocks disagree
```

## Build

```sh
pip install -r requirements.txt
python3 tools/build.py alpha beta        # → dist/alpha, dist/beta
python3 tools/build.py alpha --drafts    # with posts marked `draft: true`
python3 -m http.server -d dist/alpha 8000
```

A site builds to static files: `index.html` mounts the layout and fetches
`feed/N.json` a page at a time; every article is also a plain page at
`posts/<slug>/`, which is what `feed.xml` links, so links, crawlers and readers
without JS land somewhere real.

## Deploy

Cloudflare Pages builds and deploys each site through its Git integration: no
token, nothing stored in GitHub. Each site is its own Pages project connected to
this repo, set up once in the Cloudflare dashboard:

| Setting | Value (for `alpha`) |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | `pip install -r requirements.txt && python3 tools/build.py alpha` |
| Build output directory | `dist/alpha` |
| Root directory | *(leave empty)* |
| Build watch paths (include) | `engine/*`, `tools/*`, `requirements.txt`, `sites/alpha/*` |

A push to `main` deploys production with drafts left out. Any other branch gets a
preview at `<branch>.<project>.pages.dev` with drafts included — the build reads
Cloudflare's `CF_PAGES_BRANCH` to tell which it is. `.python-version` picks the
Python the build runs on. Custom domains are attached in the dashboard; set
`base_url` in `site.yaml` to match, since `feed.xml` is built from it.

`.github/workflows/check.yml` builds every site on each push and pull request, so
a broken build shows on the PR rather than only in Cloudflare.

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
