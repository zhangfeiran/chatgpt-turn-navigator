from pathlib import Path
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text().split('with sync_playwright() as p:')[0])
# Regenerate instrumented script from the final source above; all test accessors stay out of the release.
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
 # API pagination fails halfway: keep obtained text and label partial.
 records=[{'id':'u4','role':'user','content':{'parts':['late question']}},{'id':'a4','role':'assistant','content':{'parts':['late response']}}]
 setup='''()=>{window.fetch=async url=>{__fetchCalls.push(url);if(!String(url).includes('&before=')&&String(url).includes('/conversations/'))return new Response(JSON.stringify({messages:DATA,page_info:{has_previous_page:true,start_cursor:'earlier'}}));return new Response('{}',{status:404});};}'''.replace('DATA',json.dumps(records))
 h=Harness(b,doc(''),setup=setup);h.wait()
 check('pagination failure retains acquired round',h.debug()['displayedTurns']==1 and not h.debug()['indexState']['apiComplete'])
 h.ev("()=>__test.exportMarkdown('all',null,null,'copy')");text=h.ev('__clipboard.at(-1)')
 check('partial pagination retains body and marks incomplete','late response' in text and '未确认完整历史' in text)
 h.close('partial pagination')
 # A selected tree may include hidden reasoning and tool nodes between visible messages.
 h=Harness(b,doc(''))
 tree={'current_node':'n-final','mapping':{
   'n-user':{'id':'n-user','parent':None,'message':{'id':'m-user','author':{'role':'user'},'content':{'parts':['question']}}},
   'n-analysis':{'id':'n-analysis','parent':'n-user','message':{'id':'m-analysis','author':{'role':'assistant'},'channel':'analysis','content':{'parts':['PRIVATE_ANALYSIS']}}},
   'n-tool':{'id':'n-tool','parent':'n-analysis','message':{'id':'m-tool','author':{'role':'tool'},'content':{'parts':['TOOL_OUTPUT']}}},
   'n-final':{'id':'n-final','parent':'n-tool','message':{'id':'m-final','author':{'role':'assistant'},'content':{'parts':['visible answer']}}}}}
 out=h.ev('(t)=>__test.normalizeTree(t).map(t=>({role:t.role,ids:t.ids,answers:t.answers.map(a=>a.key)}))',tree)
 check('tree traverses hidden parent nodes to pair Q/A',len(out)==1 and out[0]['ids']==['m-user','m-final'],out)
 check('hidden parent nodes remain excluded from export identity','m-analysis' not in str(out) and 'm-tool' not in str(out))
 h.close('tree ancestry')
 # Waiting export cannot cross a route change and produce the wrong conversation.
 h=Harness(b,doc(''),run=False)
 h.ev('''()=>{window.__release=null;window.fetch=url=>{__fetchCalls.push(url);return new Promise(r=>window.__release=()=>r(new Response(JSON.stringify({messages:[{id:'old',role:'assistant',content:{parts:['OLD DATA']}}],page_info:{has_previous_page:false}}))));};}''')
 h.start();h.ev("()=>{void __test.exportMarkdown('all',null,null,'copy')}")
 h.ev("()=>{__fixtureLocation.pathname='/c/new';__fixtureLocation.href='https://chatgpt.com/c/new';__test.update(false);window.fetch=async()=>new Response('{}',{status:404});__release?.();}");h.wait(600)
 check('route change cancels pending old export',not h.ev('__clipboard.length') and not h.debug()['markdownExport']['busy'])
 h.close('stale export')
 # Stream update and nested heading toggle, search expansion restoration.
 h=Harness(b)
 h.ui('#launcher').click();check('answer outline initially collapsed',h.ui('.toc-toggle').nth(0).get_attribute('aria-expanded')=='false')
 h.ui('.toc-toggle').nth(0).click();check('manual outline expansion works',h.ui('.toc-toggle').nth(0).get_attribute('aria-expanded')=='true')
 h.ui('.toc-toggle').nth(0).click();check('manual outline collapse works',h.ui('.toc-toggle').nth(0).get_attribute('aria-expanded')=='false')
 h.ui('.toc-toggle').nth(0).click();h.ui('#search').fill('子标题 0')
 check('heading search temporarily expands',h.ui('.toc-toggle').nth(0).get_attribute('aria-expanded')=='true')
 h.ui('#search').fill('');check('clearing search restores collapsed state',h.ui('.toc-toggle').nth(0).get_attribute('aria-expanded')=='false')
 h.ev('''()=>{document.querySelector('[data-markdown-text-style]').insertAdjacentHTML('beforeend','<h2>SecretHeading42</h2><p data-is-streaming="true">Fresh streamed body</p>');}''');h.wait()
 check('stream change adds new heading',h.debug()['outline']['headings']==9)
 h.ev("()=>__test.exportMarkdown('turn',__test.turns[0],null,'copy')");text=h.ev('__clipboard.at(-1)')
 check('stream export is labelled snapshot','部分内容/快照' in text and 'Fresh streamed body' in text)
 h.ev('''()=>{const t=__test.turns[0],a=t.answers[0],h=a.headings.find(h=>h.text==='SecretHeading42');return __test.jumpTo(0,true,{kind:'heading',answerKey:a.key,answerIds:a.ids,answerIndex:0,level:h.level,text:h.text,occurrence:h.occurrence});}''')
 check('diagnostics never contain heading text','SecretHeading42' not in h.ev('JSON.stringify(chatgptTurnNavDebug())'))
 # Scroll high enough to choose a non-leading heading and persist on re-entry.
 h.ev('()=>{__test.getTimeline().scrollTop=2600;__test.userNavigationIntent();}');h.wait(800)
 remembered=h.ev('__test.captureReadingPoint()');h.ev('()=>__test.saveReadingPosition()')
 data=h.ev('__fixtureLocal._data')
 h.close('stream / folding')
 h=Harness(b,run=False);h.ev('(data)=>Object.entries(data).forEach(([k,v])=>__fixtureLocal.setItem(k,v))',data);h.start()
 check('new page restores saved anchor metadata',h.debug()['reading']['available'])
 check('reading restore is not automatic',h.ev('__test.getTimeline().scrollTop')==0)
 h.ui('#launcher').click();h.ui('#resumeReading').click();h.wait(450)
 check('resume button restores saved position',abs(h.ev('__test.getTimeline().scrollTop')-2600)<10)
 h.ui('#settingsToggle').click();h.ui('#clearReading').click();check('user can clear saved reading point',not h.debug()['reading']['available'])
 # Scan Home cancellation: actual keyboard rather than directly invoking cancel.
 h.ev('()=>{void __test.scanToRepairOrder()}');h.wait(190);h.ev('()=>{document.body.tabIndex=-1;document.body.focus();}');h.page.keyboard.press('Home');h.wait(350)
 check('Home cancels scanner',not h.debug()['ordering']['scan']['running'])
 h.ev('()=>{void __test.scanToRepairOrder()}');h.wait(190);h.page.keyboard.press('Escape');h.wait(350)
 check('Escape cancels scanner',not h.debug()['ordering']['scan']['running'])
 h.close('reading persistence / keys')
 # URL scheme safety and Markdown DOM conversion edge cases.
 html='''<h2>Title</h2><p><strong>bold</strong><em>em</em><a href="javascript:alert(1)">unsafe</a><a href="https://example.com/test">safe</a></p><pre><code>const x = "```";\n</code></pre><table><tr><th>A</th><th>B</th></tr><tr><td>1|2</td><td>x</td></tr></table><ol start="3"><li>three<ul><li>child</li></ul></li></ol><span data-math-source="x^2" data-math-display="false">duplicated math rendering</span><button>ExcludeUI</button>'''
 h=Harness(b)
 result=h.ev('(html)=>{const node=document.createElement("div");node.innerHTML=html;return __test.exportMarkdownDOM(node);}',html)['markdown']
 check('unsafe links excluded','javascript:' not in result)
 check('code fence protects embedded backticks','````' in result)
 check('table pipe escaped','1\\|2' in result)
 check('TeX avoids duplicated rendered math','x^2' in result and 'duplicated math rendering' not in result)
 check('UI buttons excluded from Markdown','ExcludeUI' not in result)
 h.close('Markdown conversion')
 b.close()
W.joinpath('extra_results.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2))
print('EXTRA TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))

if not all(item['passed'] for item in RESULT): raise SystemExit(1)
