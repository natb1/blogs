/* A built site's feed page — the app that Blog.mount is handed.
 *
 * tools/build.py writes the page and a SITE object: the site's words, an index of
 * every article (id, title, date), and its blogroll. Articles themselves arrive
 * from feed/N.json, a page at a time, as the layout asks for them.
 */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  var byId = {};
  SITE.index.forEach(function (p) { byId[p.id] = p; });

  var list = function (items) { return '<ul class="blog-list">' + items.join('') + '</ul>'; };
  var month = function (iso) {
    return new Date(iso.slice(0, 10) + 'T00:00:00Z')
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  };

  /* A rail section is listed only when it has something in it. */
  var rail = SITE.rail || {}, sections = [];
  if (SITE.top.length) sections.push({ id: 'top', title: 'Top posts',
    content: list(SITE.top.map(function (id) {
      return '<li><a href="#' + encodeURIComponent(id) + '">' + esc(byId[id].title) + '</a><small>' + month(byId[id].date) + '</small></li>';
    })) });
  if (rail.blogroll && SITE.blogroll.length) sections.push({ id: 'roll', title: 'Blogroll',
    content: list(SITE.blogroll.map(function (b) {
      return '<li><a href="' + esc(b.site) + '" rel="noopener">' + esc(b.title) + '</a>' + (b.note ? '<small>' + esc(b.note) + '</small>' : '') + '</li>';
    })),
    action: { href: 'blogroll.opml', label: 'Blogroll as OPML', icon: 'opml', download: 'blogroll.opml' } });
  if (rail.archive) sections.push({ id: 'archive', title: 'Archive', content: '<div data-archive></div>',
    action: { href: 'feed.xml', label: 'RSS feed', icon: 'rss' } });

  var here = function (l) { return { label: l.label, href: l.href, current: l.href === '/' }; };

  var blog = Blog.mount({
    root: document.getElementById('app'),
    title: SITE.title, subtitle: SITE.subtitle, home: '#',
    links: SITE.links.map(here),
    about: SITE.about || undefined,
    sections: sections,
    load: function (cursor) {
      return fetch('feed/' + (cursor || 1) + '.json').then(function (r) {
        if (!r.ok) throw new Error('feed page ' + (cursor || 1) + ': ' + r.status);
        return r.json();
      });
    },
    has: function (id) { return !!byId[id]; }
  });

  if (rail.archive) blog.section('archive').querySelector('[data-archive]').appendChild(Blog.archive(SITE.index));
})();
