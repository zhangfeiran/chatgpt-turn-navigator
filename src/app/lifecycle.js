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
            'data-testid','class','data-is-streaming','data-message-status','data-talvt-turn-state','data-response-body','data-chatgpt-search-message-ids',
            'data-chatgpt-copy-code','data-code-block','data-markdown-copy','data-code-language','data-language','data-lang']});
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

