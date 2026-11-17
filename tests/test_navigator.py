"""Offline Chromium regression suite. Network, route and browser storage are test doubles.
No user account is contacted. Private source-page fixtures are optional and not bundled.
"""
import json, re, time, sys, os, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'test-output';W.mkdir(exist_ok=True)
CHROMIUM=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('chromium-browser')
RESULT=[]
def check(name,condition,detail=None):
    row={'test':name,'passed':bool(condition)}
    if detail is not None:row['detail']=detail
    RESULT.append(row);print(('PASS ' if condition else 'FAIL ')+name, '' if detail is None else str(detail)[:180],flush=True)

SOURCE=Path(os.environ.get('NAV_SCRIPT',str(ROOT/'chatgpt-turn-navigator.user.js'))).read_text()
HOOK='''window.__test={get turns(){return turns;},update:safeUpdate,detectTurns,jumpTo,scanToRepairOrder,
getTimeline,exportBuild,exportMarkdown,normalizeFlat,normalizeTree,orderEvidence,geometry,contentTracker,navigation,
get indexCatalog(){return indexCatalog;},set indexCatalog(v){indexCatalog=v;},get apiTurns(){return apiTurns;},
set apiTurns(v){apiTurns=v;},get exportDOM(){return exportDOM;},exportTurnBody,exportMarkdownDOM,
captureReadingPoint,restoreReadingPoint,saveReadingPosition,userNavigationIntent,readingStore,
get resumePoint(){return resumePoint;},set resumePoint(v){resumePoint=v;},get expanded(){return expandedAnswers;},
get shadow(){return shadow;},loadApiIndex,acceptAPIIndex,metadataSnapshot,mergeTurns,
createGeometryEvidence,createOrderEvidence,createNavigationController,returnToPreviousPosition,
get apiComplete(){return apiComplete;},set apiComplete(v){apiComplete=v;},get apiError(){return apiError;}};'''
INSTRUMENTED=SOURCE.replace("  'use strict';","  'use strict';\n  const location=window.__fixtureLocation,localStorage=window.__fixtureLocal,sessionStorage=window.__fixtureSession;",1).replace('  if (document.body) bootstrap();',HOOK+'\n  if (document.body) bootstrap();')
W.joinpath('instrumented.js').write_text(INSTRUMENTED)
CSS='''body{margin:0;font:15px/1.6 system-ui;background:#eee}aside{width:190px;height:800px;overflow:auto;position:fixed;left:0;top:0}main{margin-left:200px;width:calc(100% - 220px)}[data-app-action-timeline-scroll]{height:800px;overflow:auto;position:relative;overflow-anchor:none;display:flex;flex-direction:column}#space{flex:none;position:relative}[data-measured-turn]{box-sizing:border-box}h2,h3{margin:0;padding:0}p{margin:8px 0}.sr-only{display:none}[data-user-message-bubble]{padding:12px;background:#ccc;max-width:85%}[data-markdown-text-style]{padding:8px}button{font:inherit}'''
def turn(i,height=1200,extra='',question=None,automated=False):
    q='' if automated else f'<div data-user-message-bubble="true"><div class="whitespace-pre-wrap">{question or "问题 "+str(i)}</div></div>'
    return f'''<div data-measured-turn style="height:{height}px"><div data-turn-key="u{i}">{q}<div data-content-search-unit-key="turn-{i}:assistant" data-chatgpt-search-message-ids="a{i}"><div data-markdown-text-style="assistant-message"><h2>章节 {i}</h2><p>完整回答 uniqueBody{i} <b>strong</b></p><h3>子标题 {i}</h3><p>尾部正文</p>{extra}</div></div></div></div>'''
def doc(body='',reverse=False,empty=False):
    main='' if empty else f'<div data-app-action-timeline-scroll style="flex-direction:{"column-reverse" if reverse else "column"}"><div id="space">{body}</div></div>'
    return f'''<!doctype html><html><head><title>测试 / Navigator - ChatGPT</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>{CSS}</style></head><body><aside data-app-action-sidebar-scroll><div style="height:6000px">侧栏</div></aside><main>{main}</main></body></html>'''
SETUP='''() => {
 const make=()=>{const data={};return {getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=String(v);},removeItem:k=>delete data[k],_data:data};};
 window.__fixtureLocal=make();window.__fixtureSession=make();
 window.__fixtureLocation={origin:'https://chatgpt.com',pathname:'/c/test-190',href:'https://chatgpt.com/c/test-190'};
 window.__fetchCalls=[];window.__clipboard=[];
 window.fetch=async(url,opts)=>{__fetchCalls.push(String(url));return new Response('{}',{status:404});};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{__clipboard.push(text);}}});
}'''
class Harness:
 def __init__(self,browser,html=None,setup=None,run=True):
    self.context=browser.new_context(viewport={'width':1500,'height':1100},accept_downloads=True)
    self.page=self.context.new_page();self.errors=[];self.warnings=[]
    self.page.on('pageerror',lambda e:self.errors.append(str(e)))
    self.page.on('console',lambda m:self.warnings.append(m.text) if m.type=='warning' else None)
    self.page.route('**/*',lambda r:r.abort())
    self.page.set_content(html or doc(''.join(turn(i) for i in range(4))))
    self.page.evaluate(SETUP)
    if setup:self.page.evaluate(setup)
    if run:self.start()
 def start(self):self.page.add_script_tag(content=INSTRUMENTED);self.page.wait_for_timeout(480)
 def ev(self,code,arg=None):return self.page.evaluate(code,arg)
 def wait(self,ms=400):self.page.wait_for_timeout(ms)
 def ui(self,selector):return self.page.locator('#chatgpt-turn-nav-userscript').locator(selector)
 def debug(self):return self.ev('chatgptTurnNavDebug()')
 def close(self,label):
    check(label+' no runtime error',not self.errors and not self.warnings,{'errors':self.errors,'warnings':self.warnings})
    self.context.close()

with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 h=Harness(b)
 check('four turns detected',h.debug()['displayedTurns']==4)
 check('TOCs collapsed by default',h.debug()['outline']['expanded']==0)
 check('default width and preferred height',h.debug()['panelLayout']['w']==360 and h.debug()['panelLayout']['preferredHeight']==950)
 h.ui('#launcher').click()
 check('panel opens',h.ui('#panel').is_visible())
 before=h.debug()['incremental'];h.ev('()=>{for(let i=0;i<20;i++)__test.update(false)}');after=h.debug()['incremental']
 check('repeated updates reuse answer outlines',after['outlineBuilds']==before['outlineBuilds'])
 check('repeated updates reuse cached Markdown',after['bodyBuilds']==before['bodyBuilds'])
 h.ev('()=>__test.jumpTo(2)');h.wait(150)
 check('jump navigates the transcript',h.ev('__test.getTimeline().scrollTop')>2000)
 check('jump never scrolls sidebar',h.ev('document.querySelector("aside").scrollTop')==0)
 h.ev("()=>__test.exportMarkdown('turn',__test.turns[0],null,'copy')");h.wait(120)
 check('copy exports both question and answer','问题 0' in h.ev('__clipboard.at(-1)') and 'uniqueBody0' in h.ev('__clipboard.at(-1)'))
 h.ev("()=>__test.exportMarkdown('all',null,null,'copy')");h.wait(120)
 check('incomplete history is labelled','未确认完整历史' in h.ev('__clipboard.at(-1)'))
 h.close('navigator smoke')
 b.close()
W.joinpath('smoke_results.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2))
print('SMOKE TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT): raise SystemExit(1)
