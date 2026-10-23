// 文章页增强:标题锚点、桌面端右侧目录、代码块语法高亮 + 语言标签 + 复制按钮。
// 语法高亮依赖 highlight.js(common 包,由文章页 <script> 引入,缺失时自动退化为纯样式)。
(() => {
  const body = document.querySelector('.article-body');
  if (!body) return;

  const headings = Array.from(body.querySelectorAll('h2, h3'));
  if (!headings.length) return;

  /* ---- 标题:补 GitHub 风格 slug id ---- */
  const used = new Set();
  const slugify = (text) =>
    text.toLowerCase().trim().replace(/[^\w一-鿿]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  for (const h of headings) {
    let id = slugify(h.textContent);
    let n = 2;
    while (used.has(id)) id = `${slugify(h.textContent)}-${n++}`;
    used.add(id);
    h.id = id;
  }

  /* ---- 目录:CSS 控制仅桌面端显示,滚动监听高亮当前小节 ---- */
  if (headings.length >= 3) {
    const toc = document.createElement('nav');
    toc.className = 'toc';
    toc.setAttribute('aria-label', '文章目录');
    const title = document.createElement('div');
    title.className = 'toc-title';
    title.textContent = 'ON THIS PAGE';
    toc.appendChild(title);
    for (const h of headings) {
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent;
      if (h.tagName === 'H3') a.classList.add('lvl3');
      toc.appendChild(a);
    }
    document.body.appendChild(toc);

    const tocLinks = Array.from(toc.querySelectorAll('a'));
    let ticking = false;
    const spy = () => {
      let current = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 96) current = h;
        else break;
      }
      for (const a of tocLinks) {
        a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`);
      }
    };
    document.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { spy(); ticking = false; });
    }, { passive: true });
    spy();
  }

  /* ---- 标题悬停锚点(在目录取文本之后追加,避免 '#' 混进目录) ---- */
  for (const h of headings) {
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', '链接到此标题');
    a.textContent = '#';
    h.appendChild(a);
  }

  /* ---- 代码块:高亮、语言标签、复制 ---- */
  const NICE = {
    xml: 'XML', java: 'Java', go: 'Go', rust: 'Rust', python: 'Python',
    bash: 'Shell', shell: 'Shell', json: 'JSON', yaml: 'YAML', sql: 'SQL',
    diff: 'Diff', ini: 'INI', properties: 'Properties', markdown: 'Markdown',
    dockerfile: 'Dockerfile', kotlin: 'Kotlin', javascript: 'JavaScript', typescript: 'TypeScript',
  };

  // highlight.js 未能识别时的兜底启发式
  const guessLanguage = (t) => {
    if (/^\s*<\?xml|^\s*<project|^\s*<\/[a-zA-Z-]+>\s*$/m.test(t)) return 'XML';
    if (/^\s*(package [a-z.]+;|import java|public\s+(class|interface|static)|@Test)/m.test(t)) return 'Java';
    if (/^\s*(func |package main|import ")/m.test(t)) return 'Go';
    if (/^\s*(fn |use [a-z:]+;|let\s+mut|impl\s)/m.test(t)) return 'Rust';
    if (/^\s*(def \w|import \w+$|from \S+ import)/m.test(t)) return 'Python';
    if (/^\s*(\$ )?(mvn|gradle|git|curl|docker|kubectl|sudo|cd |export |source )/m.test(t)) return 'Shell';
    if (/^(diff --git|@@ -)/m.test(t)) return 'Diff';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/im.test(t)) return 'SQL';
    if (/^\s*[{[]/.test(t) && /"[^"]+"\s*:/.test(t)) return 'JSON';
    return '';
  };

  for (const pre of body.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;

    const box = document.createElement('div');
    box.className = 'code-block';
    pre.before(box);
    box.append(pre);

    const head = document.createElement('div');
    head.className = 'code-head';
    const lang = document.createElement('span');
    lang.className = 'code-lang';

    let name = '';
    if (window.hljs) {
      try {
        const res = hljs.highlightElement(code);
        if (res && res.language) name = NICE[res.language] || res.language.toUpperCase();
      } catch (e) { /* 高亮失败不影响展示 */ }
    }
    if (!name) name = guessLanguage(code.textContent);
    if (name) lang.textContent = name; else lang.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = '复制';
    btn.addEventListener('click', async () => {
      const text = code.innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove();
      }
      btn.textContent = '✓ 已复制';
      btn.classList.add('ok');
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.textContent = '复制';
        btn.classList.remove('ok');
      }, 1600);
    });

    head.append(lang, btn);
    box.prepend(head);
  }
})();
