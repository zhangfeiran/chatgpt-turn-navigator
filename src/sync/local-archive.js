  // Opt-in, browser-native local Markdown sync. Uses only already available
  // transcript/export data. Never scans the account or scrolls automatically.
  const ARCHIVE_DB='chatgpt-turn-navigator-local-archive-v1';
  const ARCHIVE_SIGNAL='ctn-local-archive-control-v1';
  const ARCHIVE_LOCK='ctn-local-archive-write-v1';
  const ARCHIVE_QUIET_MS=1800;
  let archiveConfig=null,archiveGranted=false,archivePersistent=false,archiveReady=false;
  let archiveBusy=false,archiveConfiguring=false,archiveBlocked=false,archiveEpoch=0,archiveTimer=0;
  let archiveMessage='默认关闭；选择本地目录后才开始写入。',archiveSignature='';
  const archivePending=new Map();
  function archiveSupported() {
    return typeof window.showDirectoryPicker==='function' && !!navigator.locks?.request && !!crypto?.subtle;
  }
  function archiveDB() {
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(ARCHIVE_DB,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('config'))req.result.createObjectStore('config');};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('浏览器存储暂不可用'));
    });
  }
  async function archiveStoredConfig(value,write=false) {
    const db=await archiveDB();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('config',write?'readwrite':'readonly'),store=tx.objectStore('config');
        const req=write?store.put(value,'root'):store.get('root');
        let result=null;
        req.onsuccess=()=>{result=req.result;};
        tx.oncomplete=()=>resolve(result);
        tx.onabort=tx.onerror=()=>reject(tx.error||req.error||new Error('浏览器存储失败'));
      });
    } finally {db.close();}
  }
  function archiveReadSignal() {
    try {return localStorage.getItem(ARCHIVE_SIGNAL)||'';}catch(_){return '';}
  }
  function archivePublishSignal(revision) {
    try {localStorage.setItem(ARCHIVE_SIGNAL,revision);}catch(_){}
  }
  function archiveRenderStatus(message) {
    if(message!==undefined)archiveMessage=message;
    const status=shadow?.getElementById('archiveStatus');if(!status)return;
    const supported=archiveSupported();
    const root=archiveConfig?.handle;
    const mode=!supported?'当前浏览器不支持':!archiveReady?'正在读取设置':archiveConfiguring?'正在设置':
      !root?'关闭':!archiveConfig.enabled?'已暂停':!archiveGranted?'需要授权':archiveBlocked?'已停止（写入异常）':archiveBusy?'正在同步':'自动同步已开启';
    status.textContent=mode+(root?' · '+root.name+'/'+ARCHIVE_ROOT:'')+'。'+archiveMessage+
      (root&&!archivePersistent?'（本次会话有效，目录授权未能保存）':'');
    shadow.getElementById('archiveChoose').disabled=!supported||!archiveReady||archiveBusy||archiveConfiguring;
    const toggle=shadow.getElementById('archiveToggle');
    toggle.disabled=!supported||!root||archiveConfiguring;
    toggle.textContent=archiveConfig?.enabled&&archiveGranted&&!archiveBlocked?'暂停同步':'恢复/授权';
    shadow.getElementById('archiveNow').disabled=!supported||!archiveConfig?.enabled||!archiveGranted||archiveBusy||archiveConfiguring;
    shadow.getElementById('archiveForget').disabled=!root||archiveConfiguring;
  }
  function archiveInvalidate() {
    archiveEpoch++;clearTimeout(archiveTimer);archiveTimer=0;archivePending.clear();archiveSignature='';
  }
  function archiveLive(epoch,config) {
    const signal=archiveReadSignal();
    return epoch===archiveEpoch&&archiveConfig===config&&!!config?.enabled&&archiveGranted&&!archiveBlocked&&
      (!signal||signal===config.revision);
  }
  async function archiveRestoreConfig() {
    const epoch=++archiveEpoch;
    archiveGranted=false;archivePending.clear();archiveSignature='';
    try {
      const config=await archiveStoredConfig();
      if(epoch!==archiveEpoch)return;
      // A control revision also prevents an old persisted handle from being
      // silently re-enabled if a later settings write failed.
      const signal=archiveReadSignal();
      archiveConfig=config?.handle&&(!signal||signal===config.revision)?config:null;
      archivePersistent=!!archiveConfig;
      const granted=!!archiveConfig?.enabled && await archiveConfig.handle.queryPermission({mode:'readwrite'})==='granted';
      if(epoch!==archiveEpoch)return;
      archiveGranted=granted;
      archiveBlocked=false;archiveReady=true;
      archiveRenderStatus(archiveConfig?.enabled&&!archiveGranted?'点击恢复/授权重新允许写入。':'仅归档当前已取得的对话内容。');
      archiveObserve(true);
    } catch(_) {
      if(epoch!==archiveEpoch)return;
      archiveConfig=null;archiveGranted=false;archiveReady=true;archivePersistent=false;
      archiveRenderStatus('无法读取保存的目录，请重新选择；不会自动写入。');
    }
  }
  async function archiveSaveConfig(handle,enabled,granted) {
    archiveInvalidate();
    const config={handle,enabled:!!enabled,revision:crypto.randomUUID()};
    archiveConfig=config;archiveGranted=!!granted;archiveBlocked=false;
    archivePersistent=false;
    // Update the cross-tab gate immediately. In-flight writes check this
    // revision before each commit; no new write can start with the old config.
    archivePublishSignal(config.revision);
    let persisted=false;
    try {await archiveStoredConfig(config,true);persisted=true;}
    catch(_) {}
    if(archiveConfig!==config)return;
    archivePersistent=persisted;
    // A second notification lets other tabs reload after the transaction.
    try {localStorage.setItem(ARCHIVE_SIGNAL+'-saved',config.revision);}catch(_){}
    archiveRenderStatus();
    if(config.enabled&&archiveGranted)archiveObserve(true);
  }
  async function archiveChooseDirectory() {
    if(!archiveSupported()||archiveConfiguring||archiveBusy)return;
    archiveConfiguring=true;archiveRenderStatus('请选择专用于归档的目录。');
    try {
      // Must run directly inside the user click, before asynchronous work.
      const handle=await window.showDirectoryPicker({id:'ctn-markdown-archive',mode:'readwrite'});
      const granted=await handle.queryPermission({mode:'readwrite'})==='granted';
      await archiveSaveConfig(handle,true,granted);
      archiveRenderStatus(granted?'目录已绑定，将在回答稳定后同步。':'请点击恢复/授权允许写入。');
    } catch(e) {
      archiveRenderStatus(e.name==='AbortError'?'已取消目录选择。':'目录绑定失败：'+String(e.name||'Error'));
    } finally {archiveConfiguring=false;archiveRenderStatus();}
  }
  async function archiveToggleEnabled() {
    if(!archiveConfig?.handle||archiveConfiguring)return;
    archiveConfiguring=true;
    const config=archiveConfig;
    try {
      if(config.enabled&&archiveGranted&&!archiveBlocked) {
        await archiveSaveConfig(config.handle,false,false);
        archiveRenderStatus('已暂停；已保存的文件不会删除。');
      } else {
        // Permission prompts are explicit user actions only.
        const granted=await config.handle.requestPermission({mode:'readwrite'})==='granted';
        await archiveSaveConfig(config.handle,true,granted);
        archiveRenderStatus(granted?'已恢复自动同步。':'未获得目录写入授权。');
      }
    } catch(e) {archiveRenderStatus('授权或设置失败：'+String(e.name||'Error'));}
    finally{archiveConfiguring=false;archiveRenderStatus();}
  }
  function archiveIsGenerating() {
    return !!getTimeline()?.querySelector('[data-is-streaming="true"],[data-message-status="in_progress"]') ||
      !!document.querySelector('[data-testid="stop-button"],[data-testid="composer-stop-button"]');
  }
  function archiveBuildBatch(id,scope,title,observedAt=Date.now()) {
    const records=[],seen=new Set();let skipped=0;
    for(const turn of turns) {
      const snapshot=exportFindSnapshot(turn),ids=turnIds(turn);
      const outlines=turn.answers||[];
      const answers=[],answerIds=[],notes=[];let partial=false,anchorId=null,anchorTime=null;
      for(const outline of outlines) {
        const oids=exportUnique([outline.key,...(outline.ids||[])]);
        const stable=oids.map(archiveStableId).filter(Boolean);
        const answerId=stable[0];
        if(!answerId){partial=true;continue;}
        if(!anchorId){
          anchorId=answerId;
          anchorTime=oids.map(x=>exportAPI.get(x)).find(a=>a?.role==='assistant'&&archiveValidTime(a.time)!==null)?.time??null;
        }
        if(answerIds.includes(answerId))continue;
        const dom=snapshot?.answers?.find(a=>a.ids?.some(x=>oids.includes(x))||oids.includes(a.id));
        const api=oids.map(x=>exportAPI.get(x)).find(a=>a?.role==='assistant'&&a.markdown?.trim()&&!a.unfinished);
        // A current complete DOM snapshot wins over a potentially stale API
        // copy; an exact-ID raw API body may fill missing code/diagram source.
        const body=dom?.markdown?.trim()&&!dom.codeIncomplete?dom:api||dom;
        if(dom?.unfinished||!body?.markdown?.trim()||body.unfinished){partial=true;continue;}
        answerIds.push(answerId);answers.push(body);
        if(body.codeIncomplete)partial=true;
        notes.push(...(body.notes||[]));
      }
      const answerCandidates=new Set(outlines.flatMap(a=>[a.key,...(a.ids||[])]).map(archiveStableId).filter(Boolean));
      const userRecord=ids.map(x=>exportAPI.get(x)).find(a=>a?.role==='user');
      const userId=turn.role==='user' ? [userRecord?.id,snapshot?.key,turn.key,turn.id]
        .map(archiveStableId).find(x=>x&&!answerCandidates.has(x)) : null;
      const question=turn.role==='user'?(snapshot?.question?.markdown?.trim()?snapshot.question:userRecord):null;
      // No placeholder-only Q/A, no anonymous turn identities and no
      // archive under the wrong answer ID when earlier replies are absent.
      if(!anchorId||!answers.length||answerIds[0]!==anchorId||
         (turn.role==='user'&&(!userId||!question?.markdown?.trim()))||seen.has(anchorId)){
        skipped++;continue;
      }
      seen.add(anchorId);
      if(question)notes.push(...(question.notes||[]));
      if(notes.some(n=>/未取得|未完整|缺失|无法还原|未导出|不包含|仅保留|重建/.test(n)))partial=true;
      const label=turn.label||'问答';
      const body=['# '+archiveSafeMarkdownLabel(label),'> 原对话：'+scope];
      const questionTime=archiveValidTime(userRecord?.time);
      const turnTime=archiveValidTime(turn.time);
      const answerTime=archiveValidTime(anchorTime);
      const messageTime=questionTime??turnTime??answerTime;
      if(messageTime!==null)body.push('> '+(questionTime!==null?'提问时间':turnTime!==null?'消息时间':'回答时间')+'：'+new Date(messageTime).toISOString());
      else body.push('> 原始消息时间未取得；新建文件名使用首次归档时间。');
      if(partial)body.push('> 归档说明：本轮已取得部分内容；不能保证源码、附件或回答完整。');
      if(notes.length)body.push('> '+exportUnique(notes).join('\n> '));
      if(question)body.push('**提问**',question.markdown);
      for(const [i,a] of answers.entries())body.push('**回答'+(answers.length>1?' '+(i+1):'')+'**',exportRebaseAnswerHeadings(a.markdown));
      records.push({key:id+':'+(userId||'assistant')+':'+anchorId,anchorId,answerIds,
        label,messageTime,quality:partial?'partial':'complete',body:body.join('\n\n')+'\n',
        observedAt:Math.max(0,...[question,...answers].filter(Boolean).map(a=>Number(a.observedAt)||0))||observedAt});
    }
    return {id,url:scope,title,records,skipped,observedAt};
  }
  function archiveQueueFlush(delay=ARCHIVE_QUIET_MS) {
    if(archiveTimer||archiveBusy||!archivePending.size||archiveBlocked||!archiveGranted)return;
    archiveTimer=setTimeout(()=>{archiveTimer=0;void archiveFlush();},delay);
  }
  function archiveObserve(force=false) {
    if(!archiveReady||!archiveConfig?.enabled||!archiveGranted||archiveBlocked||
       currentScope!==conversationScope()||host?.dataset.disabled==='true')return;
    const id=archiveStableId(chatId());if(!id)return; // No shared or anonymous pages.
    if(archiveIsGenerating()) {
      archivePending.delete(id);archiveSignature='';
      archiveRenderStatus('等待当前回答生成完成。');return;
    }
    const title=exportTitle(),scope=conversationScope();
    const sig=scope+'|'+exportContentRevision+'|'+title+'|'+turns.map(t=>t.key).join(',');
    if(!force&&sig===archiveSignature){archiveQueueFlush();return;}
    archiveSignature=sig;
    const batch=archiveBuildBatch(id,scope,title);
    if(!batch.records.length){archiveSignature='';archiveRenderStatus('等待可识别的完整问答正文。');return;}
    // Capture immutable strings before a route switch clears the transcript
    // cache. The queue is in memory, not another persistent chat database.
    archivePending.set(id,{batch,readyAt:Date.now()+ARCHIVE_QUIET_MS});
    // Limit unsent in-memory batches; normal writes finish before this bound.
    if(archivePending.size>8)archivePending.delete(archivePending.keys().next().value);
    archiveQueueFlush();
  }
  async function archiveFlush() {
    if(archiveBusy||archiveBlocked||!archiveConfig?.enabled||!archiveGranted||!archivePending.size)return;
    const config=archiveConfig,epoch=archiveEpoch,live=()=>archiveLive(epoch,config);
    if(!live()){archiveInvalidate();archiveGranted=false;archiveRenderStatus('同步设置已变化，请恢复授权。');return;}
    archiveBusy=true;archiveRenderStatus('正在检查并写入变更文件…');
    let delay=ARCHIVE_QUIET_MS;
    try {
      await navigator.locks.request(ARCHIVE_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock){delay=3000;return;}
        if(!live())return;
        if(archivePersistent){
          const saved=await archiveStoredConfig();
          if(!saved?.enabled||saved.revision!==config.revision){archiveInvalidate();archiveGranted=false;archiveRenderStatus('同步设置已变化，请恢复授权。');return;}
        }
        if(await config.handle.queryPermission({mode:'readwrite'})!=='granted'){
          archiveGranted=false;archivePending.clear();archiveRenderStatus('目录授权已失效；请点击恢复/授权。');return;
        }
        for(const [id,item] of [...archivePending]){
          if(!live())break;
          if(archivePending.get(id)!==item||item.readyAt>Date.now())continue;
          // A new response may start before the next mutation callback.
          if(archiveStableId(chatId())===id&&archiveIsGenerating()){
            archivePending.delete(id);archiveSignature='';continue;
          }
          const result=await archiveWriteBatch(config.handle,item.batch,live);
          if(archivePending.get(id)===item)archivePending.delete(id);
          if(live())archiveRenderStatus('本次新增 '+result.created+' · 更新 '+result.updated+' · 未变 '+result.unchanged+
            ' · 保留旧版 '+result.retained+' · 冲突 '+result.conflict+' · 部分 '+result.partial+' · 未取得 '+result.skipped+'。');
        }
      });
    } catch(e) {
      if(live()){
        archiveBlocked=true;
        archiveRenderStatus('写入暂停：'+String(e.name||'Error')+'。请检查目录权限、冲突或磁盘后恢复。');
      }
    } finally {
      archiveBusy=false;archiveRenderStatus();
      if(archivePending.size&&archiveLive(epoch,config))archiveQueueFlush(delay);
    }
  }
  function initializeLocalArchive() {
    archiveRenderStatus();
    shadow.getElementById('archiveChoose').addEventListener('click',archiveChooseDirectory);
    shadow.getElementById('archiveToggle').addEventListener('click',archiveToggleEnabled);
    shadow.getElementById('archiveNow').addEventListener('click',()=>{
      archiveBlocked=false;safeUpdate(false);archiveObserve(true);archiveRenderStatus('已请求同步当前已取得的内容。');
    });
    shadow.getElementById('archiveForget').addEventListener('click',async()=>{
      if(archiveConfiguring)return;
      archiveConfiguring=true;
      try{await archiveSaveConfig(null,false,false);archiveRenderStatus('已解除目录绑定；原文件和浏览器站点权限不受删除。');}
      finally{archiveConfiguring=false;archiveRenderStatus();}
    });
    window.addEventListener('storage',e=>{
      if(e.key===ARCHIVE_SIGNAL){archiveInvalidate();archiveGranted=false;archiveRenderStatus('另一个标签页修改了同步设置。');}
      if(e.key===ARCHIVE_SIGNAL+'-saved'){archiveInvalidate();void archiveRestoreConfig();}
    });
    window.addEventListener('pagehide',()=>{archiveInvalidate();});
    window.addEventListener('pageshow',e=>{if(e.persisted&&archiveSupported())void archiveRestoreConfig();});
    if(archiveSupported())void archiveRestoreConfig();
    else{archiveReady=true;archiveRenderStatus('请使用支持目录写入与 Web Locks 的桌面 Chromium 浏览器。');}
  }

