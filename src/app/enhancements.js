  function jumpToIdentity(turn,highlight=true,target=null) {
    const ids=turnIds(turn),index=turns.findIndex(t=>turnIds(t).some(id=>ids.includes(id)));
    return jumpTo(index,highlight,target,{turn:index>=0?turns[index]:turn});
  }
  function userNavigationIntent() {
    readingTouched=true;cancelSeek();
    clearTimeout(readingTimer);readingTimer=setTimeout(saveReadingPosition,800);
  }
  function captureReadingPoint() {
    const scroller=getTimeline();if(!scroller)return null;
    updateActive();const turn=turns[activeIndex];if(!turn?.node?.isConnected)return null;
    const ids=turnIds(turn).filter(id=>!/^local-\d+$/.test(id));if(!ids.length)return null;
    const box=scroller.getBoundingClientRect(),limit=box.top+Math.min(120,scroller.clientHeight*.25);
    let anchor=turn.node,answerIdsSaved=[],headingHash='',best=-Infinity;
    for(const answer of turn.answers||[]) for(const heading of answer.headings||[]) {
      const node=heading.node;if(!node?.isConnected)continue;
      const r=node.getBoundingClientRect();
      if(r.height>0&&r.top<=limit&&r.top>best){anchor=node;best=r.top;answerIdsSaved=answer.ids||[];
        headingHash=readingStore.hash(`${heading.level}\0${heading.text}\0${heading.occurrence||0}`);}
    }
    return {ids,answerIds:answerIdsSaved,headingHash,offset:box.top+26-anchor.getBoundingClientRect().top,
      top:scroller.scrollTop,width:Math.round(scroller.getBoundingClientRect().width),
      direction:getComputedStyle(scroller).flexDirection};
  }
  function resolveReadingNode(turn,point) {
    const shell=findMountedTurn(turn);if(!shell)return null;
    if(!point.headingHash)return shell;
    const answers=getDOMAnswers({...turn,node:shell});
    for(const a of answers) {
      if(point.answerIds?.length&&!a.ids.some(id=>point.answerIds.includes(id)))continue;
      const h=a.headings.find(h=>readingStore.hash(`${h.level}\0${h.text}\0${h.occurrence||0}`)===point.headingHash);
      if(h?.node)return h.node;
    }
    return null;
  }
  function saveReadingPosition() {
    if(!readingTouched || navigation.current || currentScope!==conversationScope())return;
    const point=captureReadingPoint();if(!point)return;
    readingStore.save(currentScope,point);lastReadingPoint=point;
    // Keep the entry-time resume target stable until the user deliberately resumes.
    if(!resumePoint)resumePoint=point;
    syncReadingButton();
  }
  function syncReadingButton() {
    const b=shadow?.getElementById('resumeReading');if(b)b.disabled=!resumePoint;
  }
  function restoreReadingPoint(point,record=true) {
    if(!point?.ids?.length){setHint('没有可恢复的阅读位置。');return;}
    const index=turns.findIndex(t=>turnIds(t).some(id=>point.ids.includes(id)));
    const turn=index>=0?turns[index]:{key:point.ids[0],id:point.ids[0],ids:point.ids,node:null,answers:[]};
    return jumpTo(index,true,null,{turn,record,reading:point});
  }
  function cachedBodyText(turn) {
    const memo=searchBodyMemo.get(turn.key);
    if(memo?.revision===exportContentRevision)return memo.text;
    const snapshot=exportFindSnapshot(turn),parts=[],used=new Set();
    const messages=turnIds(turn).map(id=>exportAPI.get(id)).filter(Boolean);
    for(const m of messages)if(m.markdown){parts.push(m.markdown);used.add(m.id);}
    if(snapshot?.question?.markdown&&!messages.some(m=>m.role==='user'))parts.push(snapshot.question.markdown);
    for(const a of snapshot?.answers||[])if(!a.ids.some(id=>used.has(id)))parts.push(a.markdown);
    const text=parts.join('\n\n');searchBodyMemo.set(turn.key,{revision:exportContentRevision,text});
    return text;
  }
  function updateCoverage() {
    if(!shadow)return;
    const mounted=turns.filter(t=>t.node?.isConnected).length;
    const bodies=turns.filter(t=>!!cachedBodyText(t)).length;
    const positions=turns.filter(t=>geometry.get(t,turnIds)).length;
    const el=shadow.getElementById('coverage');if(!el)return;
    el.textContent=`索引 ${turns.length} · 挂载 ${mounted} · 正文 ${bodies}/${turns.length} · ${apiComplete?'历史已确认':'历史未确认'}`;
    el.title=`有效位置 ${positions}/${turns.length}。正文数量指至少取得部分正文，不保证每轮完整；正文搜索只覆盖缓存，不会自动扫描。`;
  }
  function openMarkdownActions(event,kind,turn,selection=null) {
    pinPanelOpen();const menu=shadow.getElementById('mdActions');menu.replaceChildren();
    const identity=metadataSnapshot(turn);
    for(const [label,delivery] of [['⧉ 复制 Markdown','copy'],['↓ 下载 Markdown','download']]) {
      const b=document.createElement('button');b.type='button';b.role='menuitem';b.textContent=label;
      b.disabled=exportBusy;b.dataset.exportAction=kind;
      b.addEventListener('click',()=>{menu.hidden=true;exportMarkdown(kind,identity,selection,delivery);});menu.append(b);
    }
    const r=event.currentTarget.getBoundingClientRect();menu.style.left=`${clamp(r.right-200,8,innerWidth-208)}px`;
    menu.style.top=`${clamp(r.bottom+3,8,innerHeight-100)}px`;menu.hidden=false;menu.querySelector('button')?.focus({preventScroll:true});
  }
  async function copyMarkdownText(text) {
    try {
      if(typeof navigator.clipboard?.writeText!=='function')throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);return true;
    } catch {
      const dialog=shadow.getElementById('copyFallback'),input=shadow.getElementById('copyText');
      input.value=text;dialog.hidden=false;input.focus({preventScroll:true});input.select();return false;
    }
  }
  function initializeEnhancements() {
    shadow.getElementById('searchScope').addEventListener('change',e=>{bodySearch=e.target.value==='body';searchSelection=0;renderList();});
    shadow.getElementById('copyCurrent').addEventListener('click',()=>exportMarkdown('turn',turns[activeIndex],null,'copy'));
    shadow.getElementById('resumeReading').addEventListener('click',()=>restoreReadingPoint(resumePoint));
    shadow.getElementById('clearReading').addEventListener('click',()=>{
      readingStore.clear(conversationScope());resumePoint=null;lastReadingPoint=null;readingTouched=false;clearTimeout(readingTimer);
      syncReadingButton();setHint('已清除本对话阅读记录。只有之后再次阅读才会重新记录。');
    });
    shadow.getElementById('copyClose').addEventListener('click',()=>{shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';});
    shadow.getElementById('copyText').addEventListener('click',e=>e.target.select());
    shadow.getElementById('copyRetry').addEventListener('click',async()=>{
      const text=shadow.getElementById('copyText').value;
      if(await copyMarkdownText(text)){shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';setHint('Markdown 已复制。');}
    });
    document.addEventListener('pointerdown',e=>{
      const menu=shadow.getElementById('mdActions');if(!e.composedPath().includes(menu))menu.hidden=true;
    },true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)saveReadingPosition();});
    syncReadingButton();
  }

