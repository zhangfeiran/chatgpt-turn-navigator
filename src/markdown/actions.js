  async function exportMarkdown(kind='all',target=null,answerSelection=null,delivery='download') {
    if(exportBusy)return;
    pinPanelOpen();const scope=conversationScope(),ticket=++exportEpoch;
    const targetIds=target?turnIds(target):kind==='all'?[]:turnIds(turns[activeIndex]);
    exportBusy=true;syncExportButtons();
    setHint(`正在准备 Markdown${delivery==='copy'?'以复制':'文件'}…`,120000);
    try {
      safeUpdate(false);
      let selected=kind==='all'?turns:turns.filter(t=>turnIds(t).some(id=>targetIds.includes(id))).slice(0,1);
      const hasBody=selected.length&&selected.every((t,i)=>!exportTurnBody(t,i+1,answerSelection).missing.length);
      // Local Q/A and answer exports are immediate. Full-history reads remain
      // optional, have a cooldown after explicit 404s, and never drive scrolling.
      const needHistory=kind==='all'?!apiComplete:!hasBody;
      if(needHistory&&chatId()&&Date.now()>=apiCooldownUntil)await loadApiIndex(false);
      if(scope!==conversationScope()||ticket!==exportEpoch)return;
      safeUpdate(false);
      const all=turns.map((turn,i)=>({turn,number:i+1}));
      selected=kind==='all'?all:all.filter(({turn})=>turnIds(turn).some(id=>targetIds.includes(id))).slice(0,1);
      if(!selected.length)throw new Error('要导出的消息当前不在索引中，请重新选择。');
      const result=exportBuild(selected,kind,answerSelection);
      if(delivery==='copy') {
        const copied=await copyMarkdownText(result.markdown);
        if(scope!==conversationScope()||ticket!==exportEpoch)return;
        setHint(copied?`已复制 ${result.count} 轮 Markdown${result.partial?'（部分内容/快照）':''}。`:'Markdown 已准备好，请在文本框中手动复制。',10000);
      } else {
        exportDownload(result);setHint(`已导出 ${result.count} 轮 Markdown${result.partial?'（部分内容，见文件说明）':''}。`,12000);
      }
    } catch(error){if(scope===conversationScope()&&ticket===exportEpoch)setHint('Markdown 操作失败：'+String(error?.message||error).slice(0,160),9000);}
    finally{if(ticket===exportEpoch){exportBusy=false;syncExportButtons();}}
  }

