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

