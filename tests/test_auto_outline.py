"""Automatic H1 TOC follow, manual overrides and title wrapping (offline Chromium)."""
from pathlib import Path
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text(encoding='utf-8').split('with sync_playwright() as p:')[0])

markup=doc(
    turn(0,height=3600,extra='<div style="height:850px"></div><h2>Later root</h2><p>Later section</p><h3>Later child</h3><p>More text</p>')+
    turn(1,height=1800)
)

def visible(group):
    return group.locator('.toc-row .toc-text').all_text_contents()

def scroll_to(h,label):
    h.ev('''text=>{
      const s=__test.getTimeline();
      const heading=[...s.querySelectorAll('h1,h2,h3')].find(n=>n.textContent.trim()===text);
      if(!heading) throw new Error('Missing test heading '+text);
      s.scrollTop+=heading.getBoundingClientRect().top-s.getBoundingClientRect().top-90;
      s.dispatchEvent(new Event('scroll',{bubbles:true}));
    }''',label)
    h.wait(350)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    h=Harness(browser,markup)
    h.ui('#launcher').click()
    first=h.ui('.turn-group').first
    second=h.ui('.turn-group').nth(1)
    check('answer TOCs start collapsed',first.locator('.toc-body').count()==0 and second.locator('.toc-body').count()==0)
    scroll_to(h,'Later root')
    check('scrolling never auto-opens a closed answer',first.locator('.toc-body').count()==0)
    first.locator('.toc-toggle').click()
    check('manual opening enables H1 baseline','章节 0' in visible(first) and 'Later root' in visible(first))
    check('other answers remain closed after opening one',second.locator('.toc-body').count()==0)
    check('manual opening auto-follows current H1','Later child' in visible(first))
    scroll_to(h,'章节 0')
    check('changing H1 folds inactive root','Later child' not in visible(first))
    scroll_to(h,'Later root')
    check('entering second H1 expands its subtree','Later child' in visible(first))
    check('leaving previous H1 folds its subtree','子标题 0' not in visible(first))
    scroll_to(h,'章节 0')
    check('returning to first H1 unfolds it','子标题 0' in visible(first))
    check('returning to first H1 folds later H1','Later child' not in visible(first))
    scroll_to(h,'Later root')
    first.locator('.toc-depth-button',has_text='H1').click()
    check('manual H1 locks the depth','Later child' not in visible(first))
    first.locator('.toc-depth-button',has_text='H1').click()
    check('clicking selected depth restores automatic follow','Later child' in visible(first))
    # Click a folded *inactive* root to pin the entire branch.
    root_row=first.locator('.toc-row').filter(has_text='章节 0').first
    root_row.locator('.toc-node-toggle').click()
    check('manually opened first root shows descendants','子标题 0' in visible(first))
    scroll_to(h,'章节 0');scroll_to(h,'Later root')
    check('manually opened root remains expanded after leaving','子标题 0' in visible(first))
    later_row=first.locator('.toc-row').filter(has_text='Later root').first
    later_row.locator('.toc-node-toggle').click()
    check('manual close overrides automatic expansion','Later child' not in visible(first))
    scroll_to(h,'章节 0');scroll_to(h,'Later root')
    check('manual close persists across scrolling','Later child' not in visible(first))
    check('top header has wrap toggle',h.ui('#titleWrap').count()==1)
    check('wrap defaults off',h.ui('#titleWrap').get_attribute('aria-pressed')=='false')
    h.ui('#titleWrap').click()
    check('wrap switches on',h.ui('#titleWrap').get_attribute('aria-pressed')=='true')
    check('wrap attribute enables CSS',h.ev('document.querySelector("#chatgpt-turn-nav-userscript").dataset.wrapTitles')=='true')
    check('wrap preference stored locally',h.ev('__fixtureLocal.getItem("chatgpt-turn-nav-wrap-titles-v1")')=='1')
    h.ui('#titleWrap').click()
    check('wrap can switch off',h.ui('#titleWrap').get_attribute('aria-pressed')=='false')
    check('sidebar scroll remains untouched',h.ev('document.querySelector("aside").scrollTop')==0)
    h.close('auto outline and wrap')
    browser.close()
print('AUTO OUTLINE TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT):raise SystemExit(1)
