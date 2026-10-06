/* The blog layout — state and behaviour for blog-layout.css.
 *
 * An app talks to the layout through the object mount() returns and never
 * through its DOM. The seams are section(id) and feed(), which hand back elements
 * for an app to fill or watch. Articles arrive through load(),
 * a page at a time, and the layout decides when to ask for the next.
 *
 *   const blog = Blog.mount({
 *     root:     document.getElementById('app'),
 *     title:    'A Blog',  subtitle: 'Of things',  home: '#',
 *     links:    [ {label, href, current, end} ],  // the banner's navigation; end holds one to the right
 *     about:    {label, href, current},           // right aligned in the banner
 *     sections: [ {id, title, content, action: {href, label, icon, download}} ],
 *     load:     function (cursor) { return Promise<{articles, next}> },
 *     has:      function (id) { return bool },    // optional; see reveal()
 *   });
 *
 *   article:  {id, title, date: 'YYYY-MM-DD', dateLabel, meta, content}
 *   icon:     'rss' | 'opml'
 *
 *   blog.reveal(id)  blog.top()  blog.section(id)  blog.feed()
 *   blog.openRail()  blog.closeRail()  blog.toggleRail()
 *   blog.on('article'|'load'|'mode', fn)  blog.refresh()  blog.destroy()
 *   Blog.archive(entries)   // the year › month tree, for a rail section
 *
 * Every article's header links to it, and the URL follows the reader: the hash
 * names the article at the top of the feed, so the address bar is always a link
 * to what is being read. Opening such a link loads pages until the article
 * arrives and scrolls to it. load() is called with `undefined` for the first
 * page and with the previous page's `next` after that; a `next` of null or
 * undefined is the end of the blog.
 */
