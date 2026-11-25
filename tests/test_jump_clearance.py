"""TOC positioning clearance, with legacy reading offset compatibility."""
from pathlib import Path
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text(encoding='utf-8').split('with sync_playwright() as p:')[0])

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    h=Harness(b)
    h.ui('#launcher').click()
    group=h.ui('.turn-group').nth(1)
    group.locator('.toc-toggle').click()
    group.locator('.toc-link').filter(has_text='章节 1').first.click()
    h.wait(200)
    gap=h.ev('''()=>{
        const s=__test.getTimeline();
        const n=[...s.querySelectorAll('h2')].find(n=>n.textContent==='章节 1');
        return n.getBoundingClientRect().top-s.getBoundingClientRect().top;
    }''')
    check('clicked TOC heading leaves 112px clearance',abs(gap-112)<3,gap)
    check('sidebar stays untouched',h.ev('document.querySelector("aside").scrollTop')==0)
    saved=h.ev('''()=>{__test.getTimeline().scrollTop=1450;return __test.captureReadingPoint();}''')
    h.ev('()=>{__test.getTimeline().scrollTop=0;}')
    h.ev('point=>__test.restoreReadingPoint(point,false)',saved)
    h.wait(200)
    restored=h.ev('__test.getTimeline().scrollTop')
    check('saved reading restores exact prior position',abs(restored-1450)<3,restored)
    h.close('jump clearance');b.close()
print('JUMP CLEARANCE TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT):raise SystemExit(1)
