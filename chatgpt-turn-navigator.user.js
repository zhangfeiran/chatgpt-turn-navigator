// ==UserScript==
// @name         ChatGPT 轮次导航 / Turn Navigator
// @namespace    https://chatgpt.com/
// @version      1.9.1
// @description  Modular local-first navigator: safe virtualized navigation, incremental TOCs, Markdown download/copy, cached-body search and reading resume.
// @author       ChatGPT
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="7" fill="%2317191f"/%3E%3Cpath d="M8 9h16M8 16h11M8 23h16" stroke="%2352d4aa" stroke-width="3" stroke-linecap="round"/%3E%3C/svg%3E
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__chatgptTurnNavLoaded) return;
  window.__chatgptTurnNavLoaded = true;

  // Pure/service modules. State is private to each instance; no external dependencies.

  // ===== src/core/content-tracker.js =====
  function createContentTracker() {
    let revisions = new WeakMap(), memo = new WeakMap(), serial = 0;
    const metrics = {outlineBuilds:0, bodyBuilds:0, cacheHits:0, dirtyBatches:0};
    function version(node) { return revisions.get(node) || 0; }
    function touch(node, stop) {
      for (let el=node?.nodeType===1?node:node?.parentElement; el && el!==stop; el=el.parentElement)
        revisions.set(el, ++serial);
    }
    function read(node, slot, identity, make) {
      let slots=memo.get(node); if(!slots) memo.set(node,slots=new Map());
      const v=version(node), old=slots.get(slot);
      if(old && old.v===v && old.identity===identity) { metrics.cacheHits++; return old.value; }
      const value=make(); slots.set(slot,{v,identity,value}); return value;
    }
    return {version,touch,read,metrics,
      reset(){ revisions=new WeakMap();memo=new WeakMap();serial=0; },
      batch(){metrics.dirtyBatches++;}
    };
  }


  // ===== src/core/navigation-controller.js =====
  function createNavigationController(scope) {
    let current=null, serial=0;
    const owns=t=>!!t && current===t && t.scope===scope();
    const live=t=>owns(t) && !t.cancelled;
    function begin(kind) {
      if(current) {current.cancelled=true;current.reason='superseded';}
      current={id:++serial,kind,scope:scope(),cancelled:false,reason:''};return current;
    }
    function cancel(reason='user') {
      if(current) {current.cancelled=true;current.reason=reason;}
    }
    function write(t,el,top,restore=false) {
      if(!el?.isConnected || !owns(t) || (t.cancelled && !(restore && t.reason==='stop'))) return false;
      const overflow=Math.max(0,el.scrollHeight-el.clientHeight);
      const reverse=getComputedStyle(el).flexDirection==='column-reverse';
      el.scrollTo({top:Math.max(reverse?-overflow:0,Math.min(reverse?0:overflow,top)),behavior:'instant'});
      return true;
    }
    return {begin,cancel,owns,live,write,get current(){return current;},
      finish(t){if(current===t) current=null;},
      summary(){return current?{kind:current.kind,cancelled:current.cancelled,reason:current.reason}:null;}
    };
  }


  // ===== src/core/order-evidence.js =====
  function createOrderEvidence() {
    // Constraints outlive coordinate epochs. A new, stronger observation can
    // replace an inconsistent old edge; cycles never enter the active graph.
    let edges=new Map(), tick=0, rejected=0;
    function path(from,to) {
      const stack=[[from,[]]], visited=new Set();
      while(stack.length) {
        const [id,trail]=stack.pop();if(id===to)return trail;
        if(visited.has(id))continue;visited.add(id);
        for(const [key,e] of edges) if(e.a===id) stack.push([e.b,trail.concat(key)]);
      }
      return null;
    }
    function add(a,b,strength) {
      if(!a||!b||a===b)return;
      const key=a+'\0'+b, old=edges.get(key);
      if(old) {old.strength=Math.max(old.strength,strength);old.tick=++tick;return;}
      let cycle=path(b,a);
      while(cycle) {
        const weakest=cycle.map(k=>[k,edges.get(k)]).sort((x,y)=>x[1].strength-y[1].strength||x[1].tick-y[1].tick)[0];
        if(!weakest||weakest[1].strength>strength){rejected++;return;}
        edges.delete(weakest[0]);cycle=path(b,a);
      }
      edges.set(key,{a,b,strength,tick:++tick});
      if(edges.size>12000) edges.delete([...edges].sort((a,b)=>a[1].strength-b[1].strength||a[1].tick-b[1].tick)[0][0]);
    }
    function sequence(ids,strength) {const unique=[...new Set(ids.filter(Boolean))];for(let i=1;i<unique.length;i++)add(unique[i-1],unique[i],strength);}
    function sort(turns,idsOf) {
      const byId=new Map(); turns.forEach((t,i)=>idsOf(t).forEach(id=>byId.set(id,i)));
      const outgoing=turns.map(()=>new Set()),degree=turns.map(()=>0);
      for(const e of edges.values()) {
        const a=byId.get(e.a), b=byId.get(e.b);if(a==null||b==null||a===b||outgoing[a].has(b))continue;
        outgoing[a].add(b);degree[b]++;
      }
      const queue=degree.map((n,i)=>n===0?i:-1).filter(i=>i>=0), order=[];
      while(queue.length) {queue.sort((a,b)=>a-b);const i=queue.shift();order.push(i);for(const j of outgoing[i])if(--degree[j]===0)queue.push(j);}
      // Alias collapsing can produce a cycle even if the original ID graph was
      // acyclic. Keep the unresolved suffix stable instead of deleting a turn.
      if(order.length<turns.length){const seen=new Set(order);turns.forEach((_,i)=>{if(!seen.has(i))order.push(i);});}
      return order.map(i=>turns[i]);
    }
    return {sequence,sort,reset(){edges.clear();tick=0;rejected=0;},summary(){return {relations:edges.size,rejected};}};
  }


  // ===== src/core/geometry-evidence.js =====
  function createGeometryEvidence() {
    let epoch=0,signature='',points=new Map(),scroller=null,sign=1,reason='initial';
    function invalidate(why) {epoch++;signature='';reason=why;}
    function sync(el) {
      if(!el)return false;
      const box=el.getBoundingClientRect();
      const next=[Math.round(box.width),el.clientHeight,el.scrollHeight,getComputedStyle(el).flexDirection,
        window.devicePixelRatio,window.visualViewport?.scale||1].join(':');
      if(scroller!==el || signature!==next){epoch++;signature=next;scroller=el;reason='layout';}
      return true;
    }
    function observe(dom,el,idsOf) {
      if(!sync(el))return;
      const box=el.getBoundingClientRect();
      const samples=dom.filter(t=>t.node?.isConnected&&el.contains(t.node)).map(t=>{
        const anchor=t.node.closest('[data-measured-turn]')||t.node;
        const r=anchor.getBoundingClientRect();
        return {t,top:el.scrollTop+r.top-box.top,height:r.height};
      }).filter(x=>x.height>0&&Number.isFinite(x.top));
      if(samples.length>1) {
        const delta=samples.at(-1).top-samples[0].top;
        if(Math.abs(delta)>2) sign=Math.sign(delta);
      }
      // Also detect intrinsic reflows that preserve the total document height.
      const drift=samples.some(x=>{const p=idsOf(x.t).map(id=>points.get(id)).find(Boolean);return p?.epoch===epoch&&Math.abs(p.top-x.top)>3;});
      if(drift){epoch++;reason='anchor moved';}
      for(const x of samples) {
        const p={top:x.top,height:x.height,epoch,signature,sign,seen:Date.now()};
        for(const id of idsOf(x.t)) points.set(id,p);
      }
    }
    function get(turn,idsOf,currentOnly=true) {
      const candidates=idsOf(turn).map(id=>points.get(id)).filter(Boolean).sort((a,b)=>b.seen-a.seen);
      return candidates.find(p=>!currentOnly||p.epoch===epoch)||null;
    }
    return {sync,observe,get,invalidate,get epoch(){return epoch;},get sign(){return sign;},
      get signature(){return signature;},
      reset(){epoch++;signature='';points.clear();scroller=null;sign=1;reason='conversation';},
      summary(){return {epoch,reason,positions:new Set(points.values()).size,signature};}
    };
  }


  // ===== src/core/reading-store.js =====
  function createReadingStore() {
    const key='chatgpt-turn-nav-reading-v19';
    function hash(text) {let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
    function all(){try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}}
    function valid(p){return p&&Array.isArray(p.ids)&&p.ids.length&&p.ids.every(x=>typeof x==='string')&&Number.isFinite(p.top)&&Number.isFinite(p.offset);}
    return {hash,
      load(scope){const p=all()[hash(scope)];return valid(p)?p:null;},
      save(scope,point){if(!valid(point))return;try{const data=all();data[hash(scope)]={...point,savedAt:Date.now()};
        const keep=Object.entries(data).sort((a,b)=>(b[1].savedAt||0)-(a[1].savedAt||0)).slice(0,40);
        localStorage.setItem(key,JSON.stringify(Object.fromEntries(keep)));}catch{}},
      clear(scope){try{const data=all();delete data[hash(scope)];localStorage.setItem(key,JSON.stringify(data));}catch{}}
    };
  }


  // ===== src/app/state.js =====
  const CONFIG = {
    maxTicks: 140,              // Visual markers; all turns remain reachable from the list.
    maxPromptLength: 120,
    refreshDelayMs: 320,
    minViewportWidth: 760,
    storageKey: 'chatgpt-turn-nav-enabled-v1',
    layoutKey: 'chatgpt-turn-nav-layout-v17',
    maxPanelHeight: 1100,
  };
  const CHAT_PATH = /^\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+|share\/[^/]+)/;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  let host, shadow, panel, list, search, counter, rail, track, marker, preview, jumpTop;
  let turns = [], activeIndex = 0, updateTimer = 0, scrollRaf = 0;
  let hoverCloseTimer = 0, pinned = false, currentURL = location.href, currentScope = conversationScope();
  let lastFingerprint = '', isVisible = true, lastSearch = '';
  let apiTurns = [], apiStatus = '等待读取', apiError = '', apiPages = 0, apiTruncated = false;
  let apiKey = '', apiPending = null, fetchGeneration = 0, lastAPICheck = 0;
  let jumpSerial = 0, seekingIndex = -1, lastJump = '尚未跳转';
  let returnPositions = [], mountedOnly = false, searchSelection = 0, filteredIndices = [];
  const knownLabels = new Map();
  const contentTracker=createContentTracker();
  const navigation=createNavigationController(conversationScope);
  const orderEvidence=createOrderEvidence();
  const geometry=createGeometryEvidence();
  const readingStore=createReadingStore();
  let lifecycle=null, bodySearch=false, apiCooldownUntil=0, liveTimeline=null;
  let resumePoint=null, readingTouched=false, readingTimer=0, lastReadingPoint=null;
  let exportContentRevision=0, searchBodyMemo=new Map();
  const runtimeMetrics={updates:0,renderedLists:0,errors:0};
  let lastOrderCheck = {mountedCompared:0,corrected:false,corrections:0};
  let totalOrderCorrections = 0;
  // A virtualized long conversation may mount only ONE turn at a time.
  // Record physical scroll positions of each observed turn, separately from live nodes.
  let totalSpatialCorrections=0, lastSpatialCheck={observed:0,corrected:false,corrections:0};
  let scanBusy=false, scanToken=null, scanLastSteps=0, scanLastSeen=0;
  // Keep identity/labels/TOCs separately from live DOM. Virtualization is NOT deletion.
  // No message text or heading text is written to localStorage/sessionStorage.
  let indexCatalog = [], apiComplete = false, apiFailures = 0, apiRetryAt = 0;
  let apiController = null, apiOutlineErrors = 0;
  const anonymousDOMKeys = new WeakMap(); let anonymousDOMSerial = 0;
  function conversationScope() {
    // An anchor or tracking query is not a different conversation.
    return location.origin + location.pathname.replace(/\/$/, '');
  }
  function syncFilterButton() {
    const button = shadow?.getElementById('mountedOnly');
    if (!button) return;
    button.setAttribute('aria-pressed', String(mountedOnly));
    button.textContent = mountedOnly ? '仅已加载' : '全部轮次';
    button.title = mountedOnly ? '当前隐藏未加载轮次；点击恢复全部已索引轮次' : '当前显示全部已索引轮次；点击仅显示正文已加载轮次';
  }

  // v1.7 uses a new layout key so the requested defaults apply on upgrade.
  // Preferred dimensions are stored separately from the viewport-fitted size.
  const defaultLayout = () => ({ y: Math.round(innerHeight*.05), yPct:5, w:360, h:950 });
  let layout=defaultLayout(), effectiveLayout={...layout};
  try {
    const saved=JSON.parse(localStorage.getItem(CONFIG.layoutKey)||'{}');
    for(const k of ['y','yPct','w','h']) if(typeof saved[k]==='number' && Number.isFinite(saved[k])) layout[k]=saved[k];
  } catch (_) {}

  try { isVisible = localStorage.getItem(CONFIG.storageKey) !== '0'; } catch (_) {}


  // ===== src/ui/styles.js =====
  const styles = `
    :host { --tn-bg:#17191f;--tn-text:#edf0f5;--tn-muted:#a0a8b6;
      --tn-border:#353b46;--tn-hover:#282e39;--tn-active:#263f3c;
      --tn-accent:#52d4aa;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
      color:var(--tn-text);color-scheme:dark; }
    * { box-sizing:border-box; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    #launcher { position:fixed;right:0;top:5%;z-index:2147483200;
      display:flex;align-items:center;justify-content:center;width:33px;height:33px;
      color:var(--tn-text);background:var(--tn-bg);border:1px solid var(--tn-border);
      border-radius:11px;box-shadow:0 3px 16px rgba(0,0,0,.11); }
    #launcher:hover,#launcher:focus-visible { background:var(--tn-hover);outline:2px solid transparent; }
    #launcher svg { width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round; }
    #rail { position:fixed;right:0;top:calc(5% + 43px);width:33px;
      height:min(64vh,600px);min-height:140px;z-index:2147483200;
      background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:15px;
      padding:12px 4px;box-shadow:0 3px 16px rgba(0,0,0,.11); }
    #track { width:100%;height:100%;position:relative;cursor:pointer;touch-action:pan-y; }
    #track:before { content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;
      background:var(--tn-border);transform:translateX(-50%); }
    .tick { position:absolute;left:50%;width:11px;height:2px;border-radius:2px;
      background:var(--tn-muted);opacity:.58;transform:translate(-50%,-50%);pointer-events:none; }
    #marker { position:absolute;left:50%;height:5px;width:21px;border-radius:4px;
      background:var(--tn-accent);transform:translate(-50%,-50%);pointer-events:none;
      box-shadow:0 0 0 2px var(--tn-bg); }
    #preview { position:fixed;right:51px;max-width:290px;width:max-content;padding:8px 11px;
      background:var(--tn-bg);color:var(--tn-text);border:1px solid var(--tn-border);
      box-shadow:0 5px 22px rgba(0,0,0,.16);border-radius:9px;z-index:2147483201;
      pointer-events:none;display:none;white-space:normal;overflow-wrap:anywhere; }
    #panel { position:fixed;right:0;left:auto;top:5%;width:min(360px,calc(100vw - 8px));
      height:min(90vh,950px);min-height:240px;z-index:2147483202;display:none;
      background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:15px;
      box-shadow:0 14px 40px rgba(0,0,0,.4);overflow:hidden;flex-direction:column;resize:none;
      min-width:285px;max-width:calc(100vw - 8px);max-height:calc(100vh - 16px); }
    #panel.open { display:flex; }
    #resizeHandle { position:absolute;bottom:0;left:0;width:27px;height:27px;z-index:20;border:0;background:transparent;cursor:nesw-resize;touch-action:none; }
    #resizeHandle::after {content:"";position:absolute;left:5px;bottom:5px;width:12px;height:12px;border-left:2px solid #9daabd;border-bottom:2px solid #9daabd;pointer-events:none;opacity:.9;}
    #resizeHandle:hover::after {border-color:var(--tn-accent);}
    .head { display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px;
      gap:10px;cursor:grab;touch-action:none;user-select:none;border-bottom:1px solid var(--tn-border); }
    .head:active { cursor:grabbing; }
    .head button { cursor:pointer; }
    .head-controls {display:flex;align-items:center;gap:3px}
    .gear {font-size:15px!important;}
    .settings {display:none;padding:9px 13px;border-bottom:1px solid var(--tn-border);gap:8px;}
    .settings.open {display:grid;}
    .settings label {display:grid;grid-template-columns:55px 1fr 45px;align-items:center;gap:8px;font-size:11px;color:var(--tn-muted)}
    .settings input {width:100%;accent-color:var(--tn-accent)}
    .settings output {text-align:right;font-variant-numeric:tabular-nums}
    .setting-actions { display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap; }
    .setting-actions button {background:var(--tn-hover);border:1px solid var(--tn-border);color:var(--tn-text);border-radius:7px;padding:5px 9px;font-size:11px}
    .setting-actions button:hover {border-color:var(--tn-accent)}
    .drag-hint {font-size:10px;color:var(--tn-muted);white-space:nowrap;}
    .title { font-weight:680;font-size:14px;display:flex;gap:7px;align-items:center; }
    .count { color:var(--tn-muted);font-size:11px;white-space:nowrap; }
    .close { background:transparent;border:0;color:var(--tn-muted);font-size:19px;line-height:1;
      width:24px;height:24px;border-radius:7px; }
    .close:hover { background:var(--tn-hover); }
    .search { display:block;margin:3px 10px 5px;width:calc(100% - 20px);border-radius:10px;
      border:1px solid var(--tn-border);background:transparent;padding:9px 10px;color:var(--tn-text);
      outline:none; }
    .search:focus { border-color:var(--tn-accent); }
    /* One toolbar row for search scope, loaded-only filter, answer TOC actions. */
    .compact-toolbar {display:flex;align-items:center;gap:4px;padding:0 9px 5px;min-width:0;flex:none;white-space:nowrap}
    .compact-toolbar #searchScope {flex:1 1 80px;width:auto;min-width:65px;max-width:none;padding:4px 2px}
    .compact-toolbar #mountedOnly {flex:0 0 60px;min-width:0;white-space:nowrap;padding:4px 2px;font-size:11px}
    .compact-toolbar .toc-tool {flex:0 0 34px;width:34px;min-width:0;padding:3px 0;font-size:16px;line-height:18px}
    /* Keep result counts available to screen readers without taking a row. */
    #searchMeta {position:absolute!important;width:1px;height:1px;clip:rect(0,0,0,0);clip-path:inset(50%);overflow:hidden;white-space:nowrap}
    .chip {font-size:11px;color:var(--tn-muted);border:1px solid var(--tn-border);background:transparent;border-radius:7px;flex:none;padding:3px 8px}
    .chip[aria-pressed="true"] {color:var(--tn-accent);border-color:var(--tn-accent);background:#214037}
    .chip:hover {border-color:var(--tn-accent)}
    #list { flex:1;overflow:auto;overscroll-behavior:contain;padding:2px 7px 9px;scrollbar-width:thin; }
    .item { display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;
      background:transparent;border:0;border-radius:9px;padding:9px 8px;
      color:var(--tn-text);overflow-wrap:anywhere; }
    .item:hover,.item:focus-visible { background:var(--tn-hover);outline:none; }
    .item.active { background:var(--tn-active); }
    .item.search-selected:not(.active) {background:var(--tn-hover);outline:1px solid #486957;outline-offset:-1px}
    .item .dot {width:6px;height:6px;flex:none;border-radius:50%;background:#69727f;margin-top:8px}
    .item .dot.mounted {background:var(--tn-accent)}
    .item mark {background:#80692a;color:#fff3b4;border-radius:2px;padding:0 1px}
    .num { flex:none;color:var(--tn-muted);font-size:11px;min-width:27px;font-variant-numeric:tabular-nums;
      padding-top:2px; }
    .label { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
      overflow:hidden;line-height:1.45; }
    .foot { border-top:1px solid var(--tn-border);padding:5px 8px 6px 28px; }
    /* Feedback appears as a transient overlay; never consumes permanent list height. */
    .hint {position:absolute;left:8px;right:8px;bottom:43px;z-index:28;
      background:#252d37;border:1px solid #465263;color:var(--tn-text);border-radius:8px;
      padding:8px 10px;font-size:11px;line-height:1.45;max-height:95px;overflow:auto;
      box-shadow:0 6px 18px #0009;pointer-events:none;}
    .actions {display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:3px;}
    .action {display:flex;align-items:center;justify-content:center;min-width:0;height:30px;
      border:1px solid var(--tn-border);border-radius:6px;background:transparent;
      color:var(--tn-text);padding:0;font-size:16px;line-height:1;white-space:nowrap;}
    .action:hover:not(:disabled) { background:var(--tn-hover); }
    .action:disabled {opacity:.4;cursor:not-allowed}
    .empty { color:var(--tn-muted);text-align:center;padding:24px 8px; }
    :host([data-hidden="true"]) #rail { display:none; }
    :host([data-disabled="true"]) #launcher,
    :host([data-disabled="true"]) #rail,
    :host([data-disabled="true"]) #panel,
    :host([data-disabled="true"]) #preview { display:none !important; }
    #panel {border-radius:14px 0 0 14px;min-height:0;max-height:90vh;}
    .head,.foot,.settings,.search,.compact-toolbar {flex-shrink:0;}
    #list {min-height:0;overflow-anchor:none;padding-bottom:12px;}
    .title {min-width:0;font-size:13px;gap:6px;}
    .turn-group {padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid #2c313b;}
    .turn-group:last-child {border-bottom:0;}
    .answer-outline {margin:2px 0 2px 31px;border-left:1px solid #3b4351;padding-left:5px;}
    .toc-head {display:flex;align-items:center;gap:2px;min-height:29px;}
    .toc-toggle {display:flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--tn-muted);padding:4px 3px;min-width:0;flex:1;text-align:left;font-size:11px;border-radius:5px;}
    .toc-toggle:hover,.answer-top:hover,.toc-node-toggle:hover {background:var(--tn-hover);color:var(--tn-text);}
    .toc-count {color:#8995a8;font-size:10px;margin-left:auto;white-space:nowrap;}
    .chevron {width:12px;flex:none;}
    .answer-top {border:0;background:transparent;color:var(--tn-muted);width:24px;height:26px;border-radius:5px;flex:none;}
    .toc-row {display:flex;align-items:flex-start;gap:1px;}
    .toc-node-toggle {border:0;background:transparent;color:var(--tn-muted);width:17px;min-width:17px;height:27px;padding:0;border-radius:4px;font-size:11px;}
    .toc-link {display:flex;align-items:baseline;gap:6px;width:100%;min-width:0;text-align:left;border:0;background:transparent;color:#bac4d2;border-radius:6px;padding:5px 4px;font-size:12px;line-height:1.45;}
    .toc-link:hover {background:var(--tn-hover);color:var(--tn-text);}
    .toc-link.section-active {background:#203b36;color:#7ce4c1;box-shadow:inset 2px 0 var(--tn-accent);}
    .toc-link.search-selected {outline:1px solid #648875;outline-offset:-1px;background:var(--tn-hover);}
    .toc-level {font-size:9px;font-variant-numeric:tabular-nums;color:#8795a8;flex:none;}
    .toc-text {overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
    .toc-empty {font-size:11px;color:var(--tn-muted);padding:5px 7px 7px;}
    .toc-link mark {background:#80692a;color:#fff3b4;border-radius:2px;padding:0 1px;}
    button:focus-visible {outline:2px solid var(--tn-accent);outline-offset:-2px;}
    .settings {max-height:38vh;overflow:auto;}

    .turn-top {display:flex;align-items:flex-start;gap:1px;}
    .turn-top > .item {flex:1;min-width:0;}
    .turn-export {flex:none;align-self:center;border:1px solid transparent;border-radius:5px;background:transparent;
      color:var(--tn-muted);font-size:10px;padding:5px 3px;min-width:30px;line-height:1.3;}
    .turn-export:hover,.turn-export:focus-visible {border-color:var(--tn-accent);color:var(--tn-accent);background:var(--tn-hover);}
    [data-export-action]:disabled {opacity:.45;cursor:progress;}
    .coverage {flex:none;padding:0 10px 3px;color:var(--tn-muted);font-size:10px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #searchScope {max-width:108px;min-width:0;font:11px system-ui;color:var(--tn-text);background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:6px;padding:4px;}
    .body-snippet {font-size:11px;color:#abb7c8;margin:2px 7px 6px 35px;line-height:1.5;overflow-wrap:anywhere;}
    .body-snippet mark {background:#80692a;color:#fff3b4;}
    .md-actions {position:fixed;z-index:2147483300;width:200px;padding:5px;background:#202630;border:1px solid #566274;border-radius:9px;box-shadow:0 5px 22px #0008;}
    .md-actions button {display:block;border:0;background:transparent;color:var(--tn-text);text-align:left;width:100%;padding:9px 8px;border-radius:5px;font:12px system-ui;}
    .md-actions button:hover {background:var(--tn-hover);color:var(--tn-accent);}
    .copy-fallback {position:absolute;inset:48px 8px 20px;z-index:30;background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;}
    .copy-fallback p {font-size:12px;margin:0;color:var(--tn-muted);}
    .copy-title {font-weight:650;}
    .copy-fallback textarea {width:100%;min-height:70px;flex:1;resize:none;background:#101318;color:var(--tn-text);border:1px solid #566274;font:11px/1.4 monospace;}
    .copy-fallback button {background:var(--tn-hover);border:1px solid var(--tn-border);color:var(--tn-text);padding:7px;border-radius:6px;margin-right:6px;}
    [hidden] {display:none!important;}
    @media(max-width:760px) { #rail{height:48vh}#panel{height:68vh} }

  `;


  // ===== src/ui/panel.js =====
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
        <div class="compact-toolbar" aria-label="搜索筛选与回答目录操作">
          <select id="searchScope" aria-label="搜索范围" title="正文搜索仅覆盖已取得内容，不会自动加载全对话">
            <option value="outline">提问 / 标题</option><option value="body">已缓存正文</option></select>
          <button class="chip" type="button" id="mountedOnly" aria-pressed="false" title="当前显示全部已索引轮次；点击仅显示正文已加载轮次">全部轮次</button>
          <button class="chip toc-tool" type="button" id="expandAll" aria-label="展开全部回答目录" title="展开全部回答目录">▾</button>
          <button class="chip toc-tool" type="button" id="collapseAll" aria-label="折叠全部回答目录" title="折叠全部回答目录">▸</button>
          <button class="chip toc-tool" type="button" id="focusCurrent" aria-label="定位当前轮次（不滚动正文）" title="在目录里定位当前轮次，不移动正文">◎</button>
          <span id="searchMeta" aria-live="polite">↑↓ 选择</span>
        </div>
        <div id="coverage" class="coverage" aria-live="polite"></div>
        <div id="list" aria-label="轮次与回答章节"></div>
        <div class="foot"><div class="hint" id="hint" role="status" aria-live="polite" hidden></div>
          <div class="actions" aria-label="快捷操作">
            <button class="action" id="returnPos" disabled aria-label="返回原位置" title="返回上一次跳转前的正文位置">↶</button>
            <button class="action" id="jumpLast" aria-label="跳至最新一轮" title="跳到最新一轮">⇣</button>
            <button class="action" id="jumpTop" aria-label="加载更早历史" title="加载更早历史">⇡</button>
            <button class="action" id="refresh" aria-label="重新读取目录" title="重新读取目录">⟳</button>
            <button class="action" id="exportAll" data-export-action="all" aria-label="导出整个对话 Markdown" title="下载整个对话；Shift+点击则复制 Markdown，不受筛选影响">⬇</button>
            <button class="action" id="exportCurrent" data-export-action="turn" aria-label="导出当前 Q/A Markdown" title="下载当前轮次 Q/A 的 Markdown">Q↓</button>
            <button class="action" id="copyCurrent" data-export-action="turn" aria-label="复制当前 Q/A Markdown" title="复制当前 Q/A 的 Markdown">⧉</button>
            <button class="action" id="resumeReading" disabled aria-label="继续上次阅读" title="恢复上次阅读到的消息和章节">⌖</button>
          </div></div>
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
        setHint('诊断信息已复制（不含聊天内容），可以发给我排查。');
      } catch (_) {
        // Clipboard access may be disallowed in some Tampermonkey sandboxes.
        console.info('[ChatGPT Turn Navigator] diagnostics:', output);
        setHint('诊断信息已输出到开发者工具 Console（F12），不含聊天内容。');
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

  // ===== src/adapters/dom.js =====
  const SHELL_SELECTOR = '[data-turn-key], [data-testid^="conversation-turn-"], [data-turn-id][data-turn]';
  const USER_SELECTOR = '[data-user-message-bubble="true"], [data-message-author-role="user"], [data-role="user"], [data-message-author="user"], [data-testid="user-message"]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-role="assistant"]';
  function getTimeline() {
    // NEVER select an arbitrary overflow-y-auto: the first matching node is the sidebar.
    if(liveTimeline?.isConnected) return liveTimeline;
    const exact = document.querySelector('[data-app-action-timeline-scroll]');
    if (exact) return (liveTimeline=exact);
    const named = document.querySelector('.thread-scroll-container, [data-testid="conversation-scroll-container"]');
    if (named && !named.closest('nav, aside, [data-app-action-sidebar-scroll]')) return (liveTimeline=named);
    const target = document.querySelector('[data-thread-find-target="conversation"]');
    for(let p=target?.parentElement;p;p=p.parentElement) {
      if (p.closest('nav, aside, [data-app-action-sidebar-scroll]')) return null;
      const css=getComputedStyle(p);
      if (/(auto|scroll)/.test(css.overflowY) && p.scrollHeight>p.clientHeight) return (liveTimeline=p);
    }
    return null;
  }
  function normalizedText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function getPromptText(node) {
    if (!node) return '';
    const user = node.matches(USER_SELECTOR) ? node : node.querySelector(USER_SELECTOR);
    if (!user) return '';
    const body = user.querySelector('[data-search-result-target] .text-size-chat, .text-size-chat.whitespace-pre-wrap, [data-search-result-target], .whitespace-pre-wrap') || user;
    return normalizedText(body).slice(0, CONFIG.maxPromptLength);
  }
  function getAssistantSummary(node) {
    // Saved 2026 automation pages mark assistant output with a search-unit key,
    // not a user bubble. The visible answer headline is more useful than an empty '问题'.
    const unit = node.querySelector('[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"], [data-conversation-role="assistant"]');
    if (!unit) return '';
    const title = node.querySelector('[data-chatgpt-search-unit-key$=":assistant"] button span.truncate');
    const taskName = normalizedText(title);
    const headline = unit.querySelector('h1,h2,h3,[class*="markdown"] h4,p,[data-message-content]') ||
      node.querySelector('[data-conversation-role="assistant"]')?.parentElement?.querySelector('h1,h2,h3,p');
    let snippet = normalizedText(headline);
    if (!snippet) {
      // Avoid copying button text, citations and the entire long AI answer.
      const content = unit.querySelector('.markdown, [class*="markdown"], .prose');
      snippet = normalizedText(content).slice(0, 90);
    }
    if (snippet === 'ChatGPT said:' || /^ChatGPT said:/.test(snippet)) snippet = '';
    return [taskName, snippet].filter(Boolean).join(' · ').slice(0, CONFIG.maxPromptLength);
  }
  function formatTurnTime(node) {
    const raw = node.querySelector('time[datetime]')?.getAttribute('datetime');
    if (!raw) return '';
    const date = new Date(raw);
    if (!Number.isFinite(date.valueOf())) return '';
    // Browser local timezone, consistent with the visible ChatGPT timestamps.
    return `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function turnTime(node) {
    const raw = node.querySelector('time[datetime]')?.getAttribute('datetime');
    const time = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(time) ? time : null;
  }
  function isUserShell(shell) {
    if (shell.hasAttribute('data-turn-key')) return true; // Includes scheduled assistant-only turns.
    const role=(shell.getAttribute('data-turn')||'').toLowerCase();
    if (role==='user') return true;
    if (role==='assistant') return true; // Assistant-only announcements are navigable too.
    return !!shell.querySelector(USER_SELECTOR) || !!shell.querySelector('[data-chatgpt-search-unit-key$=":assistant"]');
  }
  function getMessageIdsInDOM(node) {
    if (!node) return [];
    const ids = new Set();
    const key = node.closest('[data-turn-key]') || node.querySelector('[data-turn-key]');
    if (key?.getAttribute('data-turn-key')) ids.add(key.getAttribute('data-turn-key'));
    for(const unit of node.querySelectorAll('[data-chatgpt-search-message-ids]'))
      for (const id of (unit.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/)) if (id) ids.add(id);
    for(const el of [node,...node.querySelectorAll('[data-message-id], [data-message-uuid]')])
      for (const attr of ['data-message-id','data-turn-id','data-message-uuid']) if (el.getAttribute(attr)) ids.add(el.getAttribute(attr));
    return [...ids];
  }
  function getMessageIdFromDOM(node) {
    return getMessageIdsInDOM(node)[0] || '';
  }
  function detectTurns() {
    const timeline=getTimeline();
    if (!timeline) return [];
    const shells=[...timeline.querySelectorAll(SHELL_SELECTOR)];
    let nodes=shells.filter(isUserShell);
    if (!nodes.length) {
      nodes=[...timeline.querySelectorAll(USER_SELECTOR+', [data-chatgpt-search-unit-key$=":assistant"]')]
        .map(el => el.closest(SHELL_SELECTOR)||el);
    }
    const unique=[];
    for(const node of nodes) {
      if(unique.some(n => n===node || n.contains(node))) continue;
      unique.push(node);
    }
    return unique.map((node,i)=>{
      const ids = getMessageIdsInDOM(node);
      const id = ids[0] || '';
      if (!id && !anonymousDOMKeys.has(node)) anonymousDOMKeys.set(node, `local-${++anonymousDOMSerial}`);
      const key = id || anonymousDOMKeys.get(node);
      const prompt = getPromptText(node);
      const automated = !(node.matches(USER_SELECTOR)||node.querySelector(USER_SELECTOR));
      const timestamp = turnTime(node);
      let label = prompt;
      if (automated) {
        const stamp = formatTurnTime(node);
        const summary = getAssistantSummary(node) || '助手回复（无用户提问）';
        label = `⏱ ${stamp ? stamp+' · ' : ''}${summary}`;
      }
      if (label) knownLabels.set(key,label);
      const fallbackKey=node.querySelector('[data-chatgpt-search-unit-key^="fallback-turn-"]')?.getAttribute('data-chatgpt-search-unit-key') || '';
      const ordinalMatch=fallbackKey.match(/^fallback-turn-(\d+):/);
      return {node,id,key,ids,role:automated?'assistant':'user',time:timestamp,
        fallbackOrdinal:ordinalMatch ? Number(ordinalMatch[1]) : null,
        label:label || knownLabels.get(key) || `轮次 ${i+1}（内容尚未渲染）`,source:'dom'};
    });
  }
  // Outline state is per tab/conversation. Only IDs + fold states are persisted;
  // answer text and heading text stay in memory, never in local/session storage.

  // ===== src/outline/outline.js =====
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


  // ===== src/markdown/conversion.js =====
  let exportAPI = new Map(), exportDOM = new Map(), exportDOMMemo = new WeakMap();
  let exportBusy = false, exportEpoch = 0;

  function resetExportState() {
    exportEpoch++; exportBusy=false;
    exportAPI.clear();exportDOM.clear();exportDOMMemo=new WeakMap();exportContentRevision++;searchBodyMemo.clear();
    syncExportButtons();
  }
  function syncExportButtons() {
    if (!shadow) return;
    shadow.querySelectorAll('[data-export-action]').forEach(b=>{
      b.disabled=exportBusy;
      b.setAttribute('aria-busy',String(exportBusy));
    });
    const b=shadow.getElementById('exportAll');
    if(b) b.textContent=exportBusy?'正在准备 Markdown…':'↓ 导出整个对话';
  }
  const exportUnique = values => [...new Set(values.filter(Boolean))];
  function exportSafeURL(raw) {
    if(!raw || /^\s*(?:javascript|data|vbscript):/i.test(raw)) return '';
    try {
      const u=new URL(raw,location.origin);
      return /^(https?:|mailto:)$/.test(u.protocol) ? u.href : '';
    } catch (_) { return ''; }
  }
  function exportEscape(text) {
    return String(text).replace(/\\/g,'\\\\').replace(/([`*_\[\]<>])/g,'\\$1');
  }
  function exportLink(label,url) {
    return `[${String(label).replace(/([\\\[\]])/g,'\\$1')}](${url.replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\s/g,'%20')})`;
  }
  function exportFence(text,language='') {
    const runs=String(text).match(/`+/g)||[];
    const fence='`'.repeat(Math.max(3,...runs.map(x=>x.length+1)));
    return `${fence}${language.replace(/[^\w+.#-]/g,'')}\n${text}${text.endsWith('\n')?'':'\n'}${fence}`;
  }
  function exportInlineCode(text) {
    const runs=String(text).match(/`+/g)||[];
    const fence='`'.repeat(Math.max(1,...runs.map(x=>x.length+1)));
    const pad=/^`|`$|^ .* $/.test(text)?' ':'';
    return fence+pad+text+pad+fence;
  }
  function exportMarkdownDOM(root) {
    const notes=new Set();
    const ignored='script,style,noscript,template,button,textarea,input,select,svg,nav,aside,'+
      '[role="menu"],[role="toolbar"],.sr-only,[hidden],[aria-hidden="true"],[contenteditable="true"]';
    const walk=node=>{
      if(node.nodeType===3) return exportEscape((node.nodeValue||'').replace(/\s+/g,' '));
      if(node.nodeType!==1) return '';
      const tag=node.tagName.toLowerCase();
      if(node.hasAttribute('data-math-source')) {
        const tex=node.getAttribute('data-math-source')||'';
        return node.getAttribute('data-math-display')==='true'?'\n\n$$\n'+tex+'\n$$\n\n':'$'+tex+'$';
      }
      // KaTeX exposes its original TeX in an annotation (read before ignoring hidden markup).
      if(node.matches('.katex-display,.katex,math')) {
        const tex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if(tex) return node.matches('.katex-display')?'\n\n$$\n'+tex+'\n$$\n\n':'$'+tex+'$';
      }
      // Native citation controls may be buttons; only preserve an actual safe link.
      if(node.matches('button,[data-testid*="citation"],[data-citation-id]')) {
        const a=node.matches('a[href]')?node:node.querySelector('a[href]');
        const url=exportSafeURL(a?.getAttribute('href'));
        if(url) return exportLink((a.textContent||'来源').trim(),url);
        if(node.matches('[data-testid*="citation"],[data-citation-id]')) notes.add('部分引用控件未提供可导出的来源链接，请回原对话查看。');
      }
      if(node.matches(ignored)) return '';
      const children=()=>[...node.childNodes].map(walk).join('');
      if(tag==='pre') {
        const code=node.querySelector('code');
        const text=(code||node).textContent||'';
        const lang=(code?.className||'').match(/language-([\w+.#-]+)/)?.[1] || node.getAttribute('data-language')||'';
        return '\n\n'+exportFence(text,lang)+'\n\n';
      }
      if(tag==='code'||node.matches('[data-markdown-copy="inline-code"]')) return exportInlineCode(node.textContent||'');
      if(tag==='br') return '  \n';
      if(tag==='hr') return '\n\n---\n\n';
      if(tag==='img') {
        const alt=node.getAttribute('alt')||'图片';
        const url=exportSafeURL(node.getAttribute('src'));
        notes.add('图片只导出链接或占位文字，不包含图片文件；链接可能需要登录或会失效。');
        return url?'!'+exportLink(alt,url):`[图片：${exportEscape(alt)}，请在原对话查看]`;
      }
      if(tag==='audio'||tag==='video'||tag==='canvas'||tag==='iframe') {
        notes.add('音视频、画布及嵌入内容不包含在 Markdown 中。');
        return `[${tag==='audio'?'音频':tag==='video'?'视频':'嵌入内容'}：请在原对话查看]`;
      }
      if(tag==='a') {
        const raw=node.getAttribute('href')||'',url=exportSafeURL(raw);
        const text=children().trim()||(node.textContent||'链接').trim();
        if(url) return `[${text}](${url.replace(/\(/g,'%28').replace(/\)/g,'%29')})`;
        if(/^(?:blob|sandbox|attachment):/i.test(raw)) {
          notes.add('附件下载地址只在原会话中有效；导出的 Markdown 不包含附件文件。');
          return `${text} [附件：请回原对话下载]`;
        }
        return text;
      }
      if(tag==='table') {
        const rows=[...node.querySelectorAll('tr')].filter(tr=>tr.closest('table')===node).map(tr=>
          [...tr.children].filter(c=>/^(TH|TD)$/.test(c.tagName)).map(c=>
            [...c.childNodes].map(walk).join('').trim().replace(/\|/g,'\\|').replace(/\n+/g,'<br>')));
        if(!rows.length) return '';
        if(node.querySelector('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])'))
          notes.add('含合并单元格的表格已简化为普通 Markdown 表格。');
        const width=Math.max(...rows.map(r=>r.length));
        const line=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
        return '\n\n'+[line(rows[0]),line(Array(width).fill('---')),...rows.slice(1).map(line)].join('\n')+'\n\n';
      }
      if(tag==='ul'||tag==='ol') {
        let number=Number(node.getAttribute('start'))||1;
        const lines=[...node.children].filter(li=>li.tagName==='LI').map(li=>{
          if(li.hasAttribute('value')) number=Number(li.getAttribute('value'))||number;
          const bullet=tag==='ol'?`${number++}. `:'- ';
          const box=li.querySelector(':scope > input[type="checkbox"]');
          const text=[...li.childNodes].map(walk).join('').trim();
          const prefix=bullet+(box?(box.checked?'[x] ':'[ ] '):'');
          return prefix+text.split('\n').map((l,i)=>i?' '.repeat(bullet.length)+l:l).join('\n');
        });
        return '\n\n'+lines.join('\n')+'\n\n';
      }
      const body=children();
      if(/^h[1-6]$/.test(tag) || node.getAttribute('role')==='heading') {
        const level=/^h[1-6]$/.test(tag)?+tag[1]:clamp(+node.getAttribute('aria-level')||2,1,6);
        return '\n\n'+'#'.repeat(level)+' '+body.trim()+'\n\n';
      }
      if(tag==='blockquote') return '\n\n'+body.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
      if(tag==='strong'||tag==='b') return '**'+body+'**';
      if(tag==='em'||tag==='i') return '*'+body+'*';
      if(tag==='del'||tag==='s') return '~~'+body+'~~';
      if(tag==='summary') return '\n\n**'+body.trim()+'**\n\n';
      if(/^(p|div|section|article|figure|figcaption|details|dl|dt|dd)$/.test(tag)) return '\n\n'+body.trim()+'\n\n';
      return body;
    };
    // Preserve code blocks byte-for-byte; normalize only surrounding block spacing.
    const raw=walk(root).trim();
    let fence=null;
    const lines=raw.split('\n'),out=[];
    for(const line of lines) {
      const m=line.match(/^\s*(`{3,}|~{3,})/);
      if(m) {
        if(!fence) fence={char:m[1][0],size:m[1].length};
        else if(m[1][0]===fence.char && m[1].length>=fence.size) fence=null;
        out.push(line);continue;
      }
      if(!fence && !line.trim() && out.length>=2 && !out.at(-1).trim() && !out.at(-2).trim()) continue;
      out.push(line);
    }
    return {markdown:out.join('\n'),notes:[...notes],source:'dom'};
  }
  function exportAPIBody(item) {
    const message=item?.message||item,content=message?.content;
    const notes=[],parts=[];
    const parse=part=>{
      if(typeof part==='string') {parts.push(part);return;}
      if(!part || typeof part!=='object') return;
      const text=readable(part.text)||readable(part.text?.value)||readable(part.content)||readable(part.value);
      if(text) {parts.push(text);return;}
      const type=String(part.content_type||part.type||'');
      if(/image/i.test(type)||part.asset_pointer||part.image_url) {
        const url=exportSafeURL(typeof part.image_url==='string'?part.image_url:part.image_url?.url);
        parts.push(url?'!'+exportLink('图片',url):'[图片：请在原对话查看]');
        notes.push('图片只保留链接或占位文字，不包含图片文件。');
      } else if(/audio|video/i.test(type)) {
        parts.push('[音视频内容：请在原对话查看]');notes.push('音视频未导出，仅保留可取得的文字。');
      } else {
        parts.push('[非文本内容：请在原对话查看]');notes.push('部分结构化内容无法还原为 Markdown。');
      }
    };
    if(typeof content==='string') parts.push(content);
    else if(content) {
      const array=Array.isArray(content.parts)?content.parts:Array.isArray(content.content)?content.content:null;
      if(array) array.forEach(parse);
      else if(readable(content.text)||readable(content.value)) parts.push(readable(content.text)||readable(content.value));
      else parse(content);
    }
    const attachments=message?.metadata?.attachments;
    if(Array.isArray(attachments) && attachments.length) {
      const names=attachments.map(a=>a?.name||a?.filename||'附件').map(n=>String(n).replace(/[\r\n]/g,' '));
      parts.push('\n[附件：'+names.join('；')+'；文件本体请在原对话下载]');
      notes.push('Markdown 不包含附件文件本体。');
    }
    let markdown=parts.join('\n');
    // Resolve known citation URLs outside literal fenced/inline code; otherwise
    // leave a readable placeholder instead of inventing a public source URL.
    const sources=new Map();
    const references=message?.metadata?.content_references;
    for(const ref of Array.isArray(references)?references:[]) {
      if(!ref || typeof ref!=='object') continue;
      const entries=[ref,...(Array.isArray(ref.items)?ref.items:[]),...(Array.isArray(ref.sources)?ref.sources:[])];
      const urls=exportUnique(entries.map(s=>exportSafeURL(s?.url||s?.source_url)));
      for(const s of entries) {
        const id=s?.ref_id||s?.reference_id;
        if(typeof id==='string' && urls.length) sources.set(id,urls);
      }
      if(typeof ref.matched_text==='string' && urls.length) sources.set(ref.matched_text,urls);
    }
    let fence=null;
    markdown=markdown.split('\n').map(line=>{
      const fm=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if(fm) {
        if(!fence) fence={char:fm[1][0],size:fm[1].length};
        else if(fm[1][0]===fence.char && fm[1].length>=fence.size && !fm[2].trim()) fence=null;
        return line;
      }
      if(fence) return line;
      return line.split(/(`+[^`]*(?:`+))/g).map((segment,i)=>i%2?segment:segment.replace(/\uE200([^\uE201]*?)\uE201/g,(all,inner)=>{
        const tokens=inner.split(/\uE202|\uE205/),kind=tokens.shift();
        if(kind==='cite'||kind==='filecite') {
          const urls=exportUnique([...(sources.get(all)||[]),...tokens.flatMap(id=>sources.get(id)||[])]);
          if(urls.length) return urls.map((url,i)=>exportLink('来源'+(i+1),url)).join(' ');
          notes.push('部分引用缺少可导出的来源 URL，已保留占位说明，请回原对话核对。');
          return '[引用：请在原对话查看来源]';
        }
        notes.push('部分交互卡片无法还原，已保留占位说明。');
        return '[交互内容：请在原对话查看]';
      })).join('');
    }).join('\n');
    return {markdown,notes:exportUnique(notes),source:'api',
      unfinished:/in_progress|streaming|pending/i.test(String(message?.status||''))};
  }
  function rememberExportAPI(item,id,role) {
    const body=exportAPIBody(item);
    exportContentRevision++;
    exportAPI.set(id,{...body,id,ids:[id],role,time:apiTimestamp(item),observedAt:Date.now()});
  }
  function exportSnapshotNode(node,kind) {
    if(!node?.isConnected) return null;
    const signature=contentTracker.version(node);
    const prev=exportDOMMemo.get(node);
    if(prev?.signature===signature && prev.kind===kind) return prev.body;
    contentTracker.metrics.bodyBuilds++;exportContentRevision++;
    let body;
    if(kind==='user') {
      const roots=outermost([...node.querySelectorAll('.whitespace-pre-wrap,[data-testid="user-message-text"]')]);
      const pieces=roots.length?roots.map(n=>n.innerText||n.textContent||''):[node.innerText||node.textContent||''];
      body={markdown:pieces.join('\n\n').trim(),notes:[],source:'dom'};
      if(node.querySelector('img') || node.querySelector('a[href^="blob:"],a[href^="sandbox:"]')) {
        body.notes.push('提问含图片或附件；仅导出可取得的文字，不包含附件文件。');
        body.markdown+='\n\n[图片或附件：请在原对话查看]';
      }
    } else {
      let roots=outermost([...node.querySelectorAll(BODY_SELECTOR)]);
      if(node.matches(BODY_SELECTOR)) roots=[node];
      const pieces=(roots.length?roots:[node]).map(exportMarkdownDOM);
      body={markdown:pieces.map(p=>p.markdown).filter(Boolean).join('\n\n'),
        notes:exportUnique(pieces.flatMap(p=>p.notes)),source:'dom'};
    }
    // Keep only strings and scalars. No disconnected DOM trees in content caches.
    body.observedAt=Date.now();
    exportDOMMemo.set(node,{signature,kind,body});
    return body;
  }
  function captureExportDOM(turn) {
    if(!turn.node?.isConnected) return;
    const prior=exportDOM.get(turn.key),node=turn.node;
    const user=node.matches(USER_SELECTOR)?node:node.querySelector(USER_SELECTOR);
    const question=user?exportSnapshotNode(user,'user'):prior?.question||null;
    const answers=(turn.answers||[]).filter(a=>a.node?.isConnected).map(a=>({
      ...exportSnapshotNode(a.node,'assistant'),id:a.key,ids:exportUnique([a.key,...a.ids]),role:'assistant'
    })).filter(a=>a.markdown);
    const snapshot={key:turn.key,ids:turnIds(turn),question,answers:answers.length?answers:prior?.answers||[]};
    exportDOM.set(turn.key,snapshot);
  }
  function exportFindSnapshot(turn) {
    const exact=exportDOM.get(turn.key);if(exact) return exact;
    const ids=new Set(turnIds(turn));
    return [...exportDOM.values()].find(s=>s.ids.some(id=>ids.has(id)))||null;
  }
  function exportTurnBody(turn,number,answerSelection=null) {
    const snapshot=exportFindSnapshot(turn),ids=turnIds(turn),missing=[],notes=[];
    const api=ids.map(id=>exportAPI.get(id)).filter(Boolean);
    const apiAnswers=api.filter(m=>m.role==='assistant' && m.markdown?.trim());
    const question=api.find(m=>m.role==='user')||snapshot?.question||null;
    const answers=[],used=new Set();
    const add=m=>{if(m?.markdown?.trim() && !used.has(m.id)) {answers.push(m);used.add(m.id);}};
    const matchedDOM=new Set();
    for(const [outlineIndex,outline] of (turn.answers||[]).entries()) {
      const oids=exportUnique([outline.key,...(outline.ids||[])]);
      if(answerSelection && !oids.some(id=>answerSelection.includes(id))) continue;
      let fromAPI=oids.map(id=>exportAPI.get(id)).filter(m=>m?.role==='assistant' && m.markdown?.trim());
      // Some layouts identify the user/turn but expose no per-answer ID. Once
      // that turn is matched, use its API replies rather than exporting both
      // the DOM transcription and the same raw response a second time.
      const noMessageID=!(outline.ids||[]).length;
      if(!fromAPI.length && noMessageID && apiAnswers.length) {
        if((turn.answers||[]).length===1) fromAPI=apiAnswers;
        else if(apiAnswers.length===(turn.answers||[]).length) fromAPI=[apiAnswers[outlineIndex]];
      }
      const dom=snapshot?.answers.find(a=>a.ids.some(id=>oids.includes(id)));
      if(dom) matchedDOM.add(dom);
      if(fromAPI.length) {
        for(const m of fromAPI) add(m.unfinished&&dom?{...dom,id:m.id,unfinished:true}:m);
      } else if(dom) add(dom);
      else {missing.push('回答正文未取得');add({id:'missing:'+outline.key,markdown:'> [本回答正文未取得。请加载该回答后重试。]',source:'missing'});}
    }
    if(!answerSelection) {
      apiAnswers.forEach(add);
      for(const a of snapshot?.answers||[]) if(!matchedDOM.has(a) && !a.ids.some(id=>used.has(id))) add(a);
    }
    if(!answers.length) missing.push('回答尚未生成或正文未取得');
    if(turn.role==='user' && !question?.markdown?.trim() && !answerSelection) missing.push('提问正文未取得');
    const content=[`## 第 ${number} 轮${turn.role==='assistant'?' · 助手独立回复':''}`];
    if(turn.time!=null) content.push(`时间：${new Date(turn.time).toISOString()}`);
    if(turn.role==='user' && !answerSelection) {
      content.push('### 提问',question?.markdown||'> [提问正文未取得；目录摘要不能替代完整提问。]');
      if(question) notes.push(...(question.notes||[]));
    }
    answers.forEach((a,i)=>{
      content.push(`### 回答${answers.length>1?' '+(i+1):''}`,a.markdown);
      notes.push(...(a.notes||[]));
    });
    if(!answers.length) content.push('### 回答','> [回答尚未生成或正文未取得；请在原对话核对。]');
    const bodies=[...answers,...(turn.role==='user'&&!answerSelection&&question?[question]:[])];
    if(bodies.some(b=>b.source==='dom')) notes.push('部分正文由页面转换为 Markdown，复杂卡片或特殊排版可能简化。');
    if(bodies.some(b=>b.unfinished)) {notes.push('导出时部分回答尚在生成，仅包含此刻可取得的内容。');missing.push('回答尚在生成');}
    return {markdown:content.join('\n\n'),notes:exportUnique(notes),missing:exportUnique(missing)};
  }
  function exportTitle() {
    return (document.title||'ChatGPT 对话').replace(/\s*[-–—|]\s*ChatGPT\s*$/i,'').trim()||'ChatGPT 对话';
  }
  function exportFilename(title,suffix) {
    let base=[...String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'')].slice(0,75).join('')||'ChatGPT';
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base='_'+base;
    const d=new Date(),stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
    return `${base}_${suffix}_${stamp}.md`;
  }
  function exportBuild(selected,kind,selection=null) {
    const parts=selected.map(({turn,number})=>exportTurnBody(turn,number,selection));
    const missing=parts.reduce((n,p)=>n+(p.missing.length?1:0),0);
    const generating=!!getTimeline()?.querySelector('[data-is-streaming="true"],[data-message-status="in_progress"]') ||
      !!document.querySelector('[data-testid="stop-button"],[data-testid="composer-stop-button"]');
    const partial=(kind==='all'&&!apiComplete)||missing>0||generating;
    const notes=exportUnique(parts.flatMap(p=>p.notes));
    if(kind==='all'&&!apiComplete) notes.unshift('未确认完整历史：本文件仅包含已取得的轮次，不代表全部对话。');
    if(missing) notes.unshift(`${missing} 轮存在正文缺失或仍在生成，缺失位置已在正文中标明。`);
    if(generating) notes.push('检测到回答仍在生成；本次导出是当前内容快照。');
    if(apiError) notes.push('本次历史读取未完全成功；部分正文可能来自本标签页缓存。');
    const title=exportTitle(),range=kind==='all'?'整个对话（当前分支）':kind==='answer'?'单条回答':`单轮 Q/A（第 ${selected[0].number} 轮）`;
    const head=[`# ${title.replace(/[\r\n]/g,' ')}`,
      `> 导出范围：${range}${partial?' · 部分内容/快照':''}\n> 导出轮次：${selected.length}\n> 导出时间：${new Date().toISOString()}\n> 原对话：${conversationScope()}`];
    if(notes.length) head.push('> 导出说明\n'+notes.map(n=>'> - '+n).join('\n'));
    const markdown=head.join('\n\n')+'\n\n---\n\n'+parts.map(p=>p.markdown).join('\n\n---\n\n')+'\n';
    const suffix=(kind==='all'?'全部对话':`第${String(selected[0].number).padStart(3,'0')}轮${kind==='answer'?'回答':'QA'}`)+(partial?'_部分':'');
    return {markdown,filename:exportFilename(title,suffix),partial,notes,count:selected.length};
  }
  function exportDownload(result) {
    const blob=new Blob([result.markdown],{type:'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=result.filename;a.style.display='none';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  // ===== src/markdown/actions.js =====
  async function exportMarkdown(kind='all',target=null,answerSelection=null,delivery='download') {
    if(exportBusy)return;
    pinPanelOpen();const scope=conversationScope(),ticket=++exportEpoch;
    const targetIds=target?turnIds(target):kind==='all'?[]:turnIds(turns[activeIndex]);
    exportBusy=true;syncExportButtons();
    setHint(`正在准备 Markdown${delivery==='copy'?'以复制':'文件'}…`,120000);
    try {
      safeUpdate(false);
      let selected=kind==='all'?turns:turns.filter(t=>turnIds(t).some(id=>targetIds.includes(id))).slice(0,1);
      const hasBody=selected.length&&selected.every((t,i)=>!exportTurnBody(t,i+1,answerSelection).missing.length);
      // Local Q/A and answer exports are immediate. Full-history reads remain
      // optional, have a cooldown after explicit 404s, and never drive scrolling.
      const needHistory=kind==='all'?!apiComplete:!hasBody;
      if(needHistory&&chatId()&&Date.now()>=apiCooldownUntil)await loadApiIndex(false);
      if(scope!==conversationScope()||ticket!==exportEpoch)return;
      safeUpdate(false);
      const all=turns.map((turn,i)=>({turn,number:i+1}));
      selected=kind==='all'?all:all.filter(({turn})=>turnIds(turn).some(id=>targetIds.includes(id))).slice(0,1);
      if(!selected.length)throw new Error('要导出的消息当前不在索引中，请重新选择。');
      const result=exportBuild(selected,kind,answerSelection);
      if(delivery==='copy') {
        const copied=await copyMarkdownText(result.markdown);
        if(scope!==conversationScope()||ticket!==exportEpoch)return;
        setHint(copied?`已复制 ${result.count} 轮 Markdown${result.partial?'（部分内容/快照）':''}。`:'Markdown 已准备好，请在文本框中手动复制。',10000);
      } else {
        exportDownload(result);setHint(`已导出 ${result.count} 轮 Markdown${result.partial?'（部分内容，见文件说明）':''}。`,12000);
      }
    } catch(error){if(scope===conversationScope()&&ticket===exportEpoch)setHint('Markdown 操作失败：'+String(error?.message||error).slice(0,160),9000);}
    finally{if(ticket===exportEpoch){exportBusy=false;syncExportButtons();}}
  }


  // ===== src/app/diagnostics.js =====
  function diagnose() {
    const root = document, mains = [...document.querySelectorAll('main')];
    return {
      script: '1.9.0', routeIsChat: isChatPage(),
      mainCount: mains.length, firstMainChildren: mains[0]?.children.length ?? 0,
      documentTurnShells: root.querySelectorAll(SHELL_SELECTOR).length,
      mainTurnShells: mains[0]?.querySelectorAll(SHELL_SELECTOR).length ?? 0,
      documentUserRoleNodes: root.querySelectorAll('[data-message-author-role="user"]').length,
      documentUserBubbles: root.querySelectorAll('.user-message-bubble-color, [class*="user-message-bubble"]').length,
      documentArticleCount: root.querySelectorAll('article').length,
      detectedDOMTurns: detectTurns().length,
      domAssistantOnlyTurns: detectTurns().filter(t=>t.role==='assistant').length,
      indexedAPITurns: apiTurns.length, apiAssistantOnlyTurns: apiTurns.filter(t=>t.role==='assistant').length,
      displayedTurns: turns.length, displayedAssistantOnlyTurns: turns.filter(t=>t.role==='assistant').length,
      timelineFound: !!getTimeline(), sidebarFound: !!document.querySelector('[data-app-action-sidebar-scroll]'),
      turnKeyNodes: getTimeline()?.querySelectorAll('[data-turn-key]').length || 0,
      userBubbles: getTimeline()?.querySelectorAll('[data-user-message-bubble]').length || 0,
      attachedTurns: turns.filter(t => !!t.node?.isConnected).length,
      apiStatus, apiError, apiPages, apiTruncated,
      ordering:{...lastOrderCheck,totalOrderCorrections,
        spatial:{...lastSpatialCheck,totalSpatialCorrections},
        scan:{running:scanBusy,steps:scanLastSteps,observations:scanLastSeen},
        knownSpatialTurnPositions:turns.filter(t=>geometry.get(t,turnIds)).length,
        apiOrderVerified:apiComplete && apiTurns.length>0},
      indexState:{rememberedTurns:indexCatalog.length,apiComplete,apiFailures,
        retryScheduled:!!apiRetryAt,outlineParseErrors:apiOutlineErrors,
        unmountedTurns:turns.filter(t=>!t.node?.isConnected).length},
      panelLayout: {...effectiveLayout,preferredHeight:layout.h,maxHeight:CONFIG.maxPanelHeight},
      outline: {answers:turns.reduce((n,t)=>n+(t.answers||[]).length,0),headings:turns.reduce((n,t)=>n+(t.answers||[]).reduce((a,b)=>a+b.headings.length,0),0),expanded:expandedAnswers.size},
      ux: {mountedOnly,returnHistoryCount:returnPositions.length,filterMatchCount:filteredIndices.length},
      scrollMetrics: (() => { const s=getTimeline(); return s ? {direction:getComputedStyle(s).flexDirection,scrollTop:s.scrollTop,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight,range:scrollBounds(s)} : null; })(),
      markdownExport:{apiBodies:exportAPI.size,domSnapshots:exportDOM.size,busy:exportBusy},
      lastJump,
      incremental:{...contentTracker.metrics,...runtimeMetrics},
      navigation:navigation.summary(),
      layoutEvidence:geometry.summary(),orderEvidence:orderEvidence.summary(),
      reading:{available:!!resumePoint,storage:'IDs + hashes + offsets only'},
      historyCooldown:Date.now()<apiCooldownUntil,
      viewportWidth: innerWidth,
    };
  }

  // ===== src/adapters/normalize.js =====
  function chatId() {
    const m = location.pathname.match(/^\/(?:c|g\/[^/]+\/c)\/([a-zA-Z0-9-]+)/);
    return m ? m[1] : null;
  }
  const readable = x => typeof x === 'string' ? x : '';
  function roleOf(item) {
    return item?.message?.author?.role || item?.author?.role || item?.message?.role || item?.role || '';
  }
  function messageIdOf(item) {
    return item?.message?.id || item?.id || item?.message_id || item?.message?.message_id || '';
  }
  function labelOf(item) {
    const c = item?.message?.content || item?.content || {};
    let parts = c.parts || c.content || [];
    if (!Array.isArray(parts)) parts = [parts];
    let raw = parts.map(x => readable(x) || readable(x?.text) || readable(x?.content) || readable(x?.text?.value)).filter(Boolean).join(' ');
    if (!raw) raw = readable(c.text) || readable(c.value);
    return raw.replace(/\s+/g, ' ').trim().slice(0, CONFIG.maxPromptLength);
  }
  function apiTimestamp(item) {
    const raw = item?.message?.create_time ?? item?.create_time ?? item?.message?.timestamp ?? item?.timestamp;
    if (typeof raw === 'number') return raw < 1e12 ? raw*1000 : raw;
    if (typeof raw === 'string') {
      const t = Number(raw);
      if (Number.isFinite(t) && t > 0) return t < 1e12 ? t*1000 : t;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }
  function formatApiTime(time) {
    if (time == null) return '';
    const date = new Date(time);
    return `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function normalizeFlat(records) {
    const seen=new Set(), result=[], byTurn=new Map(), byMessage=new Map(), parents=new Map();
    const relation=item=>{
      const m=item?.message||item,meta=m?.metadata||item?.metadata||{};
      const run=m?.task_run_id||item?.task_run_id||meta.task_run_id||meta.automation_run_id;
      const turn=m?.turn_id||m?.turn_key||item?.turn_id||item?.turn_key||meta.turn_id||meta.turn_key;
      return {group:run?'run:'+run:turn?'turn:'+turn:'',parent:m?.parent_id||item?.parent_id||item?.parent||'',run:!!run};
    };
    // Tree paths can contain hidden analysis/tool nodes between a question and
    // its visible final answer. Walk through those IDs without exporting them.
    for(const item of records) {
      const id=messageIdOf(item),r=relation(item);
      const parent=typeof r.parent==='string'?r.parent:r.parent?.id;
      if(id)parents.set(id,parent||'');
      if(item?._nodeId)parents.set(item._nodeId,parent||'');
    }
    const visibleAncestor=parent=>{
      let id=typeof parent==='string'?parent:parent?.id;const visited=new Set();
      while(id&&!visited.has(id)){if(byMessage.has(id))return byMessage.get(id);visited.add(id);id=parents.get(id);}
      return null;
    };
    for(const item of records) {
      const message=item?.message||item, role=roleOf(item);
      if(role!=='user'&&role!=='assistant')continue;
      const meta=message?.metadata||item?.metadata||{};
      if(meta.is_visually_hidden_from_conversation || (message?.recipient&&message.recipient!=='all'))continue;
      const channel=meta.channel||message?.channel||item?.channel;
      if(channel&&channel!=='final')continue;
      const id=messageIdOf(item)||`anon-${result.length}`;
      if(seen.has(id))continue;seen.add(id);
      try{rememberExportAPI(item,id,role);}catch{}
      const text=labelOf(item)||(exportAPI.get(id)?.markdown||'').replace(/\s+/g,' ').trim().slice(0,CONFIG.maxPromptLength);
      const time=apiTimestamp(item),r=relation(item);
      if(role==='user') {
        const t={id,key:id,ids:[id],role,label:text||'提问（附件或无文本）',node:null,source:'api',time,
          apiTurnKey:r.group||null,answers:[]};
        result.push(t);byMessage.set(id,t);if(item?._nodeId)byMessage.set(item._nodeId,t);if(r.group)byTurn.set(r.group,t);continue;
      }
      let target=r.group?byTurn.get(r.group):null;
      const parent=visibleAncestor(r.parent);
      if(!target&&parent&&(!r.group||!parent.apiTurnKey||r.group===parent.apiTurnKey)&&!r.run)target=parent;
      const last=result.at(-1);
      // Adjacency is a fallback for the first ordinary answer only. It never
      // merges two independent task runs solely because their timestamps match.
      if(!target&&!r.group&&!r.parent&&!r.run&&last?.role==='user'&&!last.answers.length)target=last;
      if(target) {
        target.ids.push(id);target.answers.push(apiAnswer(item,id));byMessage.set(id,target);if(item?._nodeId)byMessage.set(item._nodeId,target);
        if(r.group){byTurn.set(r.group,target);target.apiTurnKey=r.group;}
        continue;
      }
      if(!text)continue;
      const t={id,key:id,ids:[id],role:'assistant',apiTurnKey:r.group||null,
        label:`⏱ ${formatApiTime(time)?formatApiTime(time)+' · ':''}${text}`,node:null,source:'api',time,answers:[apiAnswer(item,id)]};
      result.push(t);byMessage.set(id,t);if(item?._nodeId)byMessage.set(item._nodeId,t);if(r.group)byTurn.set(r.group,t);
    }
    return result;
  }

  function normalizeTree(data) {
    const mapping = data?.mapping || {}, result = [], seen = new Set();
    let nodeId = data.current_node;
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      result.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }
    result.reverse();
    return normalizeFlat(result.map(n => n.message ? ({ ...n.message, id: n.message.id || n.id, parent_id:n.message.parent_id||n.parent, _nodeId:n.id, _treePath:true }) : n));
  }

  // ===== src/model/catalog.js =====
  function turnIds(turn) {
    return [...new Set([turn?.key, turn?.id, ...(turn?.ids || [])].filter(Boolean))];
  }
  function metadataSnapshot(turn) {
    return {...turn, catalogKey:turn.catalogKey || turn.key, node:null,
      answers:(turn.answers || []).map(a=>({...a, node:null,
        headings:(a.headings || []).map(h=>({...h,node:null}))}))};
  }
  function combineTurnDetails(a, b) {
    const answers=(a.answers || []).slice();
    for (const answer of b.answers || []) {
      const i=answers.findIndex(old=>sameAnswer(old,answer));
      if(i<0) answers.push(answer);
      else if(answer.source==='dom' || !(answers[i].headings || []).length) answers[i]=answer;
    }
    const preferred=b.role==='user' || a.role!=='user' ? b : a;
    const aa=Number(a.spatialSeenAt)||0, bb=Number(b.spatialSeenAt)||0;
    const currentPosition=bb>=aa ? b : a;
    // Preserve measurements across virtualization: the visible DOM object often
    // disappears before the next turn is inserted into the catalog.
    const observed=Number.isFinite(currentPosition.spatialOrder) ? currentPosition :
      Number.isFinite(a.spatialOrder) ? a : b;
    return {...a,...b, key:a.catalogKey || b.catalogKey || a.key || b.key,
      catalogKey:a.catalogKey || b.catalogKey,
      ids:[...new Set([...turnIds(a),...turnIds(b)])],
      role:preferred.role, label:preferred.label || a.label || b.label,
      time:a.time ?? b.time, node:b.node || a.node || null, answers,
      spatialOrder:observed.spatialOrder, spatialSeenAt:observed.spatialSeenAt,
      spatialDirection:observed.spatialDirection, spatialSpan:observed.spatialSpan,
      fallbackOrdinal:Number.isFinite(b.fallbackOrdinal)?b.fallbackOrdinal:a.fallbackOrdinal};
  }
  function mergeIndexSequences(base, incoming) {
    // Identity only: never merge repeated prompts by text or by viewport position.
    const merged=base.map(t=>({...t})), byId=new Map(), attached=new Map();
    const register=t=>turnIds(t).forEach(id=>byId.set(id,t));
    merged.forEach(register);
    for(const d of incoming) {
      const matches=[...new Set(turnIds(d).map(id=>byId.get(id)).filter(Boolean))];
      if(!matches.length) continue;
      const target=matches[0];
      for(const extra of matches.slice(1)) {
        Object.assign(target,combineTurnDetails(target,extra));
        const index=merged.indexOf(extra);if(index>=0) merged.splice(index,1);
        for(const [item,entry] of attached) if(entry===extra) attached.set(item,target);
      }
      Object.assign(target,combineTurnDetails(target,d)); register(target); attached.set(d,target);
    }
    for(let i=0;i<incoming.length;i++) {
      const d=incoming[i]; if(attached.has(d)) continue;
      const next=incoming.slice(i+1).find(x=>attached.has(x));
      let position=next ? merged.indexOf(attached.get(next)) : -1;
      if(position<0) {
        const prev=[...incoming.slice(0,i)].reverse().find(x=>attached.has(x));
        if(prev) {
          position=merged.indexOf(attached.get(prev))+1;
          while(position<merged.length && d.time!=null && merged[position].time!=null && merged[position].time<=d.time) position++;
        } else if(d.time!=null) position=merged.findIndex(t=>t.time!=null && t.time>d.time);
      }
      if(position<0) position=merged.length;
      const entry={...d};merged.splice(position,0,entry);register(entry);attached.set(d,entry);
    }
    if(merged.length>1 && merged.every(t=>t.time!=null)) merged.sort((a,b)=>a.time-b.time);
    return merged;
  }

  // ===== src/model/ordering.js =====
  function annotateSpatialPositions(dom) {
    const scroller=getTimeline();if(!scroller)return;
    geometry.observe(dom,scroller,turnIds);
    for(const t of dom) {
      const p=geometry.get(t,turnIds);if(!p)continue;
      t.spatialOrder=p.top*p.sign;t.spatialSeenAt=p.seen;
      t.spatialDirection=getComputedStyle(scroller).flexDirection;t.spatialSpan=scroller.scrollHeight;
    }
  }
  function reconcileSpatialOrder(merged) {
    const scroller=getTimeline();if(!scroller) {
      lastSpatialCheck={observed:0,corrected:false,corrections:0,reason:'waiting for timeline'};return merged;
    }
    const known=merged.map(t=>({t,p:geometry.get(t,turnIds)})).filter(x=>x.p);
    if(apiComplete&&apiTurns.length)orderEvidence.sequence(apiTurns.map(t=>t.key),4);
    else orderEvidence.sequence(known.sort((a,b)=>(a.p.top-b.p.top)*geometry.sign).map(x=>x.t.key),1);
    const ordered=orderEvidence.sort(merged,turnIds),moved=merged.reduce((n,t,i)=>n+(t!==ordered[i]),0);
    if(moved){merged.splice(0,merged.length,...ordered);totalSpatialCorrections++;}
    lastSpatialCheck={observed:known.length,corrected:!!moved,corrections:moved,comparable:true,layoutEpoch:geometry.epoch};
    return merged;
  }
  function reconcileVisibleOrder(merged,dom) {
    orderEvidence.sequence(dom.map(t=>t.key),3);
    const ordered=orderEvidence.sort(merged,turnIds),moved=merged.reduce((n,t,i)=>n+(t!==ordered[i]),0);
    if(moved){merged.splice(0,merged.length,...ordered);totalOrderCorrections++;}
    lastOrderCheck={mountedCompared:dom.length,corrected:!!moved,corrections:moved};return merged;
  }

  function mergeTurns(dom) {
    // API order is the backbone, remembered DOM-only turns fill its gaps.
    // This also works if API is unavailable, partial, or omits scheduled replies.
    annotateSpatialPositions(dom);
    const history=mergeIndexSequences(apiTurns, indexCatalog);
    const merged=mergeIndexSequences(history,dom), timeline=getTimeline();
    reconcileSpatialOrder(merged);
    reconcileVisibleOrder(merged,dom);
    return merged.map(t=>({...t,node:t.node?.isConnected && timeline?.contains(t.node)?t.node:null}));
  }
  function acceptAPIIndex(result, complete) {
    if(complete) {
      // A confirmed active-branch snapshot can remove previously API-backed turns.
      // Do NOT prune DOM-only scheduled replies that this API never reported.
      const previous=new Set(apiTurns.flatMap(turnIds)), next=new Set(result.flatMap(turnIds));
      indexCatalog=indexCatalog.filter(t=>!turnIds(t).some(id=>previous.has(id)) || turnIds(t).some(id=>next.has(id)));
      apiTurns=result;
    } else apiTurns=mergeIndexSequences(apiTurns,result);
    apiComplete=complete;
  }

  // ===== src/adapters/history.js =====
  async function requestChatJSON(url, token, signal) {
    const headers={accept:'application/json'};
    if(token) headers.authorization=`Bearer ${token}`;
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,15000);
    try {
      const response=await fetch(url,{credentials:'include',headers,cache:'no-store',signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function loadApiIndex(force=false) {
    const id=chatId();if(!id){apiStatus='非私人对话页面';return;}
    const key=`${location.origin}:${id}`;
    if(apiPending && apiKey===key) return apiPending;
    if(!force && apiKey===key && (apiTurns.length || apiError) && (!apiRetryAt || Date.now()<apiRetryAt)) return;
    if(!force&&Date.now()<apiCooldownUntil)return;
    if(force)apiCooldownUntil=0;
    apiKey=key;apiRetryAt=0;
    const generation=++fetchGeneration, scope=conversationScope();
    apiController?.abort();const controller=new AbortController();apiController=controller;
    apiStatus='正在读取历史索引';apiError='';apiPages=0;apiTruncated=false;
    const stale=()=>generation!==fetchGeneration || scope!==conversationScope() || key!==apiKey;
    const publish=(result,complete=false)=>{
      if(stale() || !result.length) return;
      acceptAPIIndex(result,complete); update(true);
    };
    const run=async()=>{
      let token, tokenAttempted=false, result=[], complete=false, firstError=null;
      const request=async url=>{
        if(stale()) throw new Error('对话已切换');
        try {return await requestChatJSON(url,token,controller.signal);}
        catch(err) {
          if(stale() || tokenAttempted || !/HTTP (401|403)/.test(String(err))) throw err;
          tokenAttempted=true;
          const session=await requestChatJSON('/api/auth/session',undefined,controller.signal);
          token=session?.accessToken;if(!token) throw err;
          return await requestChatJSON(url,token,controller.signal);
        }
      };
      try {
        let cursor='', records=[], visited=new Set();
        for(let page=0;page<100;page++) {
          let url=`/backend-api/conversations/${encodeURIComponent(id)}?include_has_versions=true&num_turns=100`;
          if(cursor) url+=`&before=${encodeURIComponent(cursor)}`;
          const data=await request(url);if(stale()) return;apiPages++;
          if(data?.mapping) {result=normalizeTree(data);complete=!!result.length;break;}
          if(!Array.isArray(data?.messages)) throw new Error('历史消息结构未识别');
          records=[...data.messages,...records];result=normalizeFlat(records);
          publish(result,false); // Keep every successfully read page, even if the next page fails.
          const info=data.page_info;
          if(info?.has_previous_page===false) {complete=true;break;}
          if(info?.has_previous_page!==true) throw new Error('分页信息缺失，无法确认目录完整性');
          const next=info.start_cursor;
          if(!next || visited.has(next)) throw new Error('分页游标缺失或重复');
          visited.add(next);cursor=next;
          if(page===99) throw new Error('达到分页读取上限');
        }
        if(!result.length) throw new Error('未收到可解析的对话消息');
      } catch(err) {firstError=err;}
      if(stale()) return;
      if(firstError) {
        try {
          const older=await request(`/backend-api/conversation/${encodeURIComponent(id)}`);
          if(stale()) return;apiPages++;
          const fallback=older?.mapping?normalizeTree(older):normalizeFlat(older?.messages || []);
          if(!fallback.length) throw new Error('旧接口未返回可解析的对话消息');
          complete=!!older?.mapping || older?.page_info?.has_previous_page===false;
          result=complete?fallback:mergeIndexSequences(result,fallback);
          publish(result,complete);
          if(!complete) throw new Error('备用接口亦未确认历史完整性');
        } catch(err) {
          publish(result,false);apiTruncated=true;
          throw new Error(`分页接口：${firstError.message}；备用接口：${err.message}`);
        }
      }
      if(stale()) return;
      publish(result,complete);apiStatus=complete?'历史目录已读取':'目录可能不完整';
      apiComplete=complete;apiTruncated=!complete;apiFailures=0;apiRetryAt=0;
      lastAPICheck=Date.now();update(true);
    };
    // Start on the next microtask so update() always sees apiPending set.
    apiPending=Promise.resolve().then(run).catch(err=>{
      if(stale()) return;
      apiStatus='历史读取暂不可用';apiError=String(err.message || err).slice(0,180);
      apiComplete=false;apiTruncated=true;apiFailures++;
      const delays=[3000,10000,30000];
      const unavailable=(String(err.message||err).match(/HTTP (?:404|410)/g)||[]).length>=2;
      if(unavailable){apiCooldownUntil=Date.now()+300000;apiRetryAt=0;}
      else apiRetryAt=apiFailures<=delays.length?Date.now()+delays[apiFailures-1]:0;
      update(true);
    }).finally(()=>{if(!stale()) {apiPending=null;if(apiController===controller) apiController=null;}});
    return apiPending;
  }
  window.chatgptTurnNavDebug = diagnose;

  // ===== src/app/update.js =====
  function isChatPage() { return CHAT_PATH.test(location.pathname); }
  function update(force = false) {
    runtimeMetrics.updates++;
    lifecycle?.flush();
    if (!host?.isConnected) document.body?.appendChild(host);
    currentURL=location.href;
    if (currentScope !== conversationScope()) {
      currentScope=conversationScope(); fetchGeneration++; jumpSerial++; seekingIndex = -1;
      apiController?.abort();apiController=null;
      navigation.cancel('conversation');geometry.reset();orderEvidence.reset();contentTracker.reset();
      liveTimeline=null;apiCooldownUntil=0;searchBodyMemo.clear();
      if(shadow){shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';shadow.getElementById('mdActions').hidden=true;}
      resumePoint=readingStore.load(conversationScope());readingTouched=false;lastReadingPoint=null;
      clearTimeout(readingTimer);syncReadingButton();
      resetExportState();
      indexCatalog=[];apiComplete=false;apiFailures=0;apiRetryAt=0;apiOutlineErrors=0;
      scanToken && (scanToken.cancelled=true);
      totalOrderCorrections=0;lastOrderCheck={mountedCompared:0,corrected:false,corrections:0};
      totalSpatialCorrections=0;lastSpatialCheck={observed:0,corrected:false,corrections:0};
      apiKey = ''; apiTurns = []; apiPending = null;
      apiStatus = '等待读取'; apiError = ''; apiPages = 0; apiTruncated=false;
      knownLabels.clear(); lastFingerprint = '';
      pinned = false; togglePanel(false);
      search.value = ''; lastSearch = '';
      returnPositions = []; updateReturnButton();
      mountedOnly = false; searchSelection = 0; filteredIndices = [];
      syncFilterButton();
      activeIndex = 0; activeSectionKey=''; navigationTargets=[]; answerCache.clear(); loadOutlineState(); hintUntil=0;
      clearTimeout(hintTimer);hintTimer=0;const hintEl=shadow?.getElementById('hint');if(hintEl)hintEl.hidden=true;
    }
    host.dataset.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const dom = detectTurns();
    const enabled = (isChatPage() || dom.length > 0) && innerWidth >= CONFIG.minViewportWidth && isVisible;
    host.dataset.disabled = enabled ? 'false' : 'true';
    if (!enabled) return;
    const previousActive=turns[activeIndex];
    turns = mergeTurns(dom).map(enrichTurn);
    if(previousActive) {
      const ids=new Set(turnIds(previousActive)), found=turns.findIndex(t=>turnIds(t).some(id=>ids.has(id)));
      if(found>=0) activeIndex=found;
    }
    for(const turn of turns) {
      try { captureExportDOM(turn); } catch (_) { /* Export capture must not block the navigator. */ }
    }
    indexCatalog=turns.map(metadataSnapshot);
    // Retain outlines, not detached DOM trees. The live turns array owns live nodes.
    for(const t of indexCatalog) if(t.answers.length) answerCache.set(t.key,t.answers);
    host.dataset.hidden = turns.length < 2 ? 'true' : 'false';
    counter.textContent = `${turns.length ? Math.min(activeIndex+1,turns.length) + ' / ' : ''}${turns.length} 轮`;
    const unmounted=turns.filter(t=>!t.node).length, mounted=turns.length-unmounted;
    syncFilterButton();
    // Routine indexing details are available in #coverage and diagnostics, not the footer.
    const fingerprint = (bodySearch&&lastSearch?String(exportContentRevision):'')+turns.map(t => `${t.key}:${t.label}:${t.role}:${!!t.node}:`+(t.answers||[]).map(a=>`${a.key}:${a.source}:`+a.headings.map(h=>`${h.level}:${h.text}:${!!h.node?.isConnected}`).join('|')).join('~')).join('\u0001');
    if (force || fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint; renderTicks();
      if (panel.classList.contains('open')) renderList();
    }
    updateActive();updateCoverage();syncReadingButton();
    if (chatId() && !apiPending && apiKey !== `${location.origin}:${chatId()}`) {
      // Read once per conversation, not on every DOM mutation.
      setTimeout(() => loadApiIndex(), 150);
    }
  }
  function scheduleUpdate() {
    // Throttle instead of trailing-only debounce: streaming never starves indexing.
    if(updateTimer) return;
    updateTimer=setTimeout(()=>{updateTimer=0;safeUpdate();},CONFIG.refreshDelayMs);
  }


  // ===== src/ui/outline-list.js =====
  function renderTicks() {
    track.querySelectorAll('.tick').forEach(el => el.remove());
    const count = turns.length;
    if (!count) return;
    const amount = Math.min(CONFIG.maxTicks, count);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < amount; i++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.top = `${amount === 1 ? 0 : i / (amount - 1) * 100}%`;
      fragment.appendChild(tick);
    }
    track.insertBefore(fragment, marker);
    track.setAttribute('aria-valuemax', String(count));
  }
  function appendMarkedText(container, source, needle) {
    if (!needle) { container.textContent = source; return; }
    const lower = source.toLocaleLowerCase(), term = needle.toLocaleLowerCase();
    let at = 0;
    while (at < source.length) {
      const pos = lower.indexOf(term, at);
      if (pos < 0) { container.append(document.createTextNode(source.slice(at))); break; }
      if (pos > at) container.append(document.createTextNode(source.slice(at,pos)));
      const mark = document.createElement('mark'); mark.textContent = source.slice(pos,pos+term.length);
      container.append(mark); at = pos+term.length;
    }
  }
  function renderList() {
    runtimeMetrics.renderedLists++;
    const oldScroll=list.scrollTop;
    const focusedId=shadow.activeElement?.dataset?.navId;
    const selectedId=navigationTargets[searchSelection]?.navId;
    const fragment=document.createDocumentFragment(),timeline=getTimeline();
    filteredIndices=[]; navigationTargets=[];
    let headingMatches=0;
    const addTarget=(button,target,navId)=>{
      button.dataset.navId=navId;
      button.dataset.navOrder=String(navigationTargets.length);
      navigationTargets.push({...target,navId});
    };
    turns.forEach((turn,idx)=>{
      const mounted=!!turn.node?.isConnected && !!timeline?.contains(turn.node);
      if(mountedOnly && !mounted) return;
      const turnMatch=!lastSearch || `${idx+1} ${turn.label}`.toLocaleLowerCase().includes(lastSearch);
      const answers=turn.answers||[];
      const matchHeading=h=>!lastSearch || h.text.toLocaleLowerCase().includes(lastSearch);
      const hasHeadingMatch=answers.some(a=>a.headings.some(matchHeading));
      const bodyText=bodySearch?cachedBodyText(turn):'';
      const bodyMatch=!!lastSearch&&bodySearch&&bodyText.toLocaleLowerCase().includes(lastSearch);
      if(lastSearch && !turnMatch && !hasHeadingMatch && !bodyMatch) return;
      filteredIndices.push(idx);
      const group=document.createElement('section'); group.className='turn-group';
      const b=document.createElement('button'); b.type='button';
      b.className=`item${idx===activeIndex?' active':''}`; b.dataset.idx=String(idx);
      b.dataset.navId=`turn:${turn.key}`;
      b.title=`${idx+1}. ${turn.label}\n${mounted?'页面已加载，可直接定位':'尚未加载，需要加载历史'}`;
      if(turn.role==='assistant') b.title+='\n定时任务/助手独立回复';
      b.setAttribute('aria-current',String(idx===activeIndex));
      const n=document.createElement('span'); n.className='num'; n.textContent=String(idx+1).padStart(3,'0');
      const label=document.createElement('span'); label.className='label'; appendMarkedText(label,turn.label,lastSearch);
      const dot=document.createElement('span');dot.className='dot'+(mounted?' mounted':'');dot.setAttribute('aria-label',mounted?'已加载':'尚未加载');
      b.append(n,dot,label); b.addEventListener('click',()=>jumpToIdentity(turn,true));
      const row=document.createElement('div');row.className='turn-top';
      const md=document.createElement('button');md.type='button';md.className='turn-export';md.textContent='MD▾';
      md.title='Markdown：复制 / 下载（Shift+点击直接复制）';
      md.setAttribute('aria-label',`导出第 ${idx+1} 轮 Markdown`);md.dataset.exportAction='turn';
      md.dataset.navId=`export:${turn.key}`;md.disabled=exportBusy;
      md.addEventListener('click',e=>{e.stopPropagation();if(e.shiftKey)exportMarkdown('turn',turn,null,'copy');else openMarkdownActions(e,'turn',turn);});
      row.append(b,md);group.append(row);
      if(turnMatch||bodyMatch) addTarget(b,{index:idx,target:null},`turn:${turn.key}`);
      if(bodyMatch){const snippet=document.createElement('div');snippet.className='body-snippet';
        const at=bodyText.toLocaleLowerCase().indexOf(lastSearch),start=Math.max(0,at-35);
        appendMarkedText(snippet,(start?'…':'')+bodyText.slice(start,start+155),lastSearch);
        snippet.title='命中已缓存正文；点击轮次可跳到该轮开头';group.append(snippet);}
      if(!answers.length) {
        const pending=document.createElement('div'); pending.className='toc-empty';
        pending.textContent=mounted?'尚未检测到回答内容':'回答目录将在内容读取后显示';group.append(pending);
      }
      answers.forEach((answer,ai)=>{
        const matching=new Set(answer.headings.filter(matchHeading).map(h=>h.index));
        const context=new Set(matching);
        for(const i of matching) {
          let p=answer.headings[i].parent;
          while(p>=0) {context.add(p);p=answer.headings[p].parent;}
        }
        if(lastSearch && !turnMatch && !matching.size) return;
        const isSearchOpen=!!lastSearch && (turnMatch||matching.size>0);
        const open=isSearchOpen || expandedAnswers.has(answer.key);
        const box=document.createElement('div');box.className='answer-outline';
        const head=document.createElement('div');head.className='toc-head';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='toc-toggle';
        toggle.dataset.navId=`toggle:${answer.key}`;toggle.setAttribute('aria-expanded',String(open));
        const glyph=document.createElement('span');glyph.className='chevron';glyph.textContent=open?'▾':'▸';glyph.setAttribute('aria-hidden','true');
        const title=document.createElement('span');title.textContent=`回答${answers.length>1?' '+(ai+1):''}目录`;
        const count=document.createElement('span');count.className='toc-count';
        count.textContent=answer.headings.length?`${answer.headings.length} 节${answer.source!=='dom'?' · 待加载':''}`:'无章节标题';
        toggle.append(glyph,title,count);
        toggle.addEventListener('click',()=>{
          if(isSearchOpen) {
            // Search expansion is temporary. Clearing it restores the saved fold states.
            search.value='';lastSearch='';searchSelection=0;
          }
          if(open) expandedAnswers.delete(answer.key); else expandedAnswers.add(answer.key);
          saveOutlineState();renderList();
        });
        const top=document.createElement('button');top.type='button';top.className='answer-top';top.textContent='↥';
        top.title='跳到这条回答的开头';top.setAttribute('aria-label','跳到回答开头');top.dataset.navId=`answer:${answer.key}`;
        top.addEventListener('click',()=>jumpToIdentity(turn,true,outlineTarget(answer,ai)));
        const amd=document.createElement('button');amd.type='button';amd.className='answer-top answer-export';amd.textContent='⋯';
        amd.title='仅此回答：复制 / 下载 Markdown';amd.setAttribute('aria-label','导出本回答 Markdown');
        amd.dataset.exportAction='answer';amd.dataset.navId=`export-answer:${answer.key}`;amd.disabled=exportBusy;
        amd.addEventListener('click',e=>{e.stopPropagation();openMarkdownActions(e,'answer',turn,exportUnique([answer.key,...answer.ids]));});
        head.append(toggle,top,amd);box.append(head);
        if(open) {
          const body=document.createElement('div');body.className='toc-body';
          if(!answer.headings.length) {
            const empty=document.createElement('div');empty.className='toc-empty';
            empty.textContent=answer.source==='dom'?'这条回答没有章节标题，可点 ↥ 跳到回答开头。':'尚无可用标题，加载回答后会重新识别。';body.append(empty);
          }
          answer.headings.forEach((h,hi)=>{
            if(lastSearch && !turnMatch && !context.has(hi)) return;
            if(!lastSearch) {
              let p=h.parent;
              while(p>=0) {if(foldedHeadings.has(answer.headings[p].key)) return;p=answer.headings[p].parent;}
            }
            const row=document.createElement('div');row.className='toc-row';row.style.paddingLeft=`${Math.min(h.depth,5)*12}px`;
            const hasChildren=answer.headings[hi+1]?.parent===hi;
            const fold=document.createElement(hasChildren?'button':'span');fold.className='toc-node-toggle';
            if(hasChildren) {
              fold.type='button';fold.textContent=foldedHeadings.has(h.key)&&!lastSearch?'▸':'▾';
              fold.setAttribute('aria-label',`${foldedHeadings.has(h.key)?'展开':'折叠'}“${h.text}”子章节`);
              fold.setAttribute('aria-expanded',String(!foldedHeadings.has(h.key)||!!lastSearch));fold.dataset.navId=`fold:${h.key}`;
              fold.addEventListener('click',()=>{
                const wasOpen=!foldedHeadings.has(h.key)||!!lastSearch;
                if(lastSearch){search.value='';lastSearch='';expandedAnswers.add(answer.key);}
                if(wasOpen) foldedHeadings.add(h.key);else foldedHeadings.delete(h.key);
                saveOutlineState();renderList();
              });
            } else fold.setAttribute('aria-hidden','true');
            const link=document.createElement('button');link.type='button';link.className='toc-link';
            link.dataset.section=h.key;link.dataset.navId=`heading:${h.key}`;
            const level=document.createElement('span');level.className='toc-level';level.textContent=`H${h.level}`;
            const text=document.createElement('span');text.className='toc-text';appendMarkedText(text,h.text,lastSearch);
            link.title=h.text+(h.node?.isConnected?'':'\n标题已索引，点击后尝试加载并精确定位');
            link.append(level,text);link.addEventListener('click',()=>jumpToIdentity(turn,true,outlineTarget(answer,ai,h)));
            if(!lastSearch || matchHeading(h)) {addTarget(link,{index:idx,target:outlineTarget(answer,ai,h)},`heading:${h.key}`);headingMatches++;}
            row.append(fold,link);body.append(row);
          });
          box.append(body);
        }
        group.append(box);
      });
      fragment.append(group);
    });
    if(!filteredIndices.length) {
      const empty=document.createElement('div');empty.className='empty';
      empty.textContent=mountedOnly?'没有已加载且匹配的轮次，可关闭「仅已加载」':'没有匹配的提问或章节标题';fragment.append(empty);
    }
    list.replaceChildren(fragment);list.scrollTop=oldScroll;
    if(focusedId) [...list.querySelectorAll('[data-nav-id]')].find(el=>el.dataset.navId===focusedId)?.focus({preventScroll:true});
    const previous=navigationTargets.findIndex(t=>t.navId===selectedId);
    if(previous>=0) searchSelection=previous;
    searchSelection=clamp(searchSelection,0,Math.max(0,navigationTargets.length-1));
    shadow.getElementById('searchMeta').textContent=`${mountedOnly?'仅已加载':'全部轮次'} · ${filteredIndices.length} / ${turns.length}${lastSearch?' · '+headingMatches+' 个章节匹配':''}`;
    updateCoverage();highlightSearchSelection(false);updateActiveSection();
  }
  function highlightSearchSelection(scroll=true) {
    list.querySelectorAll('.search-selected').forEach(el=>el.classList.remove('search-selected'));
    const el=list.querySelector(`[data-nav-order="${searchSelection}"]`);
    if(!el) return;
    if(shadow.activeElement===search) el.classList.add('search-selected');
    if(scroll) scrollWithinList(el);
  }
  function revealActiveItem() {
    if(!lastSearch && !mountedOnly) scrollWithinList(list.querySelector(`.item[data-idx="${activeIndex}"]`));
  }

  function indexFromPointer(event) {
    const rect = track.getBoundingClientRect();
    const portion = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
    return clamp(Math.round(portion * (turns.length - 1)), 0, Math.max(0, turns.length - 1));
  }
  function showPreview(event) {
    if (!turns.length || panel.classList.contains('open')) return;
    const index = indexFromPointer(event);
    preview.textContent = `${index + 1}. ${turns[index].label}`;
    preview.style.top = `${clamp(event.clientY - 20, 8, window.innerHeight - 100)}px`;
    preview.style.display = 'block';
  }
  function setActive(index) {
    if (!turns.length) return;
    activeIndex = clamp(index, 0, turns.length - 1);
    counter.textContent = `${activeIndex+1} / ${turns.length} 轮`;
    const frac = turns.length <= 1 ? 0 : activeIndex / (turns.length - 1);
    marker.style.top = `${frac * 100}%`;
    track.setAttribute('aria-valuenow', String(activeIndex + 1));
    track.setAttribute('aria-valuetext', turns[activeIndex].label);
    if (panel.classList.contains('open')) {
      list.querySelectorAll('.item.active').forEach(el => el.classList.remove('active'));
      const active = list.querySelector(`.item[data-idx="${activeIndex}"]`);
      active?.classList.add('active');
      list.querySelectorAll('.item[aria-current="true"]').forEach(el=>el.setAttribute('aria-current','false'));
      active?.setAttribute('aria-current','true');
    }
  }
  function updateActive() {
    if(!turns.length || seekingIndex>=0) return;
    const scroller=getTimeline();if(!scroller) return;
    const boundary=scroller.getBoundingClientRect().top+Math.min(120,scroller.clientHeight*.25);
    let before=-1,beforeTop=-Infinity,after=-1,afterTop=Infinity;
    for(let i=0;i<turns.length;i++) {
      const node=turns[i].node;if(!node?.isConnected || !scroller.contains(node)) continue;
      const rect=node.getBoundingClientRect();if(rect.height<1) continue;
      if(rect.top<=boundary && rect.top>beforeTop) {before=i;beforeTop=rect.top;}
      if(rect.top>boundary && rect.top<afterTop) {after=i;afterTop=rect.top;}
    }
    if(before>=0 || after>=0) setActive(before>=0?before:after);
    updateActiveSection();
  }


  // ===== src/navigation/actions.js =====
  function onScroll(event) {
    const timeline=getTimeline();
    // A directory or sidebar scroll is not a change to the reading position.
    if(event && event.target!==timeline && event.target!==document && event.target!==window)return;
    if(scrollRaf)return;
    scrollRaf=requestAnimationFrame(()=>{
      scrollRaf=0;if(!host||host.dataset.disabled==='true')return;
      updateActive();
      if(readingTouched&&!navigation.current){clearTimeout(readingTimer);readingTimer=setTimeout(saveReadingPosition,650);}
    });
  }

  async function scanToRepairOrder() {
    if(scanBusy&&scanToken&&navigation.owns(scanToken)) {
      navigation.cancel('stop');setHint('正在停止扫描并恢复扫描前的位置…',9000);return;
    }
    const scroller=getTimeline();
    if(!scroller||scroller.scrollHeight<=scroller.clientHeight){setHint('正文尚未加载或无需扫描。');return;}
    const token=navigation.begin('scan');scanToken=token;scanBusy=true;jumpSerial++;seekingIndex=-1;
    const initialTop=scroller.scrollTop,scope=conversationScope();
    scanLastSteps=0;scanLastSeen=0;
    const observed=new Set(),sequence=[],button=shadow.getElementById('rebuildOrder');
    button.textContent='停止扫描';button.disabled=false;
    const initialCorrections=totalOrderCorrections+totalSpatialCorrections;
    let position=scrollBounds(scroller).min,complete=false,error='',lastEpoch=geometry.epoch,lastIds=[];
    try {
      for(let n=0;n<400;n++) {
        if(!navigation.live(token)||!scroller.isConnected)break;
        const bounds=scrollBounds(scroller),at=clamp(position,bounds.min,bounds.max);
        if(!navigation.write(token,scroller,at))break;
        await new Promise(r=>setTimeout(r,160));
        if(!navigation.live(token))break;
        safeUpdate(false);
        const dom=detectTurns(),ids=dom.map(t=>t.key);
        const overlap=ids.some(id=>lastIds.includes(id));
        const newIds=ids.filter(id=>!observed.has(id));
        ids.forEach(id=>observed.add(id));
        // An uninterrupted, overlapping traversal supplies extra chronology
        // even when each viewport contains just one very tall answer.
        if(newIds.length) {
          if(sequence.length && geometry.epoch!==lastEpoch && !overlap)sequence.length=0;
          if(geometry.sign<0)sequence.unshift(...newIds);else sequence.push(...newIds);
          orderEvidence.sequence(sequence,2);
        }
        lastEpoch=geometry.epoch;lastIds=ids;
        scanLastSteps=n+1;scanLastSeen=observed.size;
        if(n%3===0)setHint(`正在扫描 ${Math.round((at-bounds.min)/Math.max(1,bounds.max-bounds.min)*100)}% · ${observed.size} 轮 · 可点“停止扫描”`,12000);
        if(at>=bounds.max-2){complete=true;break;}
        position=at+Math.max(160,Math.floor(scroller.clientHeight*.68));
      }
    } catch(e){error=String(e?.message||e).slice(0,140);}
    finally {
      const owns=navigation.owns(token),canRestore=owns&&(!token.cancelled||token.reason==='stop');
      if(canRestore&&scroller.isConnected) {
        navigation.write(token,scroller,initialTop,token.reason==='stop');
        await new Promise(r=>setTimeout(r,100));
        if(navigation.owns(token))safeUpdate(false);
      }
      if(scanToken===token){scanToken=null;scanBusy=false;button.textContent='↕ 扫描校正排序';}
      if(navigation.owns(token)) {
        const corrections=totalOrderCorrections+totalSpatialCorrections-initialCorrections;
        setHint(error?`扫描中断：${error}`:
          `${token.cancelled?'扫描已停止':complete?'当前正文扫描完成':'扫描达到步数上限'} · ${scanLastSeen} 轮 / ${scanLastSteps} 个位置 · 校正 ${corrections} 次。${canRestore?'已尝试恢复扫描前位置。':'保留你的新位置。'}扫描不代表已确认全部历史。`,12000);
        navigation.finish(token);updateCoverage();
      }
    }
  }

  function scrollBounds(scroller) {
    const overflow = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const reversed = getComputedStyle(scroller).flexDirection === 'column-reverse';
    return {min: reversed ? -overflow : 0, max: reversed ? 0 : overflow, reversed};
  }
  function scrollWithinTimeline(node,smooth=false,token=navigation.current,offset=0) {
    const scroller=getTimeline();if(!scroller||!node?.isConnected||!scroller.contains(node))return false;
    const r=node.getBoundingClientRect(),box=scroller.getBoundingClientRect();if(r.height<1)return false;
    return navigation.write(token,scroller,scroller.scrollTop+r.top-box.top-26+offset);
  }

  function findMountedTurn(turn) {
    const timeline = getTimeline();
    if (!timeline) return null;
    if (turn.node?.isConnected && timeline.contains(turn.node)) return turn.node;
    // The archived real page uses the user message ID as the data-turn-key.
    const ids = (turn.ids?.length ? turn.ids : [turn.id || turn.key]).filter(Boolean);
    if (!ids.length) return null;
    for (const n of timeline.querySelectorAll('[data-turn-key]'))
      if (ids.includes(n.getAttribute('data-turn-key'))) return n;
    for (const n of timeline.querySelectorAll('[data-chatgpt-search-message-ids]'))
      if ((n.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/).some(id=>ids.includes(id)))
        return n.closest('[data-turn-key]') || n;
    return null;
  }
  function updateReturnButton() {
    const button = shadow?.getElementById('returnPos');
    if (button) button.disabled = !returnPositions.length;
  }
  function rememberPosition(scroller) {
    if(!scroller)return;
    const point=captureReadingPoint(),previous=returnPositions.at(-1);
    if(!previous||previous.route!==location.pathname||Math.abs(previous.top-scroller.scrollTop)>12) {
      returnPositions.push({route:location.pathname,top:scroller.scrollTop,point});
      if(returnPositions.length>12)returnPositions.shift();
    }
    updateReturnButton();
  }

  function returnToPreviousPosition() {
    let previous;
    while(returnPositions.length){const p=returnPositions.pop();if(p.route===location.pathname){previous=p;break;}}
    updateReturnButton();if(!previous)return;
    if(previous.point){restoreReadingPoint(previous.point,false);return;}
    const scroller=getTimeline();if(!scroller)return;
    const token=navigation.begin('return');jumpSerial++;seekingIndex=-1;
    navigation.write(token,scroller,previous.top);navigation.finish(token);
    setHint('已返回上一次正文位置。');requestAnimationFrame(updateActive);
  }

  async function jumpTo(index,highlight=true,target=null,options={}) {
    const initial=options.turn||turns[index];if(!initial)return false;
    const scroller=getTimeline();if(!scroller){setHint('正文尚未加载，暂时无法定位。');return false;}
    const wantedIds=turnIds(initial);
    if(options.record!==false)rememberPosition(scroller);
    const token=navigation.begin(options.reading?'resume':'jump');jumpSerial++;seekingIndex=Math.max(0,index);
    const caption=options.reading?'上次阅读位置':target?.kind==='heading'?`章节“${target.text}”`:target?'回答':'目标轮次';
    const diagnosticTarget=options.reading?'恢复阅读':target?.kind==='heading'?'章节':target?'回答':'轮次';
    const getTurn=()=>turns.find(t=>turnIds(t).some(id=>wantedIds.includes(id)))||initial;
    const resolve=()=>options.reading?resolveReadingNode(getTurn(),options.reading):resolveOutlineNode(getTurn(),target);
    const tried=new Set();let center=null,step=0,successful=false;
    try {
      for(let attempt=0;attempt<22;attempt++) {
        if(!navigation.live(token)||!scroller.isConnected)return false;
        safeUpdate(false);
        const node=resolve();
        if(node&&scrollWithinTimeline(node,false,token,options.reading?.offset||0)) {
          if(highlight){const outline=node.style.outline,offset=node.style.outlineOffset;
            node.style.outline='2px solid #52d4aa';node.style.outlineOffset='3px';
            setTimeout(()=>{if(node.isConnected){node.style.outline=outline;node.style.outlineOffset=offset;}},1400);}
          const now=turns.findIndex(t=>turnIds(t).some(id=>wantedIds.includes(id)));
          if(now>=0)setActive(now);
          lastJump=`${diagnosticTarget}：精确匹配`;setHint(`已按消息身份精确定位${caption}（仅正文）。`);
          successful=true;readingTouched=true;return true;
        }
        const bounds=scrollBounds(scroller),turn=getTurn(),point=geometry.get(turn,turnIds)||geometry.get(turn,turnIds,false);
        const knownShell=findMountedTurn(turn);
        if(center===null) {
          center=options.reading?.top??(point?point.top-26:null);
          if(center===null) {
            const now=turns.findIndex(t=>turnIds(t).some(id=>wantedIds.includes(id)));
            const anchors=turns.map((t,i)=>({i,p:geometry.get(t,turnIds)})).filter(x=>x.p);
            const lower=anchors.filter(x=>x.i<now).at(-1),upper=anchors.find(x=>x.i>now);
            if(lower&&upper)center=lower.p.top+(upper.p.top-lower.p.top)*(now-lower.i)/(upper.i-lower.i);
            else if(lower)center=lower.p.top+geometry.sign*scroller.clientHeight*.7;
            else if(upper)center=upper.p.top-geometry.sign*scroller.clientHeight*.7;
            else center=bounds.min+(now<0?.5:now/Math.max(1,turns.length-1))*(bounds.max-bounds.min);
          }
          center=clamp(center,bounds.min,bounds.max);
        }
        let destination;
        if(knownShell) {
          // The right message has mounted, but a requested heading may still be
          // streaming. Wait here rather than bouncing to another turn.
          const r=knownShell.getBoundingClientRect(),box=scroller.getBoundingClientRect();
          destination=scroller.scrollTop+r.top-box.top-26;
        } else if(attempt<3) destination=center;
        else {
          // Local expansion is bounded and never repeatedly alternates endpoints.
          let found=false;
          while(step<60&&!found) {
            step++;const radius=Math.ceil(step/2)*scroller.clientHeight*.72;
            destination=clamp(center+(step%2?radius:-radius),bounds.min,bounds.max);
            const k=Math.round(destination/8);if(!tried.has(k)){tried.add(k);found=true;}
          }
          if(!found)break;
        }
        navigation.write(token,scroller,destination);
        lastJump=`${diagnosticTarget}：等待挂载（${attempt+1}/22）`;
        setHint(`正在查找${caption} · ${attempt+1}/22；滚轮、触摸或点击其他轮次可停止。`,1500);
        await new Promise(r=>setTimeout(r,attempt<3?220:170));
      }
      if(navigation.live(token)){lastJump=`${diagnosticTarget}：尚未匹配`;setHint('未取得目标正文或章节已变化。未报告跳转成功；可在设置中扫描补齐位置后重试。',9000);}
      return false;
    } finally {
      if(navigation.owns(token)){seekingIndex=-1;navigation.finish(token);requestAnimationFrame(updateActive);if(successful)setTimeout(saveReadingPosition,120);}
    }
  }

  function loadEarlier() {
    const scroller=getTimeline();if(!scroller){setHint('正文尚未加载。');return;}
    rememberPosition(scroller);const token=navigation.begin('earlier');jumpSerial++;seekingIndex=-1;
    navigation.write(token,scroller,scrollBounds(scroller).min);navigation.finish(token);
    setHint('已滚动到正文起点；更早历史可能仍需页面继续加载。');setTimeout(scheduleUpdate,600);
  }


  // ===== src/app/enhancements.js =====
  function jumpToIdentity(turn,highlight=true,target=null) {
    const ids=turnIds(turn),index=turns.findIndex(t=>turnIds(t).some(id=>ids.includes(id)));
    return jumpTo(index,highlight,target,{turn:index>=0?turns[index]:turn});
  }
  function userNavigationIntent() {
    readingTouched=true;cancelSeek();
    clearTimeout(readingTimer);readingTimer=setTimeout(saveReadingPosition,800);
  }
  function captureReadingPoint() {
    const scroller=getTimeline();if(!scroller)return null;
    updateActive();const turn=turns[activeIndex];if(!turn?.node?.isConnected)return null;
    const ids=turnIds(turn).filter(id=>!/^local-\d+$/.test(id));if(!ids.length)return null;
    const box=scroller.getBoundingClientRect(),limit=box.top+Math.min(120,scroller.clientHeight*.25);
    let anchor=turn.node,answerIdsSaved=[],headingHash='',best=-Infinity;
    for(const answer of turn.answers||[]) for(const heading of answer.headings||[]) {
      const node=heading.node;if(!node?.isConnected)continue;
      const r=node.getBoundingClientRect();
      if(r.height>0&&r.top<=limit&&r.top>best){anchor=node;best=r.top;answerIdsSaved=answer.ids||[];
        headingHash=readingStore.hash(`${heading.level}\0${heading.text}\0${heading.occurrence||0}`);}
    }
    return {ids,answerIds:answerIdsSaved,headingHash,offset:box.top+26-anchor.getBoundingClientRect().top,
      top:scroller.scrollTop,width:Math.round(scroller.getBoundingClientRect().width),
      direction:getComputedStyle(scroller).flexDirection};
  }
  function resolveReadingNode(turn,point) {
    const shell=findMountedTurn(turn);if(!shell)return null;
    if(!point.headingHash)return shell;
    const answers=getDOMAnswers({...turn,node:shell});
    for(const a of answers) {
      if(point.answerIds?.length&&!a.ids.some(id=>point.answerIds.includes(id)))continue;
      const h=a.headings.find(h=>readingStore.hash(`${h.level}\0${h.text}\0${h.occurrence||0}`)===point.headingHash);
      if(h?.node)return h.node;
    }
    return null;
  }
  function saveReadingPosition() {
    if(!readingTouched || navigation.current || currentScope!==conversationScope())return;
    const point=captureReadingPoint();if(!point)return;
    readingStore.save(currentScope,point);lastReadingPoint=point;
    // Keep the entry-time resume target stable until the user deliberately resumes.
    if(!resumePoint)resumePoint=point;
    syncReadingButton();
  }
  function syncReadingButton() {
    const b=shadow?.getElementById('resumeReading');if(b)b.disabled=!resumePoint;
  }
  function restoreReadingPoint(point,record=true) {
    if(!point?.ids?.length){setHint('没有可恢复的阅读位置。');return;}
    const index=turns.findIndex(t=>turnIds(t).some(id=>point.ids.includes(id)));
    const turn=index>=0?turns[index]:{key:point.ids[0],id:point.ids[0],ids:point.ids,node:null,answers:[]};
    return jumpTo(index,true,null,{turn,record,reading:point});
  }
  function cachedBodyText(turn) {
    const memo=searchBodyMemo.get(turn.key);
    if(memo?.revision===exportContentRevision)return memo.text;
    const snapshot=exportFindSnapshot(turn),parts=[],used=new Set();
    const messages=turnIds(turn).map(id=>exportAPI.get(id)).filter(Boolean);
    for(const m of messages)if(m.markdown){parts.push(m.markdown);used.add(m.id);}
    if(snapshot?.question?.markdown&&!messages.some(m=>m.role==='user'))parts.push(snapshot.question.markdown);
    for(const a of snapshot?.answers||[])if(!a.ids.some(id=>used.has(id)))parts.push(a.markdown);
    const text=parts.join('\n\n');searchBodyMemo.set(turn.key,{revision:exportContentRevision,text});
    return text;
  }
  function updateCoverage() {
    if(!shadow)return;
    const mounted=turns.filter(t=>t.node?.isConnected).length;
    const bodies=turns.filter(t=>!!cachedBodyText(t)).length;
    const positions=turns.filter(t=>geometry.get(t,turnIds)).length;
    const el=shadow.getElementById('coverage');if(!el)return;
    el.textContent=`索引 ${turns.length} · 挂载 ${mounted} · 正文 ${bodies}/${turns.length} · ${apiComplete?'历史已确认':'历史未确认'}`;
    el.title=`有效位置 ${positions}/${turns.length}。正文数量指至少取得部分正文，不保证每轮完整；正文搜索只覆盖缓存，不会自动扫描。`;
  }
  function openMarkdownActions(event,kind,turn,selection=null) {
    pinPanelOpen();const menu=shadow.getElementById('mdActions');menu.replaceChildren();
    const identity=metadataSnapshot(turn);
    for(const [label,delivery] of [['⧉ 复制 Markdown','copy'],['↓ 下载 Markdown','download']]) {
      const b=document.createElement('button');b.type='button';b.role='menuitem';b.textContent=label;
      b.disabled=exportBusy;b.dataset.exportAction=kind;
      b.addEventListener('click',()=>{menu.hidden=true;exportMarkdown(kind,identity,selection,delivery);});menu.append(b);
    }
    const r=event.currentTarget.getBoundingClientRect();menu.style.left=`${clamp(r.right-200,8,innerWidth-208)}px`;
    menu.style.top=`${clamp(r.bottom+3,8,innerHeight-100)}px`;menu.hidden=false;menu.querySelector('button')?.focus({preventScroll:true});
  }
  async function copyMarkdownText(text) {
    try {
      if(typeof navigator.clipboard?.writeText!=='function')throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);return true;
    } catch {
      const dialog=shadow.getElementById('copyFallback'),input=shadow.getElementById('copyText');
      input.value=text;dialog.hidden=false;input.focus({preventScroll:true});input.select();return false;
    }
  }
  function initializeEnhancements() {
    shadow.getElementById('searchScope').addEventListener('change',e=>{bodySearch=e.target.value==='body';searchSelection=0;renderList();});
    shadow.getElementById('copyCurrent').addEventListener('click',()=>exportMarkdown('turn',turns[activeIndex],null,'copy'));
    shadow.getElementById('resumeReading').addEventListener('click',()=>restoreReadingPoint(resumePoint));
    shadow.getElementById('clearReading').addEventListener('click',()=>{
      readingStore.clear(conversationScope());resumePoint=null;lastReadingPoint=null;readingTouched=false;clearTimeout(readingTimer);
      syncReadingButton();setHint('已清除本对话阅读记录。只有之后再次阅读才会重新记录。');
    });
    shadow.getElementById('copyClose').addEventListener('click',()=>{shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';});
    shadow.getElementById('copyText').addEventListener('click',e=>e.target.select());
    shadow.getElementById('copyRetry').addEventListener('click',async()=>{
      const text=shadow.getElementById('copyText').value;
      if(await copyMarkdownText(text)){shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';setHint('Markdown 已复制。');}
    });
    document.addEventListener('pointerdown',e=>{
      const menu=shadow.getElementById('mdActions');if(!e.composedPath().includes(menu))menu.hidden=true;
    },true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveReadingPosition();});
    syncReadingButton();
  }


  // ===== src/app/lifecycle.js =====
  function safeUpdate(force=false) {
    try {update(force);}catch(error){runtimeMetrics.errors++;console.warn('[Turn Navigator] update failed:',error);setHint('目录更新遇到错误，将在页面继续加载后重试。');}
  }
  function startLifecycle() {
    let observed=null,stopped=false,interval;
    const sizes=new WeakMap(),measured=new Set();
    const resize=new ResizeObserver(entries=>{
      let changed=false;
      for(const e of entries){if(!e.target.isConnected||!observed?.contains(e.target)&&e.target!==observed){resize.unobserve(e.target);measured.delete(e.target);continue;}const size=[Math.round(e.contentRect.width),Math.round(e.contentRect.height)].join(':');
        const old=sizes.get(e.target);sizes.set(e.target,size);if(old&&old!==size)changed=true;}
      if(changed){geometry.invalidate('resize observer');scheduleUpdate();}
    });
    function relevant(records) {
      let changed=false;if(records.length)contentTracker.batch();
      for(const r of records) {
        const el=r.target.nodeType===1?r.target:r.target.parentElement;
        if(!el||el===host||el.closest?.('[data-app-action-sidebar-scroll],button,svg,[role="menu"]'))continue;
        if(r.type==='attributes'&&r.attributeName==='class'&&!el.matches?.(SHELL_SELECTOR+','+BODY_SELECTOR+','+USER_SELECTOR))continue;
        contentTracker.touch(el,observed);changed=true;
        if((r.type==='characterData'||r.type==='childList')&&el.closest?.(BODY_SELECTOR+','+USER_SELECTOR))geometry.invalidate('message content');
      }
      return changed;
    }
    const bodyObserver=new MutationObserver(records=>{if(relevant(records))scheduleUpdate();});
    function attach() {
      const next=getTimeline();if(next===observed)return false;
      bodyObserver.disconnect();resize.disconnect();measured.clear();observed=next;
      if(next) {
        bodyObserver.observe(next,{childList:true,subtree:true,characterData:true,attributes:true,
          attributeFilter:['data-turn','data-role','data-turn-key','data-user-message-bubble','data-message-author-role',
            'data-testid','class','data-is-streaming','data-message-status','data-talvt-turn-state','data-response-body','data-chatgpt-search-message-ids']});
        resize.observe(next);
      }
      geometry.invalidate('timeline replaced');return true;
    }
    const rootObserver=new MutationObserver(records=>{
      const changed=attach();
      if(changed||records.some(r=>!observed?.contains(r.target)&&r.target!==host&&!host?.contains(r.target)&&
        !(r.target.nodeType===1?r.target:r.target.parentElement)?.closest?.('[data-app-action-sidebar-scroll]')))scheduleUpdate();
    });
    rootObserver.observe(document.documentElement,{childList:true,subtree:true});attach();
    interval=setInterval(()=>{
      if(stopped)return;
      if(location.href!==currentURL||attach())scheduleUpdate();
      if(!document.hidden&&!apiPending&&apiRetryAt&&Date.now()>=apiRetryAt)loadApiIndex();
    },1200);
    return {
      flush(){if(stopped)return;rootObserver.takeRecords();attach();relevant(bodyObserver.takeRecords());
        for(const t of measured)if(!t.isConnected||!observed?.contains(t)){resize.unobserve(t);measured.delete(t);}
        for(const t of getTimeline()?.querySelectorAll('[data-measured-turn]')||[])if(!measured.has(t)){measured.add(t);resize.observe(t);}},
      stop(){stopped=true;rootObserver.disconnect();bodyObserver.disconnect();resize.disconnect();clearInterval(interval);clearTimeout(updateTimer);updateTimer=0;}
    };
  }

  function bootstrap() {
    loadOutlineState();resumePoint=readingStore.load(conversationScope());initUI();
    // Establish recovery BEFORE the first update. Missing containers are normal.
    lifecycle=startLifecycle();safeUpdate(true);
    window.addEventListener('pagehide',()=>{saveReadingPosition();navigation.cancel('pagehide');lifecycle?.stop();});
    window.addEventListener('pageshow',e=>{if(e.persisted){lifecycle=startLifecycle();safeUpdate(true);}});
  }


  // ===== src/app/entry.js =====
  if (document.body) bootstrap();
  else document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
})();
