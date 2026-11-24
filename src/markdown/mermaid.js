  // Mermaid preview widgets are not ordinary code blocks. Prefer their source;
  // a rendered SVG is only sufficient for a deliberately limited reconstruction.
  const MERMAID_PREVIEW_SELECTOR='[data-chatgpt-mermaid-preview],[data-code-block-preview-pane="mermaid"]';
  function isExportMermaidWidget(node) {
    return node.matches(MERMAID_PREVIEW_SELECTOR) ||
      (node.matches('[data-client-defined-widget="code_block"],[data-chatgpt-copy-code],[data-code-block],[data-markdown-copy="code-block"]') && !!node.querySelector(MERMAID_PREVIEW_SELECTOR));
  }
  function exportMermaidSource(value) {
    if(typeof value!=='string' || value.length>1000000) return null;
    const fenced=value.match(/^\s*(`{3,}|~{3,})mermaid[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*\s*$/i);
    const source=fenced?fenced[2]:value;
    // Validate the first diagram directive, without changing the original text.
    const start=source.trim().replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/,'')
      .replace(/^(?:\s*%%\{[\s\S]*?\}%%|\s*%%[^\r\n]*(?:\r?\n|$))+/,'').trimStart();
    return /^(?:flowchart(?:-elk)?|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|xychart(?:-beta)?|block(?:-beta)?|packet(?:-beta)?|architecture-beta|kanban|sankey-beta|treemap-beta|radar-beta|zenuml|info)(?=\s|$)/i.test(start)?source:null;
  }
  function findExportMermaidSource(root) {
    const attrs=['data-chatgpt-copy-code','data-mermaid-source','data-diagram-source','data-code-block-source'];
    const fields=[root,...root.querySelectorAll(attrs.map(a=>'['+a+']').join(','))];
    for(const el of fields) for(const name of attrs) {
      const source=exportMermaidSource(el.getAttribute(name));if(source!==null)return source;
    }
    for(const el of root.querySelectorAll('[data-code-block-source],pre,textarea')) {
      if(el.closest('.cm-editor,.monaco-editor,.view-lines,[data-markdown-copy="exclude"]') || el.querySelector('.cm-editor,.monaco-editor,.view-lines'))continue;
      const source=exportMermaidSource(el.tagName==='TEXTAREA'?el.value:exportCodeText(el));if(source!==null)return source;
    }
    // Best-effort, read-only access to this widget's local React props. Do not
    // traverse application state, callbacks, other messages, or network data.
    const keys=['code','source','sourceCode','codeText','rawCode','rawSource','mermaid','mermaidCode','diagram','definition','text','value','content','children'];
    const nested=['props','data','widget','payload','attributes','args','codeBlock','block','node'];
    const own=(obj,key)=>{try{return Object.getOwnPropertyDescriptor(obj,key)?.value;}catch(_){return undefined;}};
    const candidates=new Set(),seen=new WeakSet();let budget=96;
    function inspect(obj,depth) {
      if(!obj || typeof obj!=='object' || seen.has(obj) || budget--<=0)return;
      seen.add(obj);
      for(const k of keys) {const v=own(obj,k),s=exportMermaidSource(v);if(s!==null)candidates.add(s);}
      if(depth>0)for(const k of nested)inspect(own(obj,k),depth-1);
    }
    try {
      const seeds=[root,...root.querySelectorAll(MERMAID_PREVIEW_SELECTOR),...root.querySelectorAll('svg[aria-label="Mermaid diagram"]')].slice(0,12);
      for(const node of seeds) {
        for(const k of Object.getOwnPropertyNames(node)) {
          if(k.startsWith('__reactProps$'))inspect(own(node,k),2);
          if(!k.startsWith('__reactFiber$'))continue;
          let f=own(node,k);
          for(let i=0;f&&i<24;i++,f=own(f,'return')) {
            const host=own(f,'stateNode');
            if(host?.nodeType===1 && host!==root && !root.contains(host))break;
            inspect(own(f,'memoizedProps'),2);
          }
        }
      }
    } catch(_) { /* React internals are optional and may be unavailable. */ }
    // Conflicting possible sources are not authoritative.
    return candidates.size===1?[...candidates][0]:null;
  }
  function rebuildExportMermaidFlowchart(root) {
    const svg=root.querySelector('svg[aria-roledescription^="flowchart"],svg.flowchart');
    if(!svg || !svg.id || svg.querySelector('.cluster,.subgraphs > *'))return null;
    const nodes=new Map(),prefix=svg.id+'-flowchart-',elements=[...svg.querySelectorAll('g.node')];
    if(!elements.length||elements.length>250)return null;
    for(const el of elements) {
      const id=el.id.startsWith(prefix)?el.id.slice(prefix.length).replace(/-\d+$/,''):'';
      const shape=[...el.children].find(n=>n.matches('rect.label-container'));
      const labelNode=el.querySelector('.label text,.nodeLabel');
      const label=labelNode?.textContent?.trim();
      const xy=(el.getAttribute('transform')||'').match(/^translate\(\s*(-?[\d.eE+]+)\s*[, ]\s*(-?[\d.eE+]+)\s*\)$/);
      // Only reconstruct simple rectangular nodes and single-line literal labels.
      if(!/^[A-Za-z_][\w-]*$/.test(id)||/^(?:end|graph|flowchart|subgraph|class|style|click|direction)$/i.test(id)||nodes.has(id)||!shape||!label||/["<>#&\r\n]/.test(label)||!xy||labelNode.querySelectorAll('.row').length>1||labelNode.querySelector('br'))return null;
      const x=Number(xy[1]),y=Number(xy[2]);if(!Number.isFinite(x)||!Number.isFinite(y))return null;
      nodes.set(id,{label,x,y});
    }
    const paths=[...svg.querySelectorAll('path[data-edge="true"].flowchart-link')];
    if(!paths.length||paths.length>1000||svg.querySelectorAll('path.flowchart-link').length!==paths.length)return null;
    const edgeLabels=new Map();
    for(const el of svg.querySelectorAll('.edgeLabel [data-id]'))edgeLabels.set(el.getAttribute('data-id'),el.textContent.trim());
    const edges=[],votes={LR:0,RL:0,TD:0,BT:0};
    for(const p of paths) {
      const key=p.getAttribute('data-id')||'';
      if(!key.startsWith('L_')||!/_\d+$/.test(key)||p.hasAttribute('marker-start')||!/-pointEnd\)$/.test(p.getAttribute('marker-end')||'')||!p.classList.contains('edge-pattern-solid')||p.classList.contains('edge-thickness-thick')||edgeLabels.get(key))return null;
      const pair=key.slice(2).replace(/_\d+$/,'');
      const matches=[];
      for(const a of nodes.keys())if(pair.startsWith(a+'_')&&nodes.has(pair.slice(a.length+1)))matches.push([a,pair.slice(a.length+1)]);
      if(matches.length!==1)return null;
      const [a,b]=matches[0],u=nodes.get(a),v=nodes.get(b),dx=v.x-u.x,dy=v.y-u.y;
      if(Math.abs(dx)+Math.abs(dy)>0)votes[Math.abs(dx)>Math.abs(dy)?(dx>0?'LR':'RL'):(dy>0?'TD':'BT')]++;
      edges.push([a,b]);
    }
    const dir=Object.keys(votes).sort((a,b)=>votes[b]-votes[a])[0];
    if(!votes[dir])return null;
    const used=new Set(),lines=['flowchart '+dir];
    const ref=id=>{if(used.has(id))return id;used.add(id);return id+'["'+nodes.get(id).label+'"]';};
    for(const [a,b] of edges)lines.push('    '+ref(a)+' --> '+ref(b));
    for(const id of nodes.keys())if(!used.has(id))lines.push('    '+ref(id));
    return lines.join('\n');
  }
  function exportMermaidWidget(root) {
    const source=findExportMermaidSource(root);
    if(source!==null)return {markdown:exportFence(source,'mermaid'),incomplete:false,notes:[]};
    const rebuilt=rebuildExportMermaidFlowchart(root);
    if(rebuilt!==null)return {markdown:'> [Mermaid：原始源码未取得，以下由页面 SVG 重建节点和连线，布局和样式可能不同。]\n\n'+exportFence(rebuilt,'mermaid'),incomplete:true,notes:['部分 Mermaid 图由 SVG 重建，不是原始源码。']};
    return {markdown:'> [Mermaid 源码未取得；若原对话提供源码视图，请切换后重新导出。]',incomplete:true,notes:['部分 Mermaid 源码未取得；不将图形标签或 SVG 样式冒充源码。']};
  }
