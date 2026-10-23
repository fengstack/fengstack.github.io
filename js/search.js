/* 文章列表页客户端搜索:过滤 #postList 静态条目,零依赖、零额外网络请求。
   每次过滤实时重查节点,与 posts.js 的 feed 重渲染兼容。
   支持 ?q= 参数直链;Esc 清空;无结果时显示空态提示。 */
(function () {
  var input = document.getElementById('searchInput');
  var list = document.getElementById('postList');
  if (!input || !list) return;

  var countEl = document.querySelector('.search-count');
  var emptyEl = document.createElement('li');
  emptyEl.className = 'tl-item empty';
  emptyEl.style.display = 'none';
  emptyEl.innerHTML = '<p style="margin:0">没有匹配的文章，换个关键词试试。</p>';

  function apply() {
    if (emptyEl.parentNode !== list) list.appendChild(emptyEl);
    var items = Array.prototype.slice.call(list.querySelectorAll('.tl-item:not(.empty)'));
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (li) {
      var hit = !q || li.textContent.toLowerCase().indexOf(q) !== -1;
      li.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    emptyEl.style.display = shown ? 'none' : '';
    if (countEl) countEl.textContent = q ? shown + ' / ' + items.length : '';
    try {
      history.replaceState(null, '', q ? ('?q=' + encodeURIComponent(input.value.trim())) : location.pathname);
    } catch (e) { /* file:// 等环境忽略 */ }
  }

  input.addEventListener('input', apply);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; apply(); input.blur(); }
  });

  var q0;
  try { q0 = new URLSearchParams(location.search).get('q'); } catch (e) {}
  if (q0) { input.value = q0; apply(); }
})();
