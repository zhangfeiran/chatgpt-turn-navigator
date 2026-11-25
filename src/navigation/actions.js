  function onScroll(event) {
    const timeline=getTimeline();
    // A directory or sidebar scroll is not a change to the reading position.
    if(event && event.target!==timeline && event.target!==document && event.target!==window)return;
    if(scrollRaf)return;
    scrollRaf=requestAnimationFrame(()=>{
      scrollRaf=0;if(!host||host.dataset.disabled==='true')return;
      updateActive();
      if(readingTouched&&!navigation.current){clearTimeout(readingTimer);readingTimer=setTimeout(saveReadingPosition,650);}
    });
  }

  async function scanToRepairOrder() {
    if(scanBusy&&scanToken&&navigation.owns(scanToken)) {
      navigation.cancel('stop');setHint('正在停止扫描并恢复扫描前的位置…',9000);return;
    }
    const scroller=getTimeline();
    if(!scroller||scroller.scrollHeight<=scroller.clientHeight){setHint('正文尚未加载或无需扫描。');return;}
    const token=navigation.begin('scan');scanToken=token;scanBusy=true;jumpSerial++;seekingIndex=-1;
    const initialTop=scroller.scrollTop,scope=conversationScope();
    scanLastSteps=0;scanLastSeen=0;
    const observed=new Set(),sequence=[],button=shadow.getElementById('rebuildOrder');
    button.textContent='停止扫描';button.disabled=false;
    const initialCorrections=totalOrderCorrections+totalSpatialCorrections;
    let position=scrollBounds(scroller).min,complete=false,error='',lastEpoch=geometry.epoch,lastIds=[];
    try {
      for(let n=0;n<400;n++) {
        if(!navigation.live(token)||!scroller.isConnected)break;
        const bounds=scrollBounds(scroller),at=clamp(position,bounds.min,bounds.max);
        if(!navigation.write(token,scroller,at))break;
        await new Promise(r=>setTimeout(r,160));
        if(!navigation.live(token))break;
        safeUpdate(false);
        const dom=detectTurns(),ids=dom.map(t=>t.key);
        const overlap=ids.some(id=>lastIds.includes(id));
        const newIds=ids.filter(id=>!observed.has(id));
        ids.forEach(id=>observed.add(id));
        // An uninterrupted, overlapping traversal supplies extra chronology
        // even when each viewport contains just one very tall answer.
        if(newIds.length) {
          if(sequence.length && geometry.epoch!==lastEpoch && !overlap)sequence.length=0;
          if(geometry.sign<0)sequence.unshift(...newIds);else sequence.push(...newIds);
          orderEvidence.sequence(sequence,2);
        }
        lastEpoch=geometry.epoch;lastIds=ids;
        scanLastSteps=n+1;scanLastSeen=observed.size;
        if(n%3===0)setHint(`正在扫描 ${Math.round((at-bounds.min)/Math.max(1,bounds.max-bounds.min)*100)}% · ${observed.size} 轮 · 可点“停止扫描”`,12000);
        if(at>=bounds.max-2){complete=true;break;}
        position=at+Math.max(160,Math.floor(scroller.clientHeight*.68));
      }
    } catch(e){error=String(e?.message||e).slice(0,140);}
    finally {
      const owns=navigation.owns(token),canRestore=owns&&(!token.cancelled||token.reason==='stop');
      if(canRestore&&scroller.isConnected) {
        navigation.write(token,scroller,initialTop,token.reason==='stop');
        await new Promise(r=>setTimeout(r,100));
        if(navigation.owns(token))safeUpdate(false);
      }
      if(scanToken===token){scanToken=null;scanBusy=false;button.textContent='↕ 扫描校正排序';}
      if(navigation.owns(token)) {
        const corrections=totalOrderCorrections+totalSpatialCorrections-initialCorrections;
        setHint(error?`扫描中断：${error}`:
          `${token.cancelled?'扫描已停止':complete?'当前正文扫描完成':'扫描达到步数上限'} · ${scanLastSeen} 轮 / ${scanLastSteps} 个位置 · 校正 ${corrections} 次。${canRestore?'已尝试恢复扫描前位置。':'保留你的新位置。'}扫描不代表已确认全部历史。`,12000);
        navigation.finish(token);updateCoverage();
      }
    }
  }

  function scrollBounds(scroller) {
    const overflow = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const reversed = getComputedStyle(scroller).flexDirection === 'column-reverse';
    return {min: reversed ? -overflow : 0, max: reversed ? 0 : overflow, reversed};
  }
  function timelineJumpInset(scroller,reading=false) {
    // Keep the target below ChatGPT's sticky/faded header. Leave a small
    // margin before the existing active-heading tracking boundary (120px).
    // Short viewports use a proportionally smaller gap. Saved reading offsets
    // still use their original 26px reference, including records from older versions.
    return reading ? 26 : Math.max(26, Math.min(112, Math.floor(scroller.clientHeight*.25)-8));
  }
  function scrollWithinTimeline(node,smooth=false,token=navigation.current,offset=0,reading=false) {
    const scroller=getTimeline();if(!scroller||!node?.isConnected||!scroller.contains(node))return false;
    const r=node.getBoundingClientRect(),box=scroller.getBoundingClientRect();if(r.height<1)return false;
    return navigation.write(token,scroller,scroller.scrollTop+r.top-box.top-timelineJumpInset(scroller,reading)+offset);
  }

  function findMountedTurn(turn) {
    const timeline = getTimeline();
    if (!timeline) return null;
    if (turn.node?.isConnected && timeline.contains(turn.node)) return turn.node;
    // The archived real page uses the user message ID as the data-turn-key.
    const ids = (turn.ids?.length ? turn.ids : [turn.id || turn.key]).filter(Boolean);
    if (!ids.length) return null;
    for (const n of timeline.querySelectorAll('[data-turn-key]'))
      if (ids.includes(n.getAttribute('data-turn-key'))) return n;
    for (const n of timeline.querySelectorAll('[data-chatgpt-search-message-ids]'))
      if ((n.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/).some(id=>ids.includes(id)))
        return n.closest('[data-turn-key]') || n;
    return null;
  }
  function updateReturnButton() {
    const button = shadow?.getElementById('returnPos');
    if (button) button.disabled = !returnPositions.length;
  }
  function rememberPosition(scroller) {
    if(!scroller)return;
    const point=captureReadingPoint(),previous=returnPositions.at(-1);
    if(!previous||previous.route!==location.pathname||Math.abs(previous.top-scroller.scrollTop)>12) {
      returnPositions.push({route:location.pathname,top:scroller.scrollTop,point});
      if(returnPositions.length>12)returnPositions.shift();
    }
    updateReturnButton();
  }

  function returnToPreviousPosition() {
    let previous;
    while(returnPositions.length){const p=returnPositions.pop();if(p.route===location.pathname){previous=p;break;}}
    updateReturnButton();if(!previous)return;
    if(previous.point){restoreReadingPoint(previous.point,false);return;}
    const scroller=getTimeline();if(!scroller)return;
    const token=navigation.begin('return');jumpSerial++;seekingIndex=-1;
    navigation.write(token,scroller,previous.top);navigation.finish(token);
    setHint('已返回上一次正文位置。');requestAnimationFrame(updateActive);
  }

  async function jumpTo(index,highlight=true,target=null,options={}) {
    const initial=options.turn||turns[index];if(!initial)return false;
    const scroller=getTimeline();if(!scroller){setHint('正文尚未加载，暂时无法定位。');return false;}
    const wantedIds=turnIds(initial);
    if(options.record!==false)rememberPosition(scroller);
    const token=navigation.begin(options.reading?'resume':'jump');jumpSerial++;seekingIndex=Math.max(0,index);
    const caption=options.reading?'上次阅读位置':target?.kind==='heading'?`章节“${target.text}”`:target?'回答':'目标轮次';
    const diagnosticTarget=options.reading?'恢复阅读':target?.kind==='heading'?'章节':target?'回答':'轮次';
    const getTurn=()=>turns.find(t=>turnIds(t).some(id=>wantedIds.includes(id)))||initial;
    const resolve=()=>options.reading?resolveReadingNode(getTurn(),options.reading):resolveOutlineNode(getTurn(),target);
    const tried=new Set();let center=null,step=0,successful=false;
    try {
      for(let attempt=0;attempt<22;attempt++) {
        if(!navigation.live(token)||!scroller.isConnected)return false;
        safeUpdate(false);
        const node=resolve();
        if(node&&scrollWithinTimeline(node,false,token,options.reading?.offset||0,!!options.reading)) {
          if(highlight){const outline=node.style.outline,offset=node.style.outlineOffset;
            node.style.outline='2px solid #52d4aa';node.style.outlineOffset='3px';
            setTimeout(()=>{if(node.isConnected){node.style.outline=outline;node.style.outlineOffset=offset;}},1400);}
          const now=turns.findIndex(t=>turnIds(t).some(id=>wantedIds.includes(id)));
          if(now>=0)setActive(now);
          lastJump=`${diagnosticTarget}：精确匹配`;setHint(`已按消息身份精确定位${caption}（仅正文）。`);
          successful=true;readingTouched=true;return true;
        }
        const bounds=scrollBounds(scroller),turn=getTurn(),point=geometry.get(turn,turnIds)||geometry.get(turn,turnIds,false);
        const knownShell=findMountedTurn(turn);
        if(center===null) {
          center=options.reading?.top??(point?point.top-timelineJumpInset(scroller,!!options.reading):null);
          if(center===null) {
            const now=turns.findIndex(t=>turnIds(t).some(id=>wantedIds.includes(id)));
            const anchors=turns.map((t,i)=>({i,p:geometry.get(t,turnIds)})).filter(x=>x.p);
            const lower=anchors.filter(x=>x.i<now).at(-1),upper=anchors.find(x=>x.i>now);
            if(lower&&upper)center=lower.p.top+(upper.p.top-lower.p.top)*(now-lower.i)/(upper.i-lower.i);
            else if(lower)center=lower.p.top+geometry.sign*scroller.clientHeight*.7;
            else if(upper)center=upper.p.top-geometry.sign*scroller.clientHeight*.7;
            else center=bounds.min+(now<0?.5:now/Math.max(1,turns.length-1))*(bounds.max-bounds.min);
          }
          center=clamp(center,bounds.min,bounds.max);
        }
        let destination;
        if(knownShell) {
          // The right message has mounted, but a requested heading may still be
          // streaming. Wait here rather than bouncing to another turn.
          const r=knownShell.getBoundingClientRect(),box=scroller.getBoundingClientRect();
          destination=scroller.scrollTop+r.top-box.top-timelineJumpInset(scroller,!!options.reading);
        } else if(attempt<3) destination=center;
        else {
          // Local expansion is bounded and never repeatedly alternates endpoints.
          let found=false;
          while(step<60&&!found) {
            step++;const radius=Math.ceil(step/2)*scroller.clientHeight*.72;
            destination=clamp(center+(step%2?radius:-radius),bounds.min,bounds.max);
            const k=Math.round(destination/8);if(!tried.has(k)){tried.add(k);found=true;}
          }
          if(!found)break;
        }
        navigation.write(token,scroller,destination);
        lastJump=`${diagnosticTarget}：等待挂载（${attempt+1}/22）`;
        setHint(`正在查找${caption} · ${attempt+1}/22；滚轮、触摸或点击其他轮次可停止。`,1500);
        await new Promise(r=>setTimeout(r,attempt<3?220:170));
      }
      if(navigation.live(token)){lastJump=`${diagnosticTarget}：尚未匹配`;setHint('未取得目标正文或章节已变化。未报告跳转成功；可在设置中扫描补齐位置后重试。',9000);}
      return false;
    } finally {
      if(navigation.owns(token)){seekingIndex=-1;navigation.finish(token);requestAnimationFrame(updateActive);if(successful)setTimeout(saveReadingPosition,120);}
    }
  }

  function loadEarlier() {
    const scroller=getTimeline();if(!scroller){setHint('正文尚未加载。');return;}
    rememberPosition(scroller);const token=navigation.begin('earlier');jumpSerial++;seekingIndex=-1;
    navigation.write(token,scroller,scrollBounds(scroller).min);navigation.finish(token);
    setHint('已滚动到正文起点；更早历史可能仍需页面继续加载。');setTimeout(scheduleUpdate,600);
  }

