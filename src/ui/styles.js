  const styles = `
    :host { --tn-bg:#17191f;--tn-text:#edf0f5;--tn-muted:#a0a8b6;
      --tn-border:#353b46;--tn-hover:#282e39;--tn-active:#263f3c;
      --tn-accent:#52d4aa;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
      color:var(--tn-text);color-scheme:dark; }
    * { box-sizing:border-box; }
    button,input { font:inherit; }
    button { cursor:pointer; }
    #launcher { position:fixed;right:0;top:5%;z-index:2147483200;
      display:flex;align-items:center;justify-content:center;width:33px;height:33px;
      color:var(--tn-text);background:var(--tn-bg);border:1px solid var(--tn-border);
      border-radius:11px;box-shadow:0 3px 16px rgba(0,0,0,.11); }
    #launcher:hover,#launcher:focus-visible { background:var(--tn-hover);outline:2px solid transparent; }
    #launcher svg { width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round; }
    #rail { position:fixed;right:0;top:calc(5% + 43px);width:33px;
      height:min(64vh,600px);min-height:140px;z-index:2147483200;
      background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:15px;
      padding:12px 4px;box-shadow:0 3px 16px rgba(0,0,0,.11); }
    #track { width:100%;height:100%;position:relative;cursor:pointer;touch-action:pan-y; }
    #track:before { content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;
      background:var(--tn-border);transform:translateX(-50%); }
    .tick { position:absolute;left:50%;width:11px;height:2px;border-radius:2px;
      background:var(--tn-muted);opacity:.58;transform:translate(-50%,-50%);pointer-events:none; }
    #marker { position:absolute;left:50%;height:5px;width:21px;border-radius:4px;
      background:var(--tn-accent);transform:translate(-50%,-50%);pointer-events:none;
      box-shadow:0 0 0 2px var(--tn-bg); }
    #preview { position:fixed;right:51px;max-width:290px;width:max-content;padding:8px 11px;
      background:var(--tn-bg);color:var(--tn-text);border:1px solid var(--tn-border);
      box-shadow:0 5px 22px rgba(0,0,0,.16);border-radius:9px;z-index:2147483201;
      pointer-events:none;display:none;white-space:normal;overflow-wrap:anywhere; }
    #panel { position:fixed;right:0;left:auto;top:5%;width:min(360px,calc(100vw - 8px));
      height:min(90vh,950px);min-height:240px;z-index:2147483202;display:none;
      background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:15px;
      box-shadow:0 14px 40px rgba(0,0,0,.4);overflow:hidden;flex-direction:column;resize:none;
      min-width:285px;max-width:calc(100vw - 8px);max-height:calc(100vh - 16px); }
    #panel.open { display:flex; }
    #resizeHandle { position:absolute;bottom:0;left:0;width:27px;height:27px;z-index:20;border:0;background:transparent;cursor:nesw-resize;touch-action:none; }
    #resizeHandle::after {content:"";position:absolute;left:5px;bottom:5px;width:12px;height:12px;border-left:2px solid #9daabd;border-bottom:2px solid #9daabd;pointer-events:none;opacity:.9;}
    #resizeHandle:hover::after {border-color:var(--tn-accent);}
    .head { display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px;
      gap:10px;cursor:grab;touch-action:none;user-select:none;border-bottom:1px solid var(--tn-border); }
    .head:active { cursor:grabbing; }
    .head button { cursor:pointer; }
    .head-controls {display:flex;align-items:center;gap:3px}
    .gear {font-size:15px!important;}
    .settings {display:none;padding:9px 13px;border-bottom:1px solid var(--tn-border);gap:8px;}
    .settings.open {display:grid;}
    .settings label {display:grid;grid-template-columns:55px 1fr 45px;align-items:center;gap:8px;font-size:11px;color:var(--tn-muted)}
    .settings input {width:100%;accent-color:var(--tn-accent)}
    .settings output {text-align:right;font-variant-numeric:tabular-nums}
    .setting-actions { display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap; }
    .setting-actions button {background:var(--tn-hover);border:1px solid var(--tn-border);color:var(--tn-text);border-radius:7px;padding:5px 9px;font-size:11px}
    .setting-actions button:hover {border-color:var(--tn-accent)}
    .drag-hint {font-size:10px;color:var(--tn-muted);white-space:nowrap;}
    .title { font-weight:680;font-size:14px;display:flex;gap:7px;align-items:center; }
    .count { color:var(--tn-muted);font-size:11px;white-space:nowrap; }
    .close { background:transparent;border:0;color:var(--tn-muted);font-size:19px;line-height:1;
      width:24px;height:24px;border-radius:7px; }
    .close:hover { background:var(--tn-hover); }
    .search { display:block;margin:3px 10px 5px;width:calc(100% - 20px);border-radius:10px;
      border:1px solid var(--tn-border);background:transparent;padding:9px 10px;color:var(--tn-text);
      outline:none; }
    .search:focus { border-color:var(--tn-accent); }
    /* One toolbar row for search scope, loaded-only filter, answer TOC actions. */
    .compact-toolbar {display:flex;align-items:center;gap:4px;padding:0 9px 5px;min-width:0;flex:none;white-space:nowrap}
    .compact-toolbar #searchScope {flex:1 1 80px;width:auto;min-width:65px;max-width:none;padding:4px 2px}
    .compact-toolbar #mountedOnly {flex:0 0 60px;min-width:0;white-space:nowrap;padding:4px 2px;font-size:11px}
    .compact-toolbar .toc-tool {flex:0 0 34px;width:34px;min-width:0;padding:3px 0;font-size:16px;line-height:18px}
    /* Keep result counts available to screen readers without taking a row. */
    #searchMeta {position:absolute!important;width:1px;height:1px;clip:rect(0,0,0,0);clip-path:inset(50%);overflow:hidden;white-space:nowrap}
    .chip {font-size:11px;color:var(--tn-muted);border:1px solid var(--tn-border);background:transparent;border-radius:7px;flex:none;padding:3px 8px}
    .chip[aria-pressed="true"] {color:var(--tn-accent);border-color:var(--tn-accent);background:#214037}
    .chip:hover {border-color:var(--tn-accent)}
    #list { flex:1;overflow:auto;overscroll-behavior:contain;padding:2px 7px 9px;scrollbar-width:thin; }
    .item { display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;
      background:transparent;border:0;border-radius:9px;padding:9px 8px;
      color:var(--tn-text);overflow-wrap:anywhere; }
    .item:hover,.item:focus-visible { background:var(--tn-hover);outline:none; }
    .item.active { background:var(--tn-active); }
    .item.search-selected:not(.active) {background:var(--tn-hover);outline:1px solid #486957;outline-offset:-1px}
    .item .dot {width:6px;height:6px;flex:none;border-radius:50%;background:#69727f;margin-top:8px}
    .item .dot.mounted {background:var(--tn-accent)}
    .item mark {background:#80692a;color:#fff3b4;border-radius:2px;padding:0 1px}
    .num { flex:none;color:var(--tn-muted);font-size:11px;min-width:27px;font-variant-numeric:tabular-nums;
      padding-top:2px; }
    .label { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
      overflow:hidden;line-height:1.45; }
    .foot { border-top:1px solid var(--tn-border);padding:5px 8px 6px 28px; }
    /* Feedback appears as a transient overlay; never consumes permanent list height. */
    .hint {position:absolute;left:8px;right:8px;bottom:43px;z-index:28;
      background:#252d37;border:1px solid #465263;color:var(--tn-text);border-radius:8px;
      padding:8px 10px;font-size:11px;line-height:1.45;max-height:95px;overflow:auto;
      box-shadow:0 6px 18px #0009;pointer-events:none;}
    .actions {display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:3px;}
    .action {display:flex;align-items:center;justify-content:center;min-width:0;height:30px;
      border:1px solid var(--tn-border);border-radius:6px;background:transparent;
      color:var(--tn-text);padding:0;font-size:16px;line-height:1;white-space:nowrap;}
    .action:hover:not(:disabled) { background:var(--tn-hover); }
    .action:disabled {opacity:.4;cursor:not-allowed}
    .empty { color:var(--tn-muted);text-align:center;padding:24px 8px; }
    :host([data-hidden="true"]) #rail { display:none; }
    :host([data-disabled="true"]) #launcher,
    :host([data-disabled="true"]) #rail,
    :host([data-disabled="true"]) #panel,
    :host([data-disabled="true"]) #preview { display:none !important; }
    #panel {border-radius:14px 0 0 14px;min-height:0;max-height:90vh;}
    .head,.foot,.settings,.search,.compact-toolbar {flex-shrink:0;}
    #list {min-height:0;overflow-anchor:none;padding-bottom:12px;}
    .title {min-width:0;font-size:13px;gap:6px;}
    .turn-group {padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid #2c313b;}
    .turn-group:last-child {border-bottom:0;}
    .answer-outline {margin:2px 0 2px 31px;border-left:1px solid #3b4351;padding-left:5px;}
    .toc-head {display:flex;align-items:center;gap:2px;min-height:29px;}
    .wrap-button {flex:none;width:27px;height:25px;padding:0;border:1px solid var(--tn-border);
      border-radius:6px;background:transparent;color:var(--tn-muted);font-size:17px;line-height:1;cursor:pointer;}
    .wrap-button:hover {background:var(--tn-hover);color:var(--tn-text);}
    .wrap-button[aria-pressed="true"] {background:#214037;border-color:var(--tn-accent);color:var(--tn-accent);}
    .toc-row.toc-auto-root > .toc-link {box-shadow:inset 2px 0 #567e76;}
    .toc-toggle {display:flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--tn-muted);padding:4px 3px;min-width:0;flex:1;text-align:left;font-size:11px;border-radius:5px;}
    .toc-toggle:hover,.answer-top:hover,.toc-node-toggle:hover {background:var(--tn-hover);color:var(--tn-text);}
    .toc-count {color:#8995a8;font-size:10px;margin-left:auto;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}
    .toc-depth-actions {display:flex;align-items:center;flex:none;gap:2px;}
    .toc-depth-button {height:23px;min-width:25px;padding:0 2px;background:transparent;color:#aab7ca;
      border:1px solid var(--tn-border);border-radius:5px;font-size:10px;font-weight:600;line-height:1;}
    .toc-depth-button:hover,.toc-depth-button:focus-visible {background:var(--tn-hover);color:var(--tn-text);}
    .toc-depth-button[aria-pressed="true"] {background:#214037;border-color:var(--tn-accent);color:var(--tn-accent);}
    .toc-head:has(.toc-depth-button) .toc-count {display:none;}
    .chevron {width:12px;flex:none;}
    .answer-top {border:0;background:transparent;color:var(--tn-muted);width:24px;height:26px;border-radius:5px;flex:none;}
    .toc-row {display:flex;align-items:flex-start;gap:1px;}
    .toc-node-toggle {border:0;background:transparent;color:var(--tn-muted);width:17px;min-width:17px;height:27px;padding:0;border-radius:4px;font-size:11px;}
    .toc-link {display:flex;align-items:baseline;gap:6px;width:100%;min-width:0;text-align:left;border:0;background:transparent;color:#bac4d2;border-radius:6px;padding:5px 4px;font-size:12px;line-height:1.45;}
    .toc-link:hover {background:var(--tn-hover);color:var(--tn-text);}
    .toc-link.section-active {background:#203b36;color:#7ce4c1;box-shadow:inset 2px 0 var(--tn-accent);}
    .toc-link.search-selected {outline:1px solid #648875;outline-offset:-1px;background:var(--tn-hover);}
    .toc-level {font-size:9px;font-variant-numeric:tabular-nums;color:#8795a8;flex:none;}
    .toc-text {overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
    /* Opt-in full wrapping for questions and TOC heading labels, not the body. */
    :host([data-wrap-titles="true"]) .label,
    :host([data-wrap-titles="true"]) .toc-text {
      display:block;-webkit-line-clamp:unset;-webkit-box-orient:initial;
      white-space:normal;overflow:visible;overflow-wrap:anywhere;word-break:break-word;
    }
    .toc-empty {font-size:11px;color:var(--tn-muted);padding:5px 7px 7px;}
    .toc-link mark {background:#80692a;color:#fff3b4;border-radius:2px;padding:0 1px;}
    button:focus-visible {outline:2px solid var(--tn-accent);outline-offset:-2px;}
    .settings {max-height:38vh;overflow:auto;}

    .turn-top {display:flex;align-items:flex-start;gap:1px;}
    .turn-top > .item {flex:1;min-width:0;}
    .turn-export {flex:none;align-self:center;border:1px solid transparent;border-radius:5px;background:transparent;
      color:var(--tn-muted);font-size:10px;padding:5px 3px;min-width:30px;line-height:1.3;}
    .turn-export:hover,.turn-export:focus-visible {border-color:var(--tn-accent);color:var(--tn-accent);background:var(--tn-hover);}
    [data-export-action]:disabled {opacity:.45;cursor:progress;}
    .coverage {flex:none;padding:0 10px 3px;color:var(--tn-muted);font-size:10px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #searchScope {max-width:108px;min-width:0;font:11px system-ui;color:var(--tn-text);background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:6px;padding:4px;}
    .body-snippet {font-size:11px;color:#abb7c8;margin:2px 7px 6px 35px;line-height:1.5;overflow-wrap:anywhere;}
    .body-snippet mark {background:#80692a;color:#fff3b4;}
    .md-actions {position:fixed;z-index:2147483300;width:200px;padding:5px;background:#202630;border:1px solid #566274;border-radius:9px;box-shadow:0 5px 22px #0008;}
    .md-actions button {display:block;border:0;background:transparent;color:var(--tn-text);text-align:left;width:100%;padding:9px 8px;border-radius:5px;font:12px system-ui;}
    .md-actions button:hover {background:var(--tn-hover);color:var(--tn-accent);}
    .copy-fallback {position:absolute;inset:48px 8px 20px;z-index:30;background:var(--tn-bg);border:1px solid var(--tn-border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;}
    .copy-fallback p {font-size:12px;margin:0;color:var(--tn-muted);}
    .copy-title {font-weight:650;}
    .copy-fallback textarea {width:100%;min-height:70px;flex:1;resize:none;background:#101318;color:var(--tn-text);border:1px solid #566274;font:11px/1.4 monospace;}
    .copy-fallback button {background:var(--tn-hover);border:1px solid var(--tn-border);color:var(--tn-text);padding:7px;border-radius:6px;margin-right:6px;}
    [hidden] {display:none!important;}
    @media(max-width:760px) { #rail{height:48vh}#panel{height:68vh} }

  `;

