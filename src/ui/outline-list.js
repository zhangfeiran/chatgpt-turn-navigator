  // The compact rail cannot assume that a virtualized DOM represents every
  // turn. Use physical scroll progress until history is confirmed.
  let railTickFingerprint='';
  function railMetrics(scroller=getTimeline()) {
    const bounds=scroller?scrollBounds(scroller):{min:0,max:0,reversed:false};
    const span=Math.max(0,bounds.max-bounds.min);
    const mode=apiComplete&&turns.length>=2?'turns':'scroll';
    const fraction=span>1?clamp((scroller.scrollTop-bounds.min)/span,0,1):0;
    return {scroller,bounds,span,mode,fraction,visible:!!scroller&&span>1};
  }
  function updateRailProgress(metrics=railMetrics()) {
    if(!host||!track||!marker)return;
    const {mode,fraction,visible}=metrics;
    host.dataset.hidden=visible?'false':'true';
    rail.dataset.mode=mode;
    if(!visible){preview.style.display='none';marker.style.top='0%';}
    const complete=mode==='turns';
    const value=complete?clamp(activeIndex+1,1,turns.length):Math.round(fraction*100);
    const display=complete?(turns.length<2?0:(value-1)/(turns.length-1)):fraction;
    marker.style.top=(visible?display*100:0)+'%';
    track.setAttribute('aria-valuemin',complete?'1':'0');
    track.setAttribute('aria-valuemax',complete?String(turns.length):'100');
    track.setAttribute('aria-valuenow',String(value));
    track.setAttribute('aria-label',complete?'按轮次跳转对话':'正文滚动进度（历史未确认时按实际位置导航）');
    track.setAttribute('aria-valuetext',complete?(turns[value-1]?.label||'第 '+value+' 轮'):'正文 '+value+'%（不代表完整轮次）');
    track.title=complete?'已确认历史：按轮次定位':'按实际滚动位置定位；历史轮次可能尚未加载';
  }
  function renderTicks() {
    const metrics=railMetrics(),count=turns.length;
    let positions=[];
    if(metrics.visible && metrics.mode==='turns'){
      const amount=Math.min(CONFIG.maxTicks,count);
      positions=Array.from({length:amount},(_,i)=>amount===1?0:i/(amount-1));
    } else if(metrics.visible) {
      // Only show physically measured, current-layout turn anchors; never
      // distribute a partial index evenly across the entire document.
      const inset=timelineJumpInset(metrics.scroller);
      const points=turns.map(t=>geometry.get(t,turnIds)).filter(p=>p&&Number.isFinite(p.top));
      positions=[...new Set(points.map(p=>Math.round(clamp((p.top-inset-metrics.bounds.min)/metrics.span,0,1)*10000)/10000))].sort((a,b)=>a-b);
      if(positions.length>CONFIG.maxTicks)positions=Array.from({length:CONFIG.maxTicks},(_,i)=>positions[Math.round(i*(positions.length-1)/(CONFIG.maxTicks-1))]);
    }
    const key=metrics.mode+'|'+metrics.visible+'|'+positions.join(',');
    if(key!==railTickFingerprint){
      railTickFingerprint=key;
      track.querySelectorAll('.tick').forEach(el=>el.remove());
      const fragment=document.createDocumentFragment();
      for(const position of positions){
        const tick=document.createElement('div');tick.className='tick';
        tick.style.top=(position*100)+'%';fragment.appendChild(tick);
      }
      track.insertBefore(fragment,marker);
    }
    updateRailProgress(metrics);
  }
  function pointerRailFraction(event) {
    const rect=track.getBoundingClientRect();
    return clamp((event.clientY-rect.top)/Math.max(rect.height,1),0,1);
  }
  function jumpRailPosition(fraction) {
    const metrics=railMetrics();
    if(!metrics.visible)return;
    if(metrics.mode==='turns'){
      jumpTo(clamp(Math.round(fraction*(turns.length-1)),0,turns.length-1),true);
      return;
    }
    const scroller=metrics.scroller;
    rememberPosition(scroller);
    const token=navigation.begin('rail');jumpSerial++;seekingIndex=-1;
    const destination=metrics.bounds.min+clamp(fraction,0,1)*metrics.span;
    if(navigation.write(token,scroller,destination)){
      lastJump='正文进度条：按实际滚动位置定位';readingTouched=true;
    }
    navigation.finish(token);requestAnimationFrame(updateActive);
    setTimeout(saveReadingPosition,120);
  }
  function railArrow(direction) {
    const metrics=railMetrics();
    if(!metrics.visible)return;
    if(metrics.mode==='turns')jumpTo(clamp(activeIndex+direction,0,turns.length-1),true);
    else jumpRailPosition(metrics.fraction+direction*metrics.scroller.clientHeight*.8/metrics.span);
  }
  function appendMarkedText(container, source, needle) {
    if (!needle) { container.textContent = source; return; }
    const lower = source.toLocaleLowerCase(), term = needle.toLocaleLowerCase();
    let at = 0;
    while (at < source.length) {
      const pos = lower.indexOf(term, at);
      if (pos < 0) { container.append(document.createTextNode(source.slice(at))); break; }
      if (pos > at) container.append(document.createTextNode(source.slice(at,pos)));
      const mark = document.createElement('mark'); mark.textContent = source.slice(pos,pos+term.length);
      container.append(mark); at = pos+term.length;
    }
  }
  function renderList() {
    runtimeMetrics.renderedLists++;
    const oldScroll=list.scrollTop;
    const focusedId=shadow.activeElement?.dataset?.navId;
    const selectedId=navigationTargets[searchSelection]?.navId;
    const fragment=document.createDocumentFragment(),timeline=getTimeline();
    filteredIndices=[]; navigationTargets=[];
    let headingMatches=0;
    const addTarget=(button,target,navId)=>{
      button.dataset.navId=navId;
      button.dataset.navOrder=String(navigationTargets.length);
      navigationTargets.push({...target,navId});
    };
    turns.forEach((turn,idx)=>{
      const mounted=!!turn.node?.isConnected && !!timeline?.contains(turn.node);
      if(mountedOnly && !mounted) return;
      const turnMatch=!lastSearch || `${idx+1} ${turn.label}`.toLocaleLowerCase().includes(lastSearch);
      const answers=turn.answers||[];
      const matchHeading=h=>!lastSearch || h.text.toLocaleLowerCase().includes(lastSearch);
      const hasHeadingMatch=answers.some(a=>a.headings.some(matchHeading));
      const bodyText=bodySearch?cachedBodyText(turn):'';
      const bodyMatch=!!lastSearch&&bodySearch&&bodyText.toLocaleLowerCase().includes(lastSearch);
      if(lastSearch && !turnMatch && !hasHeadingMatch && !bodyMatch) return;
      filteredIndices.push(idx);
      const group=document.createElement('section'); group.className='turn-group';
      const b=document.createElement('button'); b.type='button';
      b.className=`item${idx===activeIndex?' active':''}`; b.dataset.idx=String(idx);
      b.dataset.navId=`turn:${turn.key}`;
      b.title=`${idx+1}. ${turn.label}\n${mounted?'页面已加载，可直接定位':'尚未加载，需要加载历史'}`;
      if(turn.role==='assistant') b.title+='\n定时任务/助手独立回复';
      b.setAttribute('aria-current',String(idx===activeIndex));
      const n=document.createElement('span'); n.className='num'; n.textContent=String(idx+1).padStart(3,'0');
      const label=document.createElement('span'); label.className='label'; appendMarkedText(label,turn.label,lastSearch);
      const dot=document.createElement('span');dot.className='dot'+(mounted?' mounted':'');dot.setAttribute('aria-label',mounted?'已加载':'尚未加载');
      b.append(n,dot,label); b.addEventListener('click',()=>jumpToIdentity(turn,true));
      const row=document.createElement('div');row.className='turn-top';
      const md=document.createElement('button');md.type='button';md.className='turn-export';md.textContent='MD▾';
      md.title='Markdown：复制 / 下载（Shift+点击直接复制）';
      md.setAttribute('aria-label',`导出第 ${idx+1} 轮 Markdown`);md.dataset.exportAction='turn';
      md.dataset.navId=`export:${turn.key}`;md.disabled=exportBusy;
      md.addEventListener('click',e=>{e.stopPropagation();if(e.shiftKey)exportMarkdown('turn',turn,null,'copy');else openMarkdownActions(e,'turn',turn);});
      row.append(b,md);group.append(row);
      if(turnMatch||bodyMatch) addTarget(b,{index:idx,target:null},`turn:${turn.key}`);
      if(bodyMatch){const snippet=document.createElement('div');snippet.className='body-snippet';
        const at=bodyText.toLocaleLowerCase().indexOf(lastSearch),start=Math.max(0,at-35);
        appendMarkedText(snippet,(start?'…':'')+bodyText.slice(start,start+155),lastSearch);
        snippet.title='命中已缓存正文；点击轮次可跳到该轮开头';group.append(snippet);}
      if(!answers.length) {
        const pending=document.createElement('div'); pending.className='toc-empty';
        pending.textContent=mounted?'尚未检测到回答内容':'回答目录将在内容读取后显示';group.append(pending);
      }
      answers.forEach((answer,ai)=>{
        const matching=new Set(answer.headings.filter(matchHeading).map(h=>h.index));
        const context=new Set(matching);
        for(const i of matching) {
          let p=answer.headings[i].parent;
          while(p>=0) {context.add(p);p=answer.headings[p].parent;}
        }
        if(lastSearch && !turnMatch && !matching.size) return;
        const isSearchOpen=!!lastSearch && (turnMatch||matching.size>0);
        // Closed until the user explicitly opens this answer; scrolling never opens it.
        const open=isSearchOpen || (expandedAnswers.has(answer.key) && !collapsedAnswers.has(answer.key));
        const box=document.createElement('div');box.className='answer-outline';
        const head=document.createElement('div');head.className='toc-head';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='toc-toggle';
        toggle.dataset.navId=`toggle:${answer.key}`;toggle.setAttribute('aria-expanded',String(open));
        const glyph=document.createElement('span');glyph.className='chevron';glyph.textContent=open?'▾':'▸';glyph.setAttribute('aria-hidden','true');
        const title=document.createElement('span');title.textContent=`回答${answers.length>1?' '+(ai+1):''}目录`;
        const count=document.createElement('span');count.className='toc-count';
        count.textContent=answer.headings.length?`${answer.headings.length} 节${answer.source!=='dom'?' · 待加载':''}`:'无章节标题';
        toggle.title=`${open?'折叠':'展开'}本回答目录 · ${count.textContent}`;
        toggle.append(glyph,title,count);
        toggle.addEventListener('click',()=>{
          if(isSearchOpen) {
            // Search expansion is temporary. Clearing it restores the saved fold states.
            search.value='';lastSearch='';searchSelection=0;
          }
          if(open) {collapsedAnswers.add(answer.key);expandedAnswers.delete(answer.key);}
          else {collapsedAnswers.delete(answer.key);expandedAnswers.add(answer.key);}
          saveOutlineState();renderList();
        });
        const top=document.createElement('button');top.type='button';top.className='answer-top';top.textContent='↥';
        top.title='跳到这条回答的开头';top.setAttribute('aria-label','跳到回答开头');top.dataset.navId=`answer:${answer.key}`;
        top.addEventListener('click',()=>jumpToIdentity(turn,true,outlineTarget(answer,ai)));
        const amd=document.createElement('button');amd.type='button';amd.className='answer-top answer-export';amd.textContent='⋯';
        amd.title='仅此回答：复制 / 下载 Markdown';amd.setAttribute('aria-label','导出本回答 Markdown');
        amd.dataset.exportAction='answer';amd.dataset.navId=`export-answer:${answer.key}`;amd.disabled=exportBusy;
        amd.addEventListener('click',e=>{e.stopPropagation();openMarkdownActions(e,'answer',turn,exportUnique([answer.key,...answer.ids]));});
        // These controls act on this answer only, independently of other turns.
        const depthBar=document.createElement('div');depthBar.className='toc-depth-actions';
        depthBar.setAttribute('role','group');depthBar.setAttribute('aria-label','本回答目录展开层级');
        if(answer.headings.length) for(const depth of [1,2,3]) {
          const preset=document.createElement('button');preset.type='button';preset.className='toc-depth-button';
          preset.textContent=`H${depth}`;preset.title=`本回答显示前 ${depth} 层章节。手动选择后保持固定，再次点击可恢复自动跟随`;
          preset.setAttribute('aria-label',`本回答目录展开到第 ${depth} 层`);
          preset.setAttribute('aria-pressed',String(open && (answerDepths.has(answer.key)?answerDepths.get(answer.key)===depth:depth===1)));
          preset.dataset.navId=`depth:${answer.key}:${depth}`;
          preset.addEventListener('click',()=>setAnswerOutlineDepth(answer,depth));
          depthBar.append(preset);
        }
        head.append(toggle,depthBar,top,amd);box.append(head);
        if(open) {
          const body=document.createElement('div');body.className='toc-body';
          if(!answer.headings.length) {
            const empty=document.createElement('div');empty.className='toc-empty';
            empty.textContent=answer.source==='dom'?'这条回答没有章节标题，可点 ↥ 跳到回答开头。':'尚无可用标题，加载回答后会重新识别。';body.append(empty);
          }
          answer.headings.forEach((h,hi)=>{
            if(lastSearch && !turnMatch && !context.has(hi)) return;
            if(!lastSearch) {
              let p=h.parent;
              while(p>=0) {if(isOutlineHeadingFolded(answer,answer.headings[p])) return;p=answer.headings[p].parent;}
            }
            const row=document.createElement('div');row.className='toc-row';row.style.paddingLeft=`${Math.min(h.depth,5)*12}px`;
            if(activeAutoAnswerKey===answer.key && activeAutoRootKey===h.key) row.classList.add('toc-auto-root');
            const hasChildren=answer.headings[hi+1]?.parent===hi;
            const fold=document.createElement(hasChildren?'button':'span');fold.className='toc-node-toggle';
            if(hasChildren) {
              fold.type='button';fold.textContent=isOutlineHeadingFolded(answer,h)&&!lastSearch?'▸':'▾';
              fold.setAttribute('aria-label',`${isOutlineHeadingFolded(answer,h)?'展开':'折叠'}“${h.text}”子章节`);
              fold.setAttribute('aria-expanded',String(!isOutlineHeadingFolded(answer,h)||!!lastSearch));fold.dataset.navId=`fold:${h.key}`;
              fold.addEventListener('click',()=>{
                const wasOpen=!isOutlineHeadingFolded(answer,h)||!!lastSearch;
                if(lastSearch){search.value='';lastSearch='';expandedAnswers.add(answer.key);collapsedAnswers.delete(answer.key);}
                // Explicit close/open overrides depth presets and automatic following.
                if(wasOpen) {foldedHeadings.add(h.key);pinnedOpenHeadings.delete(h.key);}
                else {pinnedOpenHeadings.add(h.key);foldedHeadings.delete(h.key);}
                saveOutlineState();renderList();
              });
            } else fold.setAttribute('aria-hidden','true');
            const link=document.createElement('button');link.type='button';link.className='toc-link';
            link.dataset.section=h.key;link.dataset.navId=`heading:${h.key}`;
            const level=document.createElement('span');level.className='toc-level';level.textContent=`H${h.level}`;
            const text=document.createElement('span');text.className='toc-text';appendMarkedText(text,h.text,lastSearch);
            link.title=h.text+(h.node?.isConnected?'':'\n标题已索引，点击后尝试加载并精确定位');
            link.append(level,text);link.addEventListener('click',()=>jumpToIdentity(turn,true,outlineTarget(answer,ai,h)));
            if(!lastSearch || matchHeading(h)) {addTarget(link,{index:idx,target:outlineTarget(answer,ai,h)},`heading:${h.key}`);headingMatches++;}
            row.append(fold,link);body.append(row);
          });
          box.append(body);
        }
        group.append(box);
      });
      fragment.append(group);
    });
    if(!filteredIndices.length) {
      const empty=document.createElement('div');empty.className='empty';
      empty.textContent=mountedOnly?'没有已加载且匹配的轮次，可关闭「仅已加载」':'没有匹配的提问或章节标题';fragment.append(empty);
    }
    list.replaceChildren(fragment);list.scrollTop=oldScroll;
    if(focusedId) [...list.querySelectorAll('[data-nav-id]')].find(el=>el.dataset.navId===focusedId)?.focus({preventScroll:true});
    const previous=navigationTargets.findIndex(t=>t.navId===selectedId);
    if(previous>=0) searchSelection=previous;
    searchSelection=clamp(searchSelection,0,Math.max(0,navigationTargets.length-1));
    shadow.getElementById('searchMeta').textContent=`${mountedOnly?'仅已加载':'全部轮次'} · ${filteredIndices.length} / ${turns.length}${lastSearch?' · '+headingMatches+' 个章节匹配':''}`;
    updateCoverage();highlightSearchSelection(false);updateActiveSection();
  }
  function highlightSearchSelection(scroll=true) {
    list.querySelectorAll('.search-selected').forEach(el=>el.classList.remove('search-selected'));
    const el=list.querySelector(`[data-nav-order="${searchSelection}"]`);
    if(!el) return;
    if(shadow.activeElement===search) el.classList.add('search-selected');
    if(scroll) scrollWithinList(el);
  }
  function revealActiveItem() {
    if(!lastSearch && !mountedOnly) scrollWithinList(list.querySelector(`.item[data-idx="${activeIndex}"]`));
  }

  function showPreview(event) {
    const metrics=railMetrics();
    if(!metrics.visible||panel.classList.contains('open'))return;
    const fraction=pointerRailFraction(event);
    if(metrics.mode==='turns'){
      const index=clamp(Math.round(fraction*(turns.length-1)),0,turns.length-1);
      preview.textContent=(index+1)+'. '+turns[index].label;
    }else preview.textContent='正文位置 '+Math.round(fraction*100)+'% · 历史未确认';
    preview.style.top=clamp(event.clientY-20,8,window.innerHeight-100)+'px';
    preview.style.display='block';
  }
  function setActive(index) {
    if (!turns.length) return;
    activeIndex = clamp(index, 0, turns.length - 1);
    counter.textContent = `${activeIndex+1} / ${turns.length} 轮`;
    updateRailProgress();
    if (panel.classList.contains('open')) {
      list.querySelectorAll('.item.active').forEach(el => el.classList.remove('active'));
      const active = list.querySelector(`.item[data-idx="${activeIndex}"]`);
      active?.classList.add('active');
      list.querySelectorAll('.item[aria-current="true"]').forEach(el=>el.setAttribute('aria-current','false'));
      active?.setAttribute('aria-current','true');
    }
  }
  function updateActive() {
    if(!turns.length || seekingIndex>=0) {updateRailProgress();return;}
    const scroller=getTimeline();if(!scroller) {updateRailProgress();return;}
    const boundary=scroller.getBoundingClientRect().top+Math.min(120,scroller.clientHeight*.25);
    let before=-1,beforeTop=-Infinity,after=-1,afterTop=Infinity;
    for(let i=0;i<turns.length;i++) {
      const node=turns[i].node;if(!node?.isConnected || !scroller.contains(node)) continue;
      const rect=node.getBoundingClientRect();if(rect.height<1) continue;
      if(rect.top<=boundary && rect.top>beforeTop) {before=i;beforeTop=rect.top;}
      if(rect.top>boundary && rect.top<afterTop) {after=i;afterTop=rect.top;}
    }
    if(before>=0 || after>=0) setActive(before>=0?before:after);
    else updateRailProgress();
    updateActiveSection();
  }

