  const CONFIG = {
    maxTicks: 140,              // Visual markers; all turns remain reachable from the list.
    maxPromptLength: 120,
    refreshDelayMs: 320,
    minViewportWidth: 760,
    storageKey: 'chatgpt-turn-nav-enabled-v1',
    layoutKey: 'chatgpt-turn-nav-layout-v17',
    maxPanelHeight: 1100,
  };
  const CHAT_PATH = /^\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+|share\/[^/]+)/;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  let host, shadow, panel, list, search, counter, rail, track, marker, preview, jumpTop;
  let turns = [], activeIndex = 0, updateTimer = 0, scrollRaf = 0;
  let hoverCloseTimer = 0, pinned = false, currentURL = location.href, currentScope = conversationScope();
  let lastFingerprint = '', isVisible = true, lastSearch = '';
  let apiTurns = [], apiStatus = '等待读取', apiError = '', apiPages = 0, apiTruncated = false;
  let apiKey = '', apiPending = null, fetchGeneration = 0, lastAPICheck = 0;
  let jumpSerial = 0, seekingIndex = -1, lastJump = '尚未跳转';
  let returnPositions = [], mountedOnly = false, searchSelection = 0, filteredIndices = [];
  const knownLabels = new Map();
  const contentTracker=createContentTracker();
  const navigation=createNavigationController(conversationScope);
  const orderEvidence=createOrderEvidence();
  const geometry=createGeometryEvidence();
  const readingStore=createReadingStore();
  let lifecycle=null, bodySearch=false, apiCooldownUntil=0, liveTimeline=null;
  let resumePoint=null, readingTouched=false, readingTimer=0, lastReadingPoint=null;
  let exportContentRevision=0, searchBodyMemo=new Map();
  const runtimeMetrics={updates:0,renderedLists:0,errors:0};
  let lastOrderCheck = {mountedCompared:0,corrected:false,corrections:0};
  let totalOrderCorrections = 0;
  // A virtualized long conversation may mount only ONE turn at a time.
  // Record physical scroll positions of each observed turn, separately from live nodes.
  let totalSpatialCorrections=0, lastSpatialCheck={observed:0,corrected:false,corrections:0};
  let scanBusy=false, scanToken=null, scanLastSteps=0, scanLastSeen=0;
  // Keep identity/labels/TOCs separately from live DOM. Virtualization is NOT deletion.
  // No message text or heading text is written to localStorage/sessionStorage.
  let indexCatalog = [], apiComplete = false, apiFailures = 0, apiRetryAt = 0;
  let apiController = null, apiOutlineErrors = 0;
  const anonymousDOMKeys = new WeakMap(); let anonymousDOMSerial = 0;
  function conversationScope() {
    // An anchor or tracking query is not a different conversation.
    return location.origin + location.pathname.replace(/\/$/, '');
  }
  function syncFilterButton() {
    const button = shadow?.getElementById('mountedOnly');
    if (!button) return;
    button.setAttribute('aria-pressed', String(mountedOnly));
    button.textContent = mountedOnly ? '仅已加载' : '全部轮次';
    button.title = mountedOnly ? '当前隐藏未加载轮次；点击恢复全部已索引轮次' : '当前显示全部已索引轮次；点击仅显示正文已加载轮次';
  }

  // v1.7 uses a new layout key so the requested defaults apply on upgrade.
  // Preferred dimensions are stored separately from the viewport-fitted size.
  const defaultLayout = () => ({ y: Math.round(innerHeight*.05), yPct:5, w:360, h:950 });
  let layout=defaultLayout(), effectiveLayout={...layout};
  try {
    const saved=JSON.parse(localStorage.getItem(CONFIG.layoutKey)||'{}');
    for(const k of ['y','yPct','w','h']) if(typeof saved[k]==='number' && Number.isFinite(saved[k])) layout[k]=saved[k];
  } catch (_) {}

  try { isVisible = localStorage.getItem(CONFIG.storageKey) !== '0'; } catch (_) {}

