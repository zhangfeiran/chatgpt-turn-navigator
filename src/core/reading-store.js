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

