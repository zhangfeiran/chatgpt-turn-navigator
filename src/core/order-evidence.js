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

