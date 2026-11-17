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
