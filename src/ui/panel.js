  function initUI() {
    host = document.createElement('div');
    host.id = 'chatgpt-turn-nav-userscript';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    shadow.appendChild(style);
    const root = document.createElement('div');
    root.innerHTML = `
      <button id="launcher" title="对话导航（Alt+Shift+J）" aria-label="展开对话导航">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h11M4 19h16"/><path d="M18 9v6m-3-3h6"/></svg>
      </button>
      <div id="rail" aria-label="轮次缩略导航"><div id="track" role="slider" tabindex="0"
        aria-label="按位置跳转对话轮次" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
        <div id="marker"></div></div></div>
      <div id="preview" role="tooltip"></div>
      <section id="panel" aria-label="对话轮次目录">
        <div class="head" id="dragHeader" title="点击固定目录；按住上下拖动">
          <div class="title">☷ 对话目录 <span class="count" id="counter"></span></div>
          <div class="head-controls"><button class="close gear" id="settingsToggle" title="调整布局" aria-label="设置布局">⚙</button>
          <button class="close" id="close" aria-label="关闭目录">×</button></div></div>
        <div class="settings" id="settings">
          <label>上下 <input id="layoutY" type="range" min="0" max="80" step="1"><output id="valY"></output></label>
          <label>宽度 <input id="layoutW" type="range" min="285" max="650" step="5"><output id="valW"></output></label>
          <label>高度 <input id="layoutH" type="range" min="260" max="1100" step="10"><output id="valH"></output></label>
          <span class="drag-hint">悬停临时展开 · 点击刻度或目录任意位置后固定 · × 关闭</span>
          <span class="drag-hint">右侧固定 · 标题栏上下移动 · 左下角调整宽高 · 自动记忆</span>
          <span class="drag-hint">Alt+Shift+F 搜索 · Alt+Shift+J 显示/隐藏 · Alt+Shift+↑↓ 切换</span>
          <div class="setting-actions"><button type="button" id="rebuildOrder" title="历史接口返回 404 时，依次扫描正文并按实际位置重建顺序；扫描完成后恢复阅读位置">↕ 扫描校正排序</button><button type="button" id="diagnose" title="只复制节点数量，不包含聊天内容">复制诊断</button>
            <button type="button" id="resetLayout">恢复默认布局</button><button type="button" id="clearReading">清除阅读记录</button></div>
        </div>
        <input id="search" class="search" placeholder="搜索提问、回答章节或轮次编号…" type="search" aria-label="搜索对话轮次" />
        <div class="search-tools"><select id="searchScope" aria-label="搜索范围" title="正文搜索仅覆盖已取得内容，不会自动加载全对话">
          <option value="outline">提问 / 标题</option><option value="body">已缓存正文</option></select><span id="searchMeta" aria-live="polite">↑↓ 选择</span>
          <button class="chip" type="button" id="mountedOnly" aria-pressed="false" title="当前显示全部已索引轮次；点击仅显示正文已加载轮次">全部轮次</button></div>
        <div class="outline-tools" aria-label="回答目录操作">
          <button class="chip" type="button" id="expandAll">全部展开</button>
          <button class="chip" type="button" id="collapseAll">全部折叠</button>
          <button class="chip" type="button" id="focusCurrent" title="只在目录中显示当前位置，不滚动正文">定位当前</button>
        </div>
        <div id="coverage" class="coverage" aria-live="polite"></div>
        <div id="list" aria-label="轮次与回答章节"></div>
        <div class="foot"><div class="hint" id="hint">仅在浏览器本地运行，不上传对话内容。</div>
          <div class="actions"><button class="action" id="returnPos" disabled title="返回上一次跳转前的正文位置">↶ 返回原位置</button>
          <button class="action" id="jumpLast">最新一轮</button>
          <button class="action" id="jumpTop">加载更早</button>
          <button class="action" id="refresh">重新读取目录</button>
          <button class="action" id="exportAll" data-export-action="all" title="点击下载整个当前分支；Shift+点击复制 Markdown。不受搜索或仅已加载筛选影响">↓ 导出整个对话</button>
          <button class="action" id="exportCurrent" data-export-action="turn" title="导出当前阅读轮次的完整提问及回答为 .md 文件">↓ 导出当前 Q/A</button>
          <button class="action" id="copyCurrent" data-export-action="turn" title="直接复制当前 Q/A 的 Markdown">⧉ 复制当前 Q/A</button>
          <button class="action" id="resumeReading" disabled title="按消息身份恢复上次阅读处，不会自动滚动">↩ 继续上次阅读</button></div></div>
        <div id="mdActions" class="md-actions" role="menu" hidden></div>
        <div id="copyFallback" class="copy-fallback" hidden><div class="copy-title">Markdown 已准备好</div>
          <p>浏览器未允许自动复制。点文本框全选后按 Ctrl+C / ⌘C，或再次点击复制。</p>
          <textarea id="copyText" readonly aria-label="待复制的 Markdown"></textarea>
          <div><button type="button" id="copyRetry">再次复制</button><button type="button" id="copyClose">关闭</button></div></div>
        <button type="button" id="resizeHandle" aria-label="从左下角调整目录宽高" title="向左拖动加宽，向下拖动加高"></button>
      </section>`;
    shadow.appendChild(root);
    (document.body || document.documentElement).appendChild(host);
    panel = shadow.getElementById('panel');
    list = shadow.getElementById('list');
    search = shadow.getElementById('search');
    counter = shadow.getElementById('counter');
    rail = shadow.getElementById('rail');
    track = shadow.getElementById('track');
    marker = shadow.getElementById('marker');
    preview = shadow.getElementById('preview');
    jumpTop = shadow.getElementById('jumpTop');
    initializeLayout();
    initializeEnhancements();

    shadow.getElementById('launcher').addEventListener('click', () => {
      // The top icon still toggles a locked-open panel.
      clearTimeout(hoverCloseTimer);
      pinned = !pinned;
      togglePanel(pinned);
    });
    shadow.getElementById('close').addEventListener('click', () => {
      if(navigation.current)cancelSeek();
      // Explicit close must always override the general click-to-pin handler.
      clearTimeout(hoverCloseTimer);
      pinned = false; togglePanel(false);
    });
    // A single click anywhere on the minimap or inside the visible directory
    // locks it open, not just a click on the top launcher. Use capture to pin
    // before a navigation, filter, TOC expansion or search click is processed.
    rail.addEventListener('click', () => pinPanelOpen(), true);
    panel.addEventListener('click', event => {
      if (event.target.closest?.('#close')) return;
      pinPanelOpen();
    }, true);
    search.addEventListener('input', () => {
      lastSearch = search.value.trim().toLocaleLowerCase(); searchSelection = 0; navigationTargets=[]; renderList();
    });
    search.addEventListener('keydown', event => {
      if(event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!navigationTargets.length) return;
        searchSelection = clamp(searchSelection + (event.key === 'ArrowDown' ? 1 : -1), 0, navigationTargets.length - 1);
        highlightSearchSelection();
      } else if (event.key === 'Enter' && navigationTargets.length && !event.isComposing) {
        event.preventDefault(); const target=navigationTargets[searchSelection]||navigationTargets[0];
        jumpTo(target.index, true, target.target);
      }
    });
    shadow.getElementById('expandAll').addEventListener('click',()=>expandAllOutlines(true));
    shadow.getElementById('collapseAll').addEventListener('click',()=>expandAllOutlines(false));
    shadow.getElementById('focusCurrent').addEventListener('click',focusCurrentOutline);
    shadow.getElementById('mountedOnly').addEventListener('click', () => {
      mountedOnly = !mountedOnly;
      syncFilterButton();
      searchSelection = 0; renderList();
    });
    track.addEventListener('mousemove', showPreview);
    track.addEventListener('mouseleave', () => { preview.style.display = 'none'; scheduleHoverClose(); });
    rail.addEventListener('mouseenter', () => { clearTimeout(hoverCloseTimer); if (!pinned) togglePanel(true); });
    panel.addEventListener('mouseenter', () => clearTimeout(hoverCloseTimer));
    panel.addEventListener('mouseleave', scheduleHoverClose);
    shadow.getElementById('resetLayout').addEventListener('click', () => {
      layout = defaultLayout();
      updateLayoutPosition(); saveLayout();
    });
    shadow.getElementById('settingsToggle').addEventListener('click', () => {
      pinned = true;
      shadow.getElementById('settings').classList.toggle('open');
    });
    const dragHeader = shadow.getElementById('dragHeader');
    let drag = null;
    dragHeader.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault(); pinned = true;
      drag = {id:e.pointerId, y:e.clientY, oy:layout.y};
      dragHeader.setPointerCapture(e.pointerId);
    });
    dragHeader.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      layout.y = drag.oy + e.clientY - drag.y;
      layout.yPct = layout.y / innerHeight * 100;
      updateLayoutPosition();
    });
    const endDrag = e => { if (drag && e.pointerId === drag.id) {drag=null;saveLayout();} };
    dragHeader.addEventListener('pointerup', endDrag);
    dragHeader.addEventListener('pointercancel', endDrag);
    const resizeHandle = shadow.getElementById('resizeHandle');
    let resize = null;
    resizeHandle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation(); pinned = true;
      resize = { id:e.pointerId, x:e.clientX, y:e.clientY, w:effectiveLayout.w, h:effectiveLayout.h };
      resizeHandle.setPointerCapture(e.pointerId);
    });
    resizeHandle.addEventListener('pointermove', e => {
      if (!resize || e.pointerId !== resize.id) return;
      layout.w = resize.w + resize.x - e.clientX; // Left edge moves; RIGHT edge stays at 0.
      layout.h = resize.h + e.clientY - resize.y; // Top edge stays in place.
      updateLayoutPosition();
    });
    const endResize = e => { if (resize && e.pointerId === resize.id) { resize = null; saveLayout(); } };
    resizeHandle.addEventListener('pointerup', endResize);
    resizeHandle.addEventListener('pointercancel', endResize);
    for (const [key, inputId] of [['y','layoutY'],['w','layoutW'],['h','layoutH']]) {
      shadow.getElementById(inputId).addEventListener('input', e => {
        const v = Number(e.target.value);
        layout[key] = key === 'y' ? Math.round(innerHeight * v/100) : v;
        if(key==='y') layout.yPct=v;
        updateLayoutPosition(); saveLayout();
      });
    }
    track.addEventListener('click', event => jumpTo(indexFromPointer(event), true));
    track.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault(); jumpTo(clamp(activeIndex + 1, 0, turns.length - 1), true);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault(); jumpTo(clamp(activeIndex - 1, 0, turns.length - 1), true);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); pinned = true; togglePanel(true);
      }
    });
    jumpTop.addEventListener('click', loadEarlier);
    shadow.getElementById('returnPos').addEventListener('click', returnToPreviousPosition);
    shadow.getElementById('jumpLast').addEventListener('click', () => {
      if (turns.length) jumpTo(turns.length - 1, true);
    });
    shadow.getElementById('exportAll').addEventListener('click',event=>exportMarkdown('all',null,null,event.shiftKey?'copy':'download'));
    shadow.getElementById('exportCurrent').addEventListener('click',()=>exportMarkdown('turn',turns[activeIndex]));
    shadow.getElementById('refresh').addEventListener('click', () => { apiFailures=0; apiRetryAt=0; update(true); loadApiIndex(true); });
    shadow.getElementById('rebuildOrder').addEventListener('click', scanToRepairOrder);
    shadow.getElementById('diagnose').addEventListener('click', async () => {
      const output = JSON.stringify(diagnose(), null, 2);
      try {
        await navigator.clipboard.writeText(output);
        shadow.getElementById('hint').textContent = '诊断信息已复制（不含聊天内容），可以发给我排查。';
      } catch (_) {
        // Clipboard access may be disallowed in some Tampermonkey sandboxes.
        console.info('[ChatGPT Turn Navigator] diagnostics:', output);
        shadow.getElementById('hint').textContent = '诊断信息已输出到开发者工具 Console（F12），不含聊天内容。';
      }
    });
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('wheel',e=>{if(!e.composedPath().includes(host)) userNavigationIntent();},{capture:true,passive:true});
    document.addEventListener('touchstart',e=>{if(!e.composedPath().includes(host)) userNavigationIntent();},{capture:true,passive:true});
    document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(host)&&getTimeline()?.contains(e.target))userNavigationIntent();},{capture:true,passive:true});
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', () => {navigation.cancel('resize');geometry.invalidate('viewport');updateLayoutPosition();scheduleUpdate();}, {passive:true});
    window.addEventListener('popstate', scheduleUpdate);
  }

  function saveLayout() {
    try { localStorage.setItem(CONFIG.layoutKey, JSON.stringify(layout)); } catch (_) {}
  }
  function initializeLayout() { updateLayoutPosition(); }
  function updateLayoutPosition() {
    if(!panel) return;
    const margin=Math.max(8,innerHeight*.05), minH=Math.min(240,Math.max(100,innerHeight-2*margin));
    layout.w=clamp(layout.w,285,650); layout.h=clamp(layout.h,240,CONFIG.maxPanelHeight);
    const y=clamp(innerHeight*(layout.yPct??5)/100,margin,Math.max(margin,innerHeight-margin-minH));
    const h=Math.min(layout.h,Math.max(minH,innerHeight-y-margin));
    const width=Math.min(layout.w,Math.max(100,innerWidth-8));
    layout.y=y;
    effectiveLayout={right:0,y,w:width,h};
    Object.assign(panel.style,{right:'0px',left:'auto',top:`${y}px`,width:`${width}px`,height:`${h}px`,minWidth:`${Math.min(285,width)}px`});
    shadow.getElementById('launcher').style.top=`${y}px`;
    const railTop=Math.min(innerHeight-margin-100,y+43);
    rail.style.top=`${railTop}px`;rail.style.height=`${Math.max(100,Math.min(h-43,innerHeight-railTop-margin))}px`;
    const ids={y:'layoutY',w:'layoutW',h:'layoutH'};
    for(const k of Object.keys(ids)) {
      const input=shadow.getElementById(ids[k]);
      if(k==='y') {input.min='5';input.max=String(Math.max(5,Math.floor((innerHeight-margin-minH)/innerHeight*100)));}
      if(k==='w') input.max='650';
      if(k==='h') input.max=String(CONFIG.maxPanelHeight);
      input.value=String(k==='y'?Math.round(y/innerHeight*100):layout[k]);
      const output=shadow.getElementById('val'+k.toUpperCase());
      output.textContent=k==='y'?input.value+'%':layout[k]+'px';
      output.title=k==='h'&&h<layout.h?`设定 ${layout.h}px；当前视口显示 ${Math.round(h)}px，底部预留 5%`:'';
    }
  }

  function pinPanelOpen() {
    clearTimeout(hoverCloseTimer);
    pinned = true;
    // Avoid re-rendering an already open panel (preserve search caret/focus).
    if (!panel.classList.contains('open')) togglePanel(true);
  }
  function togglePanel(open) {
    panel.classList.toggle('open', open);
    if (!open) { preview.style.display = 'none'; search.blur(); }
    if (open) {
      // Opening the panel must not expand any answer TOC automatically.
      renderList(); revealActiveItem();
    }
  }
  function scheduleHoverClose() {
    if (pinned) return;
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = setTimeout(() => togglePanel(false), 250);
  }
  function onKeyDown(event) {
    if(event.isComposing) return;
    if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(event.key) &&
       !event.composedPath().includes(host) && !event.altKey && !event.target?.isContentEditable && !/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName||'')) userNavigationIntent();
    if(event.key==='Escape' && !shadow.getElementById('copyFallback').hidden){event.preventDefault();shadow.getElementById('copyFallback').hidden=true;return;}
    if(event.key==='Escape' && !shadow.getElementById('mdActions').hidden){event.preventDefault();shadow.getElementById('mdActions').hidden=true;return;}
    if(event.key==='Escape'&&navigation.current)cancelSeek();
    if (event.key === 'Escape' && panel.classList.contains('open')) {
      if (event.composedPath().includes(search) && search.value) {
        event.preventDefault(); search.value = ''; lastSearch = ''; searchSelection = 0; renderList(); return;
      }
      pinned = false; togglePanel(false); return;
    }
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (/INPUT|TEXTAREA/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === 'j') { event.preventDefault(); pinned = !pinned; togglePanel(pinned); }
    else if (key === 'f') { event.preventDefault(); pinned = true; togglePanel(true); search.focus(); search.select(); }
    else if (key === 'arrowup' && turns.length) { event.preventDefault(); jumpTo(clamp(activeIndex - 1, 0, turns.length - 1), true); }
    else if (key === 'arrowdown' && turns.length) { event.preventDefault(); jumpTo(clamp(activeIndex + 1, 0, turns.length - 1), true); }
  }

  // ChatGPT can render different DOM variants: section/article turn shells,
  // message-role nodes, and user bubbles without an author-role attribute.
  // These attributes are from the actual user-saved ChatGPT HTML (Oct 2026).
