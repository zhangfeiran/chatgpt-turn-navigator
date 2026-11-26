  // Local-only archive writer. No network calls, clipboard access or file deletion.
  const ARCHIVE_ROOT = 'ChatGPT Markdown';
  const ARCHIVE_MARKER = '<!-- CTN-ARCHIVE-V1 ';
  function archiveStableId(value) {
    // Only persist stable message/conversation UUIDs. Never use fallback-turn-N,
    // local-N, array indices, or prompt text as identity.
    return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ?value.toLowerCase():null;
  }
  function archiveSafeName(value,limit=48) {
    let s=String(value||'').replace(/[\x00-\x1f\x7f<>:"/\\|?*\[\]()#]/g,' ')
      .replace(/\s+/g,' ').trim().replace(/^[. ]+|[. ]+$/g,'');
    s=[...s].slice(0,limit).join('').replace(/[. ]+$/g,'');
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))s='_'+s;
    return s||'未命名';
  }
  function archiveValidTime(value) {
    return Number.isFinite(value)&&value>0&&Number.isFinite(new Date(value).getTime())?value:null;
  }
  function archiveTimestampPrefix(record,batch) {
    const messageTime=archiveValidTime(record.messageTime);
    const time=messageTime??archiveValidTime(batch.observedAt)??Date.now();
    // UTC sorts chronologically even if the computer changes time zones.
    // Mark missing source timestamps instead of fabricating a message time.
    const stamp=new Date(time).toISOString().slice(0,19).replace('T','_').replace(/:/g,'-')+'Z';
    return stamp+(messageTime===null?'_首次归档':'');
  }
  function archiveHash(text) {
    return crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
      .then(bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''));
  }
  function archiveParse(text) {
    const end=text.indexOf(' -->\n');
    if(!text.startsWith(ARCHIVE_MARKER)||end<ARCHIVE_MARKER.length||end>16000)return null;
    try {
      const meta=JSON.parse(text.slice(ARCHIVE_MARKER.length,end));
      if(meta.version!==1||typeof meta.key!=='string'||!['complete','partial'].includes(meta.quality)||
         !/^[a-f0-9]{64}$/.test(meta.hash)||!Array.isArray(meta.answerIds)||!Number.isFinite(meta.observedAt))return null;
      return {meta,body:text.slice(end+5)};
    } catch (_) {return null;}
  }
  function archiveSafeMarkdownLabel(value) {
    return String(value||'').replace(/[\r\n]+/g,' ').replace(/[\\[\]<>]/g,'\\$&');
  }
  async function archiveFindFile(dir,name) {
    try{return await dir.getFileHandle(name);}
    catch(e){if(e.name==='NotFoundError')return null;throw e;}
  }
  async function archiveWriteManaged(dir,name,record,live,digest=archiveHash) {
    if(!live())return 'cancelled';
    const hash=await digest(record.body);
    let file=await archiveFindFile(dir,name),created=false,original=null;
    if(file) {
      original=await (await file.getFile()).text();
      const previous=archiveParse(original);
      // Never overwrite an unrelated file, a user-edited archive, a different
      // branch identity, or a more complete/newer snapshot.
      if(!previous||previous.meta.key!==record.key||await digest(previous.body)!==previous.meta.hash)return 'conflict';
      if(previous.meta.quality==='complete'&&record.quality==='partial')return 'retained';
      if(record.quality==='partial'&&record.body.length<previous.body.length)return 'retained';
      if(previous.meta.answerIds.some(id=>!record.answerIds.includes(id)))return 'retained';
      if(previous.meta.hash===hash&&previous.meta.quality===record.quality)return 'unchanged';
      if(previous.meta.observedAt>record.observedAt)return 'retained';
    } else {
      if(!live())return 'cancelled';
      file=await dir.getFileHandle(name,{create:true});created=true;
      // Be conservative if another process created the file in the meantime.
      if((await file.getFile()).size!==0)return 'conflict';
      original='';
    }
    if(!live())return 'cancelled';
    const meta={version:1,key:record.key,quality:record.quality,hash,answerIds:record.answerIds,observedAt:record.observedAt};
    // Detect changes since our initial read before opening the staged writer.
    if(await (await file.getFile()).text()!==original)return 'conflict';
    const writable=await file.createWritable();
    try {
      if(!live()){await writable.abort();return 'cancelled';}
      await writable.write(ARCHIVE_MARKER+JSON.stringify(meta)+' -->\n'+record.body);
      if(!live()){await writable.abort();return 'cancelled';}
      if(await (await file.getFile()).text()!==original){await writable.abort();return 'conflict';}
      if(!live()){await writable.abort();return 'cancelled';}
      await writable.close();return created?'created':'updated';
    } catch(e) {try{await writable.abort();}catch(_){}throw e;}
  }
  async function archiveConversationDir(root,batch,live) {
    if(!live())return null;
    const base=await root.getDirectoryHandle(ARCHIVE_ROOT,{create:true});
    const suffix=' -- '+batch.id;
    const matches=[];
    for await(const [name,handle] of base.entries())
      if(handle.kind==='directory'&&name.endsWith(suffix))matches.push(handle);
    if(matches.length>1)throw new Error('存在多个同一对话 ID 的目录，请保留一个后重试。');
    if(matches.length)return matches[0];
    if(!live())return null;
    return base.getDirectoryHandle(archiveSafeName(batch.title,64)+suffix,{create:true});
  }
  async function archiveWriteBatch(root,batch,live,digest=archiveHash) {
    const counts={created:0,updated:0,unchanged:0,retained:0,conflict:0,partial:0,skipped:batch.skipped||0,cancelled:0};
    if(!batch.records.length||!live())return counts;
    const dir=await archiveConversationDir(root,batch,live);if(!dir)return counts;
    const files=new Map();
    for await(const [name,handle] of dir.entries()) {
      if(handle.kind!=='file')continue;
      // Existing numbered archives, timestamp archives and renamed files
      // with the same UUID suffix all retain their original file identity.
      const match=name.match(/ -- ([0-9a-f-]{36})\.md$/i);
      if(!match)continue;
      const id=archiveStableId(match[1]);if(!id)continue;
      if(!files.has(id))files.set(id,[]);
      files.get(id).push(name);
    }
    const ordered=[],included=new Set();
    for(const record of batch.records) {
      if(!live()){counts.cancelled++;break;}
      if(record.quality==='partial')counts.partial++;
      const prior=files.get(record.anchorId)||[];
      if(prior.length>1){counts.conflict++;continue;}
      const name=prior[0]||archiveTimestampPrefix(record,batch)+' - '+archiveSafeName(record.label)+' -- '+record.anchorId+'.md';
      const result=await archiveWriteManaged(dir,name,record,live,digest);
      counts[result]++;
      if(result==='cancelled')break;
      if(['created','updated','unchanged','retained'].includes(result)){
        files.set(record.anchorId,[name]);ordered.push(name);included.add(name);
      }
    }
    if(!live())return counts;
    // An index is useful even when older turns arrive late. Keep prior files,
    // and distinguish known current order from other saved/branch records.
    const others=[...files.values()].flat().filter(n=>!included.has(n)).sort();
    const links=names=>names.map(n=>'- ['+archiveSafeMarkdownLabel(n.replace(/ -- [0-9a-f-]{36}\.md$/i,''))+']('+encodeURIComponent(n)+')').join('\n');
    const body='# '+archiveSafeMarkdownLabel(batch.title)+'\n\n> 原对话：'+batch.url+
      '\n> 当前可取得的轮次，非完整历史证明。新文件名前缀优先使用消息时间（UTC），缺失时标记首次归档时间；旧编号文件保留原名。此索引按本次已知对话顺序排列。\n\n## 本次已知轮次\n\n'+
      (links(ordered)||'（无）')+'\n\n## 其他已归档文件（含历史或分支）\n\n'+(links(others)||'（无）')+'\n';
    const index=await archiveWriteManaged(dir,'_index.md',{key:'index:'+batch.id,body,quality:'complete',answerIds:[],observedAt:batch.observedAt},live,digest);
    if(index==='conflict')counts.conflict++;
    return counts;
  }
