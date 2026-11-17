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
