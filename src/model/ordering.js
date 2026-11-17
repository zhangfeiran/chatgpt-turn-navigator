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
