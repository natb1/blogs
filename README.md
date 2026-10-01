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
    site.yaml                        title, subtitle, links, rail sections, Pages project
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

`.github/workflows/deploy.yml` builds each folder under `sites/` and deploys it to
the Cloudflare Pages project named by `pages_project` in its `site.yaml`.

| Event | Result |
|---|---|
| Push to `main` | Production: `<project>.pages.dev`, drafts left out |
| Any other branch, or a pull request | Preview: `<branch>.<project>.pages.dev`, drafts included |

It needs two repository secrets, `CLOUDFLARE_API_TOKEN` (permission *Account ›
Cloudflare Pages › Edit*) and `CLOUDFLARE_ACCOUNT_ID`. Projects are created on
first deploy. Custom domains are attached in the Cloudflare dashboard; set
`base_url` in `site.yaml` to match, since `feed.xml` is built from it.

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
