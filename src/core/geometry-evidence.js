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

