  const OUTLINE_KEY = 'chatgpt-turn-nav-outline-v17:';
  const ANSWER_SELECTOR = '[data-response-body], [data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"], [data-message-author-role="assistant"], [data-role="assistant"], [data-message-author="assistant"]';
  const BODY_SELECTOR = '[data-markdown-text-style="assistant-message"], .markdown, .prose, [class*="MarkdownRoot-"]';
  const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6,[role="heading"][aria-level]';
  const OUTLINE_EXCLUDE = 'pre,code,blockquote,table,button,nav,aside,[role="dialog"],[role="menu"],[hidden],[aria-hidden="true"],.sr-only,[data-d-component="box"],[data-d-component="card"],[data-d-component="table"]';
  let expandedAnswers = new Set(), foldedHeadings = new Set(), answerCache = new Map();
  let navigationTargets = [], activeSectionKey = '', hintUntil = 0, hintTimer = 0;

  function outlineStorageKey() { return OUTLINE_KEY + location.pathname; }
  function loadOutlineState() {
    expandedAnswers = new Set(); foldedHeadings = new Set();
    try {
      const data = JSON.parse(sessionStorage.getItem(outlineStorageKey()) || 'null');
      if (data) {
        // Ignore pre-1.7.2 expansion state once on upgrade. Thereafter, restore
        // only the choices explicitly saved under the collapsed-by-default policy.
        if (data.defaultsVersion === 2)
          expandedAnswers = new Set((Array.isArray(data.answers) ? data.answers : []).filter(x=>typeof x==='string'));
        foldedHeadings = new Set((Array.isArray(data.headings) ? data.headings : []).filter(x=>typeof x==='string'));
      }
    } catch (_) {}
  }
  function saveOutlineState() {
    try {
      sessionStorage.setItem(outlineStorageKey(), JSON.stringify({
        defaultsVersion:2,
        answers:[...expandedAnswers].slice(-2000), headings:[...foldedHeadings].slice(-4000)
      }));
    } catch (_) {}
  }
  function setHint(text, hold = 4000) {
    const el = shadow?.getElementById('hint');
    if (!el) return;
    clearTimeout(hintTimer);
    el.textContent = text;
    el.hidden = false;
    hintUntil = Date.now() + hold;
    // No permanently occupied bottom status row. Long operations refresh this toast.
    hintTimer = setTimeout(() => { if (el.isConnected) el.hidden = true; }, Math.min(hold, 9000));
  }
  function outermost(nodes) {
    return nodes.filter((node,i)=>!nodes.some((other,j)=>j!==i && other.contains(node)));
  }
  function answerIds(node) {
    const ids = new Set();
    const add = el => {
      for (const attr of ['data-chatgpt-search-message-ids','data-message-id','data-message-uuid',
        'data-chatgpt-selection-message-id','data-response-body','data-dil-message-id','data-dil-source-message-id']) {
        for (const id of (el.getAttribute(attr)||'').split(/\s+/)) if(id) ids.add(id);
      }
    };
    add(node);
    for (const el of node.querySelectorAll('[data-message-id],[data-message-uuid],[data-chatgpt-search-message-ids],'+
      '[data-chatgpt-selection-message-id],[data-response-body],[data-dil-message-id],[data-dil-source-message-id]')) add(el);
    return [...ids];
  }
  function headingText(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('button,.sr-only,[aria-hidden="true"],[data-testid*="citation"],'+
      '[data-citation-id],svg').forEach(n=>n.remove());
    return (copy.textContent || '').replace(/\s+/g,' ').trim().slice(0,300);
  }
  function decorateHeadings(answerKey, headings) {
    const stack = [], seen = new Map();
    return headings.map((h,i)=>{
      while(stack.length && stack.at(-1).level >= h.level) stack.pop();
      const parent = stack.length ? stack.at(-1).index : -1;
      const sameTextKey = `${h.level}:${h.text}`;
      const occurrence = seen.get(sameTextKey) || 0; seen.set(sameTextKey,occurrence+1);
      const result = {...h,key:`${answerKey}|h${i}`,index:i,parent,depth:stack.length,occurrence};
      stack.push({level:h.level,index:i});
      return result;
    });
  }
  function getDOMAnswers(turn) {
    const node = turn.node;
    if (!node?.isConnected) return [];
    return contentTracker.read(node,'outline',turn.key,()=>{
      contentTracker.metrics.outlineBuilds++;
    let roots = [...node.querySelectorAll(ANSWER_SELECTOR)];
    if (node.matches(ANSWER_SELECTOR)) roots.unshift(node);
    roots = outermost(roots).filter(n=>!n.closest(USER_SELECTOR));
    if (!roots.length) {
      roots = outermost([...node.querySelectorAll(BODY_SELECTOR)]).filter(n=>!n.closest(USER_SELECTOR));
    }
    if (!roots.length && turn.role==='assistant' && !node.querySelector(USER_SELECTOR)) roots=[node];
    return roots.map((root,i)=>{
      const ids = answerIds(root);
      const key = ids[0] || `${turn.key}|reply${i}`;
      const contentRoots = outermost([...root.querySelectorAll(BODY_SELECTOR)]);
      if(root.matches(BODY_SELECTOR)) contentRoots.unshift(root);
      const candidates = [...root.querySelectorAll(HEADING_SELECTOR)];
      const headings = candidates.map(h => {
        if(h.closest(USER_SELECTOR) || h.closest(OUTLINE_EXCLUDE)) return null;
        if(contentRoots.length && !contentRoots.some(body=>body.contains(h))) return null;
        const text = headingText(h);
        if(!text || /^(ChatGPT said|You said|你说|您说|ChatGPT 说)\s*[:：]?$/i.test(text)) return null;
        return {node:h,text,level:clamp(Number(h.getAttribute('aria-level'))||Number(h.tagName.slice(1))||2,1,6),source:'dom'};
      }).filter(Boolean);
      return {key,ids,node:root,source:'dom',headings:decorateHeadings(key,headings)};
      });
    });
  }
  function sameAnswer(a,b) {
    return a.key===b.key || (a.ids||[]).some(id=>(b.ids||[]).includes(id));
  }
  function enrichTurn(turn) {
    const dom = getDOMAnswers(turn), cached = answerCache.get(turn.key) || [];
    const remote = turn.answers || [];
    let answers;
    if (dom.length) {
      // Live DOM is authoritative (DIL UI cards and Markdown may differ from API).
      answers = dom;
      for (const a of dom) {
        for (const old of [...cached,...remote].filter(b=>sameAnswer(a,b))) {
          if (expandedAnswers.has(old.key)) expandedAnswers.add(a.key);
        }
      }
    } else {
      answers = remote.length ? remote.map(a=>{
        const old=cached.find(b=>sameAnswer(a,b));
        return old?.headings.length ? {...old,source:'cache'} : a;
      }) : cached;
      answers = answers.map(a=>({...a,node:a.node?.isConnected?a.node:null,
        headings:a.headings.map(h=>({...h,node:h.node?.isConnected?h.node:null}))}));
    }
    if (answers.length) {
      answerCache.set(turn.key,answers);
      if (answerCache.size>1500) answerCache.delete(answerCache.keys().next().value);
    }
    return {...turn,answers};
  }
  function rawMessageText(item) {
    const c=item?.message?.content||item?.content||{};
    if(typeof c==='string') return c;
    let parts=c.parts||c.content||[];
    if(!Array.isArray(parts)) parts=[parts];
    return parts.map(x=>readable(x)||readable(x?.text)||readable(x?.content)||readable(x?.text?.value)).filter(Boolean).join('\n') || readable(c.text)||readable(c.value);
  }
  function plainMarkdownTitle(text) {
    return text.replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
      .replace(/<[^>]*>/g,'').replace(/\*\*|__|~~|`/g,'').replace(/(^|[^\w])(\*|_)(?=\S)(.+?\S|\S)\2(?=$|[^\w])/g,'$1$3').replace(/\\([\\`*_{}\[\]()#+.!>-])/g,'$1')
      .replace(/\s+/g,' ').trim().slice(0,300);
  }
  function markdownHeadings(text) {
    const out=[],lines=text.split(/\r?\n/); let fence=null, htmlComment=false;
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];
      if(htmlComment) {if(line.includes('-->')) htmlComment=false;continue;}
      if(/^\s*<!--/.test(line)) {htmlComment=!line.includes('-->');continue;}
      const f=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if(f) {
        if(!fence) fence={char:f[1][0],size:f[1].length};
        else if(f[1][0]===fence.char && f[1].length>=fence.size && !f[2].trim()) fence=null;
        continue;
      }
      if(fence || /^(?: {4}|\t|\s*>)/.test(line)) continue;
      const atx=line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|\s*)$/);
      if(atx) {
        const title=plainMarkdownTitle((atx[2]||'').replace(/\s+#+\s*$/,''));
        if(title) out.push({text:title,level:atx[1].length,node:null,source:'api'});
      } else if(line.trim() && i+1<lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i+1]) &&
        !/^\s*(?:[-*+]\s|\d+[.)]\s|<)/.test(line)) {
        const title=plainMarkdownTitle(line);
        if(title) out.push({text:title,level:lines[i+1].trim()[0]==='='?1:2,node:null,source:'api'});
        i++;
      }
    }
    return out;
  }
  function apiAnswer(item,id) {
    try {
      return {key:id,ids:[id],node:null,source:'api',headings:decorateHeadings(id,markdownHeadings(rawMessageText(item)))};
    } catch (_) {
      apiOutlineErrors++;
      return {key:id,ids:[id],node:null,source:'api',headings:[]};
    }
  }
  function expandAllOutlines(expand) {
    if(!expand && lastSearch) {search.value='';lastSearch='';searchSelection=0;}
    for(const t of turns) for(const a of t.answers||[]) {
      if(expand) expandedAnswers.add(a.key); else expandedAnswers.delete(a.key);
    }
    if(expand) foldedHeadings.clear();
    saveOutlineState(); renderList();
    setHint(expand?'已展开回答目录。点击章节左侧箭头可折叠子章节。':'已折叠全部回答目录。');
  }
  function focusCurrentOutline() {
    if(seekingIndex<0) updateActive();
    for(const a of turns[activeIndex]?.answers||[]) {
      expandedAnswers.add(a.key);
      a.headings.forEach(h=>foldedHeadings.delete(h.key));
    }
    search.value=''; lastSearch=''; mountedOnly=false;
    syncFilterButton();
    saveOutlineState(); renderList(); updateActiveSection();
    const link=[...list.querySelectorAll('.toc-link')].find(el=>el.dataset.section===activeSectionKey);
    scrollWithinList(link || list.querySelector(`.item[data-idx="${activeIndex}"]`));
  }
  function scrollWithinList(node) {
    if(!node) return;
    const r=node.getBoundingClientRect(),box=list.getBoundingClientRect();
    if(r.top<box.top+8) list.scrollTop+=r.top-box.top-8;
    else if(r.bottom>box.bottom-8) list.scrollTop+=r.bottom-box.bottom+8;
  }
  function resolveOutlineNode(turn,target) {
    const shell=findMountedTurn(turn);
    if(!shell) return null;
    if(!target) return shell;
    const answers=getDOMAnswers({...turn,node:shell});
    let answer=answers.find(a=>a.key===target.answerKey || a.ids.some(id=>(target.answerIds||[]).includes(id)));
    // Only allow index fallback for anonymous bodies. Never jump to a different known message.
    if(!answer && target.anonymous && answers[target.answerIndex]) answer=answers[target.answerIndex];
    if(!answer) return null;
    if(target.kind==='answer') return answer.node;
    const matches=answer.headings.filter(h=>h.level===target.level && h.text===target.text);
    const match=matches[target.occurrence||0];
    return match?.node || null;
  }
  function outlineTarget(answer,answerIndex,h=null) {
    return {kind:h?'heading':'answer',answerKey:answer.key,answerIds:answer.ids,answerIndex,
      anonymous:!answer.ids.length,...(h?{text:h.text,level:h.level,occurrence:h.occurrence,sectionKey:h.key}:{})};
  }
  function updateActiveSection() {
    let current='';
    const timeline=getTimeline();
    if(timeline) {
      const boundary=timeline.getBoundingClientRect().top+Math.min(120,timeline.clientHeight*.25);
      let top=-Infinity;
      for(const a of turns[activeIndex]?.answers||[]) for(const h of a.headings) {
        if(!h.node?.isConnected) continue;
        const r=h.node.getBoundingClientRect();
        if(r.height>0 && r.top<=boundary+2 && r.top>top) {top=r.top;current=h.key;}
      }
    }
    activeSectionKey=current;
    if(panel.classList.contains('open')) {
      for(const el of list.querySelectorAll('.toc-link')) {
        const active=el.dataset.section===current;
        el.classList.toggle('section-active',active);
        if(active) el.setAttribute('aria-current','location');else el.removeAttribute('aria-current');
      }
    }
  }
  function cancelSeek() {
    const running=navigation.current;
    navigation.cancel('user');jumpSerial++;seekingIndex=-1;
    if(running)setHint('已停止自动查找/扫描，保留你当前的正文位置。');
  }

