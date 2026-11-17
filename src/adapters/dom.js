  const SHELL_SELECTOR = '[data-turn-key], [data-testid^="conversation-turn-"], [data-turn-id][data-turn]';
  const USER_SELECTOR = '[data-user-message-bubble="true"], [data-message-author-role="user"], [data-role="user"], [data-message-author="user"], [data-testid="user-message"]';
  const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"], [data-role="assistant"]';
  function getTimeline() {
    // NEVER select an arbitrary overflow-y-auto: the first matching node is the sidebar.
    if(liveTimeline?.isConnected) return liveTimeline;
    const exact = document.querySelector('[data-app-action-timeline-scroll]');
    if (exact) return (liveTimeline=exact);
    const named = document.querySelector('.thread-scroll-container, [data-testid="conversation-scroll-container"]');
    if (named && !named.closest('nav, aside, [data-app-action-sidebar-scroll]')) return (liveTimeline=named);
    const target = document.querySelector('[data-thread-find-target="conversation"]');
    for(let p=target?.parentElement;p;p=p.parentElement) {
      if (p.closest('nav, aside, [data-app-action-sidebar-scroll]')) return null;
      const css=getComputedStyle(p);
      if (/(auto|scroll)/.test(css.overflowY) && p.scrollHeight>p.clientHeight) return (liveTimeline=p);
    }
    return null;
  }
  function normalizedText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function getPromptText(node) {
    if (!node) return '';
    const user = node.matches(USER_SELECTOR) ? node : node.querySelector(USER_SELECTOR);
    if (!user) return '';
    const body = user.querySelector('[data-search-result-target] .text-size-chat, .text-size-chat.whitespace-pre-wrap, [data-search-result-target], .whitespace-pre-wrap') || user;
    return normalizedText(body).slice(0, CONFIG.maxPromptLength);
  }
  function getAssistantSummary(node) {
    // Saved 2026 automation pages mark assistant output with a search-unit key,
    // not a user bubble. The visible answer headline is more useful than an empty '问题'.
    const unit = node.querySelector('[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"], [data-conversation-role="assistant"]');
    if (!unit) return '';
    const title = node.querySelector('[data-chatgpt-search-unit-key$=":assistant"] button span.truncate');
    const taskName = normalizedText(title);
    const headline = unit.querySelector('h1,h2,h3,[class*="markdown"] h4,p,[data-message-content]') ||
      node.querySelector('[data-conversation-role="assistant"]')?.parentElement?.querySelector('h1,h2,h3,p');
    let snippet = normalizedText(headline);
    if (!snippet) {
      // Avoid copying button text, citations and the entire long AI answer.
      const content = unit.querySelector('.markdown, [class*="markdown"], .prose');
      snippet = normalizedText(content).slice(0, 90);
    }
    if (snippet === 'ChatGPT said:' || /^ChatGPT said:/.test(snippet)) snippet = '';
    return [taskName, snippet].filter(Boolean).join(' · ').slice(0, CONFIG.maxPromptLength);
  }
  function formatTurnTime(node) {
    const raw = node.querySelector('time[datetime]')?.getAttribute('datetime');
    if (!raw) return '';
    const date = new Date(raw);
    if (!Number.isFinite(date.valueOf())) return '';
    // Browser local timezone, consistent with the visible ChatGPT timestamps.
    return `${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function turnTime(node) {
    const raw = node.querySelector('time[datetime]')?.getAttribute('datetime');
    const time = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(time) ? time : null;
  }
  function isUserShell(shell) {
    if (shell.hasAttribute('data-turn-key')) return true; // Includes scheduled assistant-only turns.
    const role=(shell.getAttribute('data-turn')||'').toLowerCase();
    if (role==='user') return true;
    if (role==='assistant') return true; // Assistant-only announcements are navigable too.
    return !!shell.querySelector(USER_SELECTOR) || !!shell.querySelector('[data-chatgpt-search-unit-key$=":assistant"]');
  }
  function getMessageIdsInDOM(node) {
    if (!node) return [];
    const ids = new Set();
    const key = node.closest('[data-turn-key]') || node.querySelector('[data-turn-key]');
    if (key?.getAttribute('data-turn-key')) ids.add(key.getAttribute('data-turn-key'));
    for(const unit of node.querySelectorAll('[data-chatgpt-search-message-ids]'))
      for (const id of (unit.getAttribute('data-chatgpt-search-message-ids') || '').split(/\s+/)) if (id) ids.add(id);
    for(const el of [node,...node.querySelectorAll('[data-message-id], [data-message-uuid]')])
      for (const attr of ['data-message-id','data-turn-id','data-message-uuid']) if (el.getAttribute(attr)) ids.add(el.getAttribute(attr));
    return [...ids];
  }
  function getMessageIdFromDOM(node) {
    return getMessageIdsInDOM(node)[0] || '';
  }
  function detectTurns() {
    const timeline=getTimeline();
    if (!timeline) return [];
    const shells=[...timeline.querySelectorAll(SHELL_SELECTOR)];
    let nodes=shells.filter(isUserShell);
    if (!nodes.length) {
      nodes=[...timeline.querySelectorAll(USER_SELECTOR+', [data-chatgpt-search-unit-key$=":assistant"]')]
        .map(el => el.closest(SHELL_SELECTOR)||el);
    }
    const unique=[];
    for(const node of nodes) {
      if(unique.some(n => n===node || n.contains(node))) continue;
      unique.push(node);
    }
    return unique.map((node,i)=>{
      const ids = getMessageIdsInDOM(node);
      const id = ids[0] || '';
      if (!id && !anonymousDOMKeys.has(node)) anonymousDOMKeys.set(node, `local-${++anonymousDOMSerial}`);
      const key = id || anonymousDOMKeys.get(node);
      const prompt = getPromptText(node);
      const automated = !(node.matches(USER_SELECTOR)||node.querySelector(USER_SELECTOR));
      const timestamp = turnTime(node);
      let label = prompt;
      if (automated) {
        const stamp = formatTurnTime(node);
        const summary = getAssistantSummary(node) || '助手回复（无用户提问）';
        label = `⏱ ${stamp ? stamp+' · ' : ''}${summary}`;
      }
      if (label) knownLabels.set(key,label);
      const fallbackKey=node.querySelector('[data-chatgpt-search-unit-key^="fallback-turn-"]')?.getAttribute('data-chatgpt-search-unit-key') || '';
      const ordinalMatch=fallbackKey.match(/^fallback-turn-(\d+):/);
      return {node,id,key,ids,role:automated?'assistant':'user',time:timestamp,
        fallbackOrdinal:ordinalMatch ? Number(ordinalMatch[1]) : null,
        label:label || knownLabels.get(key) || `轮次 ${i+1}（内容尚未渲染）`,source:'dom'};
    });
  }
  // Outline state is per tab/conversation. Only IDs + fold states are persisted;
  // answer text and heading text stay in memory, never in local/session storage.