(function (global) {
  'use strict';

  var SVG = {
    rail: '<path d="M3 5h14M3 10h14M3 15h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
    close: '<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
    rss: '<circle cx="5" cy="15" r="1.7" fill="currentColor"/><path d="M4 9.2a6.8 6.8 0 0 1 6.8 6.8M4 3.8A12.2 12.2 0 0 1 16.2 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    /* No agreed mark exists for OPML. A list whose rows are each a feed says what
       the file is: a list of subscriptions. */
    opml: '<circle cx="4.5" cy="5" r="1.4" fill="currentColor"/><circle cx="4.5" cy="10" r="1.4" fill="currentColor"/><circle cx="4.5" cy="15" r="1.4" fill="currentColor"/><path d="M9 5h7.5M9 10h7.5M9 15h7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
  };

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  }

  function icon(which) {
    var s = el('span');
    s.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">' + (SVG[which] || '') + '</svg>';
    return s.firstChild;
  }

  /* A node, a string of HTML, or nothing — whichever the app already has. */
  function fill(slot, value) {
    slot.textContent = '';
    if (value == null) return slot;
    if (typeof value === 'string') slot.innerHTML = value;
    else slot.appendChild(value);
    return slot;
  }

  /* A bare YYYY-MM-DD is a calendar date, not an instant: read and written in
     UTC so it never slips a day in the reader's time zone. */
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function fmt(d, o) {
    o.timeZone = 'UTC';
    try { return d.toLocaleDateString(undefined, o); } catch (e) { return d.toISOString().slice(0, 10); }
  }

  function hashId() {
    var h = global.location.hash.slice(1);
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  function smooth() {
    return !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function mount(opts) {
    opts = opts || {};
    var root = opts.root;
    if (!root) throw new Error('Blog.mount needs a root element');
    if (typeof opts.load !== 'function') throw new Error('Blog.mount needs a load(cursor) function');

    var listeners = {};
    var articles = [];          // in feed order
    var byId = {};
    var cursor, done = false, failed = false, loading = null;
    var current = null;         // the id the URL names
    var held = false;           // a revealed article keeps the URL until the reader moves
    var revealing = 0;          // only the latest reveal may scroll
    var railOpen = false;
    var dims = { rail: 0, feedMin: 0 };

    /* ---- DOM ------------------------------------------------------------ */

    root.classList.add('blog');
    root.textContent = '';

    var banner = el('header', 'blog-banner');
    var head = el('div', 'blog-head');
    var titles = el('div', 'blog-titles');
    var title = el('h1', 'blog-title');
    if (opts.home != null) {
      var home = el('a', null, { href: opts.home });
      home.textContent = opts.title || '';
      title.appendChild(home);
    } else {
      title.textContent = opts.title || '';
    }
    var subtitle = el('p', 'blog-subtitle');
    subtitle.textContent = opts.subtitle || '';
    subtitle.hidden = !opts.subtitle;
    titles.appendChild(title);
    titles.appendChild(subtitle);

    var end = el('div', 'blog-end');
    if (opts.about) {
      var about = el('a', 'blog-about', { href: opts.about.href });
      about.textContent = opts.about.label || 'About';
      if (opts.about.current) about.setAttribute('aria-current', 'page');
      end.appendChild(about);
    }
    var railId = 'blog-rail-' + Math.random().toString(36).slice(2, 8);
    var railBtn = el('button', 'blog-btn', {
      type: 'button', 'aria-expanded': 'false', 'aria-controls': railId,
      'aria-label': opts.railLabel || 'Index'
    });
    railBtn.appendChild(icon('rail'));
    railBtn.hidden = true;
    end.appendChild(railBtn);

    head.appendChild(titles);
    head.appendChild(end);

    var links = el('nav', 'blog-links', { 'aria-label': opts.linksLabel || 'Site' });
    (opts.links || []).forEach(function (l) {
      var a = el('a', null, { href: l.href });
      a.textContent = l.label;
      if (l.current) a.setAttribute('aria-current', 'page');
      if (l.end) a.setAttribute('data-end', '');
      links.appendChild(a);
    });
    links.hidden = !links.firstChild;

    banner.appendChild(head);
    banner.appendChild(links);

    var feed = el('main', 'blog-feed', { tabindex: '-1' });
    var inner = el('div', 'blog-feed-inner');
    var status = el('div', 'blog-status', { role: 'status' });
    inner.appendChild(status);
    feed.appendChild(inner);

    var rail = el('aside', 'blog-rail', { id: railId, tabindex: '-1',
                                          'aria-label': opts.railLabel || 'Index' });
    var sections = {};
    (opts.sections || []).forEach(function (s) { rail.appendChild(buildSection(s)); });

    var scrim = el('div', 'blog-scrim');
    scrim.hidden = true;

    root.appendChild(banner);
    root.appendChild(feed);
    root.appendChild(rail);
    root.appendChild(scrim);

    function buildSection(s) {
      var sec = el('section', 'blog-section');
      var h = el('h2', 'blog-section-title', { id: 'blog-section-' + s.id });
      h.textContent = s.title || '';
      sec.setAttribute('aria-labelledby', h.id);
      var bar = el('div', 'blog-section-head');
      if (s.action) {
        var a = el('a', 'blog-btn', {
          href: s.action.href, 'aria-label': s.action.label, title: s.action.label
        });
        if (s.action.download) a.setAttribute('download', s.action.download);
        a.appendChild(icon(s.action.icon));
        bar.appendChild(a);
        sections[s.id + ':action'] = a;
      }
      bar.appendChild(h);
      var body = el('div', 'blog-section-body');
      fill(body, s.content);
      sec.appendChild(bar);
      sec.appendChild(body);
      sections[s.id] = body;
      return sec;
    }

    /* ---- events --------------------------------------------------------- */

    function emit(name, detail) {
      (listeners[name] || []).forEach(function (fn) { fn(detail); });
    }

    /* ---- articles ------------------------------------------------------- */

    function buildArticle(a) {
      var art = el('article', 'blog-article', { id: a.id, tabindex: '-1' });
      var hd = el('header', 'blog-article-head');
      var h = el('h2', 'blog-article-title', { id: 'blog-h-' + a.id });
      var link = el('a', null, { href: '#' + encodeURIComponent(a.id) });
      link.textContent = a.title || '';
      h.appendChild(link);
      art.setAttribute('aria-labelledby', h.id);
      hd.appendChild(h);

      var d = day(a.date);
      if (d || a.dateLabel || a.meta) {
        var meta = el('div', 'blog-article-meta');
        if (d || a.dateLabel) {
          var t = el('time', null, d ? { datetime: a.date } : {});
          t.textContent = a.dateLabel || fmt(d, { year: 'numeric', month: 'long', day: 'numeric' });
          meta.appendChild(t);
        }
        if (a.meta) {
          if (meta.firstChild) meta.appendChild(document.createTextNode(' · '));
          var m = el('span');
          fill(m, a.meta);
          meta.appendChild(m);
        }
        hd.appendChild(meta);
      }

      var body = el('div', 'blog-article-body');
      fill(body, a.content);
      art.appendChild(hd);
      art.appendChild(body);
      return art;
    }

    function append(a) {
      if (!a || a.id == null || byId[a.id]) return;   // pages that overlap add nothing
      var node = buildArticle(a);
      inner.insertBefore(node, status);
      byId[a.id] = node;
      articles.push(node);
    }

    function setStatus(state) {
      status.textContent = '';
      if (state === 'loading') status.textContent = opts.loadingText || 'Loading…';
      if (state === 'end' && articles.length) status.textContent = opts.endText || 'That’s everything.';
      if (state === 'error') {
        status.appendChild(document.createTextNode(opts.errorText || 'Couldn’t load more.'));
        var retry = el('button', null, { type: 'button' });
        retry.textContent = 'Try again';
        retry.addEventListener('click', function () { failed = false; loadMore(); });
        status.appendChild(retry);
      }
    }

    /* One page in flight at most; a second caller shares the first's promise,
       which resolves true when the page arrived and false when it did not. */
    function loadMore() {
      if (loading) return loading;
      if (done || failed) return Promise.resolve(false);
      setStatus('loading');
      feed.setAttribute('aria-busy', 'true');
      loading = Promise.resolve()
        .then(function () { return opts.load(cursor); })
        .then(function (page) {
          page = page || {};
          (page.articles || []).forEach(append);
          cursor = page.next;
          done = page.next == null;
          root.dataset.feedEnd = String(done);
          return true;
        }, function (err) {
          failed = true;
          if (global.console) console.error('Blog: load failed', err);
          return false;
        })
        .then(function (ok) {
          loading = null;
          feed.removeAttribute('aria-busy');
          setStatus(failed ? 'error' : done ? 'end' : '');
          if (ok) emit('load', { count: articles.length, done: done });
          global.requestAnimationFrame(onScroll);
          return ok;
        });
      return loading;
    }

    /* How far ahead of the reader the next page is fetched: a screen and a half,
       so on an ordinary connection they never see the loading line at all. */
    function nearEnd() {
      return feed.scrollHeight - feed.scrollTop - feed.clientHeight < feed.clientHeight * 1.5;
    }

    /* ---- the URL follows the reader ------------------------------------- */

    function setCurrent(id) {
      if (id === current) return;
      current = id;
      if (opts.trackHash !== false && id != null) {
        /* replaceState rather than location.hash: the reader's back button is for
           the places they went, not every article they scrolled past. */
        try { global.history.replaceState(global.history.state, '', '#' + encodeURIComponent(id)); }
        catch (e) { /* a sandboxed frame may refuse; the layout still works */ }
      }
      Array.prototype.forEach.call(rail.querySelectorAll('a[aria-current="location"]'), function (a) {
        a.removeAttribute('aria-current');
      });
      if (id != null) {
        Array.prototype.forEach.call(rail.querySelectorAll('a[href="#' + cssEsc(encodeURIComponent(id)) + '"]'),
          function (a) { a.setAttribute('aria-current', 'location'); });
      }
      emit('article', { id: id });
    }

    function cssEsc(s) {
      return global.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
    }

    /* The article being read is the last one whose top has passed a line a fifth
       of the way down the feed. */
    function reading() {
      var line = feed.getBoundingClientRect().top + feed.clientHeight * 0.2;
      var lo = 0, hi = articles.length - 1, at = -1;
      while (lo <= hi) {                       // articles are in document order
        var mid = (lo + hi) >> 1;
        if (articles[mid].getBoundingClientRect().top <= line) { at = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return at < 0 ? (articles[0] ? articles[0].id : null) : articles[at].id;
    }

    var ticking = false;
    function onScroll() {
      ticking = false;
      root.dataset.scrolled = String(feed.scrollTop > 8);
      if (!held && articles.length) setCurrent(reading());
      if (!done && !failed && !loading && nearEnd()) loadMore();
    }
    feed.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; global.requestAnimationFrame(onScroll); }
    }, { passive: true });

    /* A reveal holds the URL on the article it went to — the last article may
       never reach the reading line — until the reader moves the feed themselves. */
    function release() { held = false; }
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (t) {
      feed.addEventListener(t, release, { passive: true });
    });

    /* ---- reveal --------------------------------------------------------- */

    function reveal(id, o) {
      o = o || {};
      var mine = ++revealing;
      function land(node) {
        if (mine !== revealing) return false;
        held = true;
        setCurrent(id);
        node.scrollIntoView({ block: 'start', behavior: o.instant || !smooth() ? 'instant' : 'smooth' });
        if (o.focus) node.focus({ preventScroll: true });
        return true;
      }
      if (byId[id]) return Promise.resolve(land(byId[id]));
      if (typeof opts.has === 'function' && !opts.has(id)) return Promise.resolve(false);
      return (function step() {
        if (mine !== revealing) return Promise.resolve(false);
        if (byId[id]) return Promise.resolve(land(byId[id]));
        if (done || failed) return Promise.resolve(false);
        return loadMore().then(function (ok) { return ok ? step() : false; });
      })();
    }

    function top() {
      revealing++;
      held = false;
      feed.scrollTo({ top: 0, behavior: smooth() ? 'smooth' : 'instant' });
    }

    /* A hash that names an article reveals it; a bare # is the top of the feed.
       A hash naming something else on the page is left to the browser. */
    function onHash() {
      var id = hashId();
      if (id === current) return;
      if (!id) return top();
      var other = document.getElementById(id);
      if (other && !byId[id]) return;
      reveal(id, { focus: true });
    }

    /* ---- rail ----------------------------------------------------------- */

    function measure() {
      var cs = getComputedStyle(root);
      dims.rail = parseFloat(cs.getPropertyValue('--blog-rail-w')) || 0;
      dims.feedMin = parseFloat(cs.getPropertyValue('--blog-feed-min')) || 0;
    }

    function apply() {
      var inline = root.clientWidth >= dims.rail + dims.feedMin;
      if (inline) railOpen = false;
      root.dataset.rail = inline ? 'inline' : 'overlay';
      root.dataset.railOpen = String(railOpen);
      railBtn.hidden = inline;
      railBtn.setAttribute('aria-expanded', String(railOpen));
      scrim.hidden = !railOpen;
      emit('mode', { rail: root.dataset.rail, railOpen: railOpen });
    }

    function setRail(open) {
      if (root.dataset.rail !== 'overlay') open = false;
      if (open === railOpen) return api;
      railOpen = open;
      apply();
      if (open) rail.focus({ preventScroll: true });
      return api;
    }

    /* ---- API ------------------------------------------------------------ */

    var api = {
      reveal: reveal,
      top: function () { top(); return api; },

      /* Where a rail section's contents go, and the element the reader scrolls. */
      section: function (id) { return sections[id] || null; },
      feed: function () { return feed; },

      /* The href of a section's icon button — an app that builds its feed file
         after mounting points the button at it here. */
      setAction: function (id, href) {
        var a = sections[id + ':action'];
        if (a) a.setAttribute('href', href);
        return api;
      },

      openRail: function () { return setRail(true); },
      closeRail: function () { return setRail(false); },
      toggleRail: function () { return setRail(!railOpen); },

      on: function (name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
        return api;
      },

      refresh: function () { measure(); apply(); onScroll(); return api; },

      destroy: function () {
        revealing++;
        if (ro) ro.disconnect();
        else global.removeEventListener('resize', apply);
        global.removeEventListener('hashchange', onHash);
        document.removeEventListener('keydown', onKey);
      }
    };

    /* ---- wiring --------------------------------------------------------- */

    railBtn.addEventListener('click', function () { api.toggleRail(); });
    scrim.addEventListener('click', function () { api.closeRail(); });
    /* An overlaid rail covers what its links go to, so following one puts it away. */
    rail.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (railOpen && a && !a.hasAttribute('download')) api.closeRail();
    });

    function onKey(e) {
      if (e.key === 'Escape' && railOpen) { api.closeRail(); railBtn.focus(); }
    }
    document.addEventListener('keydown', onKey);
    global.addEventListener('hashchange', onHash);

    var ro = null;
    if (global.ResizeObserver) {
      ro = new ResizeObserver(function () { apply(); });
      ro.observe(root);
    } else {
      global.addEventListener('resize', apply);
    }

    measure();
    apply();
    /* Arriving on a link to an article is the same as following one, except that
       it jumps rather than glides: there is nothing yet to glide from. */
    var first = hashId();
    if (first && !(document.getElementById(first))) {
      reveal(first, { instant: true }).then(function (found) { if (!found) loadMore(); });
    } else {
      loadMore();
    }
    return api;
  }

  /* The archive: years, then months, then posts, newest first, as nested
     <details> so it needs no script to open and close. The newest year and month
     start open. Entries are {id, title, date: 'YYYY-MM-DD', href}; href defaults
     to the article's own link in the feed. */
  function archive(entries, o) {
    o = o || {};
    var years = [], byYear = {};
    entries.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
      .forEach(function (e) {
        var d = day(e.date);
        if (!d) return;
        var y = d.getUTCFullYear(), m = d.getUTCMonth();
        if (!byYear[y]) { byYear[y] = { year: y, months: [], byMonth: {}, n: 0 }; years.push(byYear[y]); }
        var Y = byYear[y];
        if (!Y.byMonth[m]) { Y.byMonth[m] = { d: d, posts: [] }; Y.months.push(Y.byMonth[m]); }
        Y.byMonth[m].posts.push(e);
        Y.n++;
      });

    function group(label, n, open) {
      var det = el('details');
      if (open) det.open = true;
      var sum = el('summary');
      sum.appendChild(document.createTextNode(label));
      var c = el('span', 'blog-count');
      c.textContent = n;
      sum.appendChild(c);
      det.appendChild(sum);
      return det;
    }

    var tree = el('ul', 'blog-tree');
    years.forEach(function (Y, yi) {
      var li = el('li');
      var det = group(String(Y.year), Y.n, yi === 0 && o.open !== false);
      var ul = el('ul');
      Y.months.forEach(function (M, mi) {
        var mli = el('li');
        var mdet = group(fmt(M.d, { month: 'long' }), M.posts.length, yi === 0 && mi === 0 && o.open !== false);
        var pl = el('ul');
        M.posts.forEach(function (p) {
          var pli = el('li');
          var a = el('a', null, { href: p.href || '#' + encodeURIComponent(p.id) });
          a.textContent = p.title;
          pli.appendChild(a);
          pl.appendChild(pli);
        });
        mdet.appendChild(pl);
        mli.appendChild(mdet);
        ul.appendChild(mli);
      });
      det.appendChild(ul);
      li.appendChild(det);
      tree.appendChild(li);
    });
    return tree;
  }

  global.Blog = { mount: mount, archive: archive };
})(window);
