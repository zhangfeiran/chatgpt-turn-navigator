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
