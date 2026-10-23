/* posts.js — reveal real posts from the site's RSS feed into a timeline.
   Place <ul id="postList" class="timeline"></ul> on the page; the script
   fills it with <li class="tl-item">. Each page fetches its own index.xml
   (home -> root feed of all posts; /post/ -> that section's feed), so new
   Hugo posts appear automatically. On failure or an empty feed, falls back
   to the page's own <noscript>/default empty state. */
(function () {
  var list = document.getElementById('postList');
  var feed = (list && list.getAttribute('data-feed')) || 'index.xml';

  function strip(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function toDate(s) {
    var t = Date.parse(s || '');
    return isNaN(t) ? null : new Date(t);
  }

  function fmt(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function itemsFromRss2(xml) {
    var out = [];
    var nodes = xml.querySelectorAll('channel > item');
    nodes.forEach(function (n) {
      var title = n.getElementsByTagName('title')[0];
      var link = n.getElementsByTagName('link')[0];
      var date = n.getElementsByTagName('pubDate')[0];
      var desc = n.getElementsByTagName('description')[0];
      out.push({
        title: title ? title.textContent.trim() : '',
        link: link ? link.textContent.trim() : '',
        date: toDate(date && date.textContent),
        desc: desc ? strip(desc.textContent) : ''
      });
    });
    return out;
  }

  function itemsFromAtom(xml) {
    var out = [];
    var nodes = xml.querySelectorAll('feed > entry');
    nodes.forEach(function (n) {
      var title = n.getElementsByTagName('title')[0];
      var link = n.querySelector('link'); /* atom link element */
      var date = n.getElementsByTagName('updated')[0] || n.getElementsByTagName('published')[0];
      var content = n.getElementsByTagName('content')[0] || n.getElementsByTagName('summary')[0];
      out.push({
        title: title ? title.textContent.trim() : '',
        link: link ? (link.getAttribute('href') || '').trim() : '',
        date: toDate(date && date.textContent),
        desc: content ? strip(content.textContent) : ''
      });
    });
    return out;
  }

  function relative(u) {
    return u.replace(/^https?:\/\/[^/]+/, '');
  }

  function render(items) {
    var list = document.getElementById('postList');
    if (!list) return;

    // Check if the page already has pre-rendered items.
    // If it does, and the feed has fewer items or doesn't bring anything new,
    // do NOT wipe the DOM to prevent content downgrade or flicker from cached feeds.
    var existingItems = list.querySelectorAll('.tl-item:not(.empty)');
    if (existingItems.length > 0 && items.length <= existingItems.length) {
      var existingLinks = [];
      for (var i = 0; i < existingItems.length; i++) {
        var a = existingItems[i].querySelector('a');
        if (a) existingLinks.push(a.getAttribute('href') || '');
      }
      var hasNew = items.some(function (it) {
        var rel = relative(it.link);
        return !existingLinks.some(function (l) {
          return l && (l.indexOf(rel) !== -1 || rel.indexOf(l) !== -1);
        });
      });
      if (!hasNew) {
        return;
      }
    }

    var frag = document.createDocumentFragment();
    items.forEach(function (it) {
      if (!it.title) return;
      var li = document.createElement('li');
      li.className = 'tl-item';
      var t = '';
      if (it.date) t += '<time>' + fmt(it.date) + '</time>';
      t += '<div class="tt"><a href="' + relative(it.link) + '">' + it.title + '</a></div>';
      if (it.desc) t += '<p>' + it.desc + '</p>';
      li.innerHTML = t;
      frag.appendChild(li);
    });
    list.replaceChildren(frag);
  }

  fetch(feed, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('feed ' + r.status); return r.text(); })
    .then(function (text) {
      var xml = new DOMParser().parseFromString(text, 'text/xml');
      var root = xml.documentElement;
      var items = root && (root.nodeName === 'feed')
        ? itemsFromAtom(xml)
        : itemsFromRss2(xml);
      if (items.length) render(items);
    })
    .catch(function () { /* keep default empty state */ });
})();