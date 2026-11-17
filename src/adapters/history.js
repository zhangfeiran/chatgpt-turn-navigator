  async function requestChatJSON(url, token, signal) {
    const headers={accept:'application/json'};
    if(token) headers.authorization=`Bearer ${token}`;
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,15000);
    try {
      const response=await fetch(url,{credentials:'include',headers,cache:'no-store',signal:controller.signal});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function loadApiIndex(force=false) {
    const id=chatId();if(!id){apiStatus='非私人对话页面';return;}
    const key=`${location.origin}:${id}`;
    if(apiPending && apiKey===key) return apiPending;
    if(!force && apiKey===key && (apiTurns.length || apiError) && (!apiRetryAt || Date.now()<apiRetryAt)) return;
    if(!force&&Date.now()<apiCooldownUntil)return;
    if(force)apiCooldownUntil=0;
    apiKey=key;apiRetryAt=0;
    const generation=++fetchGeneration, scope=conversationScope();
    apiController?.abort();const controller=new AbortController();apiController=controller;
    apiStatus='正在读取历史索引';apiError='';apiPages=0;apiTruncated=false;
    const stale=()=>generation!==fetchGeneration || scope!==conversationScope() || key!==apiKey;
    const publish=(result,complete=false)=>{
      if(stale() || !result.length) return;
      acceptAPIIndex(result,complete); update(true);
    };
    const run=async()=>{
      let token, tokenAttempted=false, result=[], complete=false, firstError=null;
      const request=async url=>{
        if(stale()) throw new Error('对话已切换');
        try {return await requestChatJSON(url,token,controller.signal);}
        catch(err) {
          if(stale() || tokenAttempted || !/HTTP (401|403)/.test(String(err))) throw err;
          tokenAttempted=true;
          const session=await requestChatJSON('/api/auth/session',undefined,controller.signal);
          token=session?.accessToken;if(!token) throw err;
          return await requestChatJSON(url,token,controller.signal);
        }
      };
      try {
        let cursor='', records=[], visited=new Set();
        for(let page=0;page<100;page++) {
          let url=`/backend-api/conversations/${encodeURIComponent(id)}?include_has_versions=true&num_turns=100`;
          if(cursor) url+=`&before=${encodeURIComponent(cursor)}`;
          const data=await request(url);if(stale()) return;apiPages++;
          if(data?.mapping) {result=normalizeTree(data);complete=!!result.length;break;}
          if(!Array.isArray(data?.messages)) throw new Error('历史消息结构未识别');
          records=[...data.messages,...records];result=normalizeFlat(records);
          publish(result,false); // Keep every successfully read page, even if the next page fails.
          const info=data.page_info;
          if(info?.has_previous_page===false) {complete=true;break;}
          if(info?.has_previous_page!==true) throw new Error('分页信息缺失，无法确认目录完整性');
          const next=info.start_cursor;
          if(!next || visited.has(next)) throw new Error('分页游标缺失或重复');
          visited.add(next);cursor=next;
          if(page===99) throw new Error('达到分页读取上限');
        }
        if(!result.length) throw new Error('未收到可解析的对话消息');
      } catch(err) {firstError=err;}
      if(stale()) return;
      if(firstError) {
        try {
          const older=await request(`/backend-api/conversation/${encodeURIComponent(id)}`);
          if(stale()) return;apiPages++;
          const fallback=older?.mapping?normalizeTree(older):normalizeFlat(older?.messages || []);
          if(!fallback.length) throw new Error('旧接口未返回可解析的对话消息');
          complete=!!older?.mapping || older?.page_info?.has_previous_page===false;
          result=complete?fallback:mergeIndexSequences(result,fallback);
          publish(result,complete);
          if(!complete) throw new Error('备用接口亦未确认历史完整性');
        } catch(err) {
          publish(result,false);apiTruncated=true;
          throw new Error(`分页接口：${firstError.message}；备用接口：${err.message}`);
        }
      }
      if(stale()) return;
      publish(result,complete);apiStatus=complete?'历史目录已读取':'目录可能不完整';
      apiComplete=complete;apiTruncated=!complete;apiFailures=0;apiRetryAt=0;
      lastAPICheck=Date.now();update(true);
    };
    // Start on the next microtask so update() always sees apiPending set.
    apiPending=Promise.resolve().then(run).catch(err=>{
      if(stale()) return;
      apiStatus='历史读取暂不可用';apiError=String(err.message || err).slice(0,180);
      apiComplete=false;apiTruncated=true;apiFailures++;
      const delays=[3000,10000,30000];
      const unavailable=(String(err.message||err).match(/HTTP (?:404|410)/g)||[]).length>=2;
      if(unavailable){apiCooldownUntil=Date.now()+300000;apiRetryAt=0;}
      else apiRetryAt=apiFailures<=delays.length?Date.now()+delays[apiFailures-1]:0;
      update(true);
    }).finally(()=>{if(!stale()) {apiPending=null;if(apiController===controller) apiController=null;}});
    return apiPending;
  }
  window.chatgptTurnNavDebug = diagnose;
