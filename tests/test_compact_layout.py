"""Compact toolbar/footer regression (offline only)."""
from pathlib import Path
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text().split('with sync_playwright() as p:')[0])
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox'])
    h=Harness(b);h.ui('#launcher').click()
    check('status hidden initially',h.ui('#hint').get_attribute('hidden') is not None)
    check('five top controls',h.ui('.compact-toolbar > button').count()==4 and h.ui('#searchScope').count()==1)
    check('eight footer actions',h.ui('.actions > button').count()==8)
    for w in (360,285):
        h.ui('#panel').evaluate('(e,w)=>e.style.width=w+"px"',w)
        g=h.ui('#panel').evaluate("""e=>{const r=e.getBoundingClientRect(),s=e.getRootNode(),
        upper=[...s.querySelector('.compact-toolbar').children].filter(x=>x.matches('button,select')).map(x=>x.getBoundingClientRect()),
        lower=[...s.querySelector('.actions').children].map(x=>x.getBoundingClientRect());
        return {upper:upper.every(x=>Math.abs(x.top-upper[0].top)<3),lower:lower.every(x=>Math.abs(x.top-lower[0].top)<3&&x.left>=r.left&&x.right<=r.right&&x.width>=25)};}""")
        check(f'{w}px top controls one row',g['upper'])
        check(f'{w}px footer buttons one row',g['lower'])
    h.ui('#expandAll').click();check('expand functions',h.debug()['outline']['expanded']>0)
    h.ui('#collapseAll').click();check('collapse functions',h.debug()['outline']['expanded']==0)
    h.ui('#copyCurrent').click();h.wait(200);check('copy icon functions',len(h.ev('__clipboard'))>0)
    h.close('compact layout');b.close()
print('COMPACT TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT):raise SystemExit(1)
