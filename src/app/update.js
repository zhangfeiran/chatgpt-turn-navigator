  function isChatPage() { return CHAT_PATH.test(location.pathname); }
  function update(force = false) {
    runtimeMetrics.updates++;
    lifecycle?.flush();
    if (!host?.isConnected) document.body?.appendChild(host);
    currentURL=location.href;
    if (currentScope !== conversationScope()) {
      currentScope=conversationScope(); fetchGeneration++; jumpSerial++; seekingIndex = -1;
      apiController?.abort();apiController=null;
      navigation.cancel('conversation');geometry.reset();orderEvidence.reset();contentTracker.reset();
      liveTimeline=null;apiCooldownUntil=0;searchBodyMemo.clear();
      if(shadow){shadow.getElementById('copyFallback').hidden=true;shadow.getElementById('copyText').value='';shadow.getElementById('mdActions').hidden=true;}
      resumePoint=readingStore.load(conversationScope());readingTouched=false;lastReadingPoint=null;
      clearTimeout(readingTimer);syncReadingButton();
      resetExportState();
      indexCatalog=[];apiComplete=false;apiFailures=0;apiRetryAt=0;apiOutlineErrors=0;
      scanToken && (scanToken.cancelled=true);
      totalOrderCorrections=0;lastOrderCheck={mountedCompared:0,corrected:false,corrections:0};
      totalSpatialCorrections=0;lastSpatialCheck={observed:0,corrected:false,corrections:0};
      apiKey = ''; apiTurns = []; apiPending = null;
      apiStatus = '等待读取'; apiError = ''; apiPages = 0; apiTruncated=false;
      knownLabels.clear(); lastFingerprint = '';
      pinned = false; togglePanel(false);
      search.value = ''; lastSearch = '';
      returnPositions = []; updateReturnButton();
      mountedOnly = false; searchSelection = 0; filteredIndices = [];
      syncFilterButton();
      activeIndex = 0; activeSectionKey=''; navigationTargets=[]; answerCache.clear(); loadOutlineState(); hintUntil=0;
      clearTimeout(hintTimer);hintTimer=0;const hintEl=shadow?.getElementById('hint');if(hintEl)hintEl.hidden=true;
    }
    host.dataset.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const dom = detectTurns();
    const enabled = (isChatPage() || dom.length > 0) && innerWidth >= CONFIG.minViewportWidth && isVisible;
    host.dataset.disabled = enabled ? 'false' : 'true';
    if (!enabled) return;
    const previousActive=turns[activeIndex];
    turns = mergeTurns(dom).map(enrichTurn);
    if(previousActive) {
      const ids=new Set(turnIds(previousActive)), found=turns.findIndex(t=>turnIds(t).some(id=>ids.has(id)));
      if(found>=0) activeIndex=found;
    }
    for(const turn of turns) {
      try { captureExportDOM(turn); } catch (_) { /* Export capture must not block the navigator. */ }
    }
    indexCatalog=turns.map(metadataSnapshot);
    // Retain outlines, not detached DOM trees. The live turns array owns live nodes.
    for(const t of indexCatalog) if(t.answers.length) answerCache.set(t.key,t.answers);
    host.dataset.hidden = turns.length < 2 ? 'true' : 'false';
    counter.textContent = `${turns.length ? Math.min(activeIndex+1,turns.length) + ' / ' : ''}${turns.length} 轮`;
    const unmounted=turns.filter(t=>!t.node).length, mounted=turns.length-unmounted;
    syncFilterButton();
    // Routine indexing details are available in #coverage and diagnostics, not the footer.
    const fingerprint = (bodySearch&&lastSearch?String(exportContentRevision):'')+turns.map(t => `${t.key}:${t.label}:${t.role}:${!!t.node}:`+(t.answers||[]).map(a=>`${a.key}:${a.source}:`+a.headings.map(h=>`${h.level}:${h.text}:${!!h.node?.isConnected}`).join('|')).join('~')).join('\u0001');
    if (force || fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint; renderTicks();
      if (panel.classList.contains('open')) renderList();
    }
    updateActive();updateCoverage();syncReadingButton();
    if (chatId() && !apiPending && apiKey !== `${location.origin}:${chatId()}`) {
      // Read once per conversation, not on every DOM mutation.
      setTimeout(() => loadApiIndex(), 150);
    }
  }
  function scheduleUpdate() {
    // Throttle instead of trailing-only debounce: streaming never starves indexing.
    if(updateTimer) return;
    updateTimer=setTimeout(()=>{updateTimer=0;safeUpdate();},CONFIG.refreshDelayMs);
  }

