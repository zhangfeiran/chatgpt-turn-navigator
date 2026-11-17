"""Per-answer H1/H2/H3 outline-depth presets (offline Chromium)."""
from pathlib import Path
import json
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text(encoding='utf8').split('with sync_playwright() as p:')[0])

EXTRA = '<h4>Grandchild</h4><h5>Fourth</h5><h2>Another root</h2><h3>Second child</h3>'
markup=doc(turn(0,extra=EXTRA)+turn(1,extra='<h4>Other grandchild</h4>')+turn(2,automated=True,extra='<h4>Task grandchild</h4>'))

def rows(t):
    return t.locator('.toc-row .toc-text').all_text_contents()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    h=Harness(browser,markup)
    h.ui('#launcher').click()
    groups=h.ui('.turn-group')
    first=groups.nth(0)
    second=groups.nth(1)
    third=groups.nth(2)
    check('three answer groups indexed',groups.count()==3)
    check('TOC remains collapsed by default',first.locator('.toc-body').count()==0 and second.locator('.toc-body').count()==0)
    check('each answer has its own H1/H2/H3 controls',all(g.locator('.toc-depth-button').count()==3 for g in (first,second,third)))
    before=h.ev('__test.getTimeline().scrollTop')
    first.locator('.toc-depth-button',has_text='H1').click()
    check('H1 displays only root outline levels',rows(first)==['章节 0','Another root'],rows(first))
    check('H1 button is selected',first.locator('.toc-depth-button',has_text='H1').get_attribute('aria-pressed')=='true')
    check('other answers stay collapsed',second.locator('.toc-body').count()==0)
    first.locator('.toc-depth-button',has_text='H2').click()
    check('H2 displays first two outline levels',rows(first)==['章节 0','子标题 0','Another root','Second child'],rows(first))
    first.locator('.toc-depth-button',has_text='H3').click()
    check('H3 displays first three outline levels',rows(first)==['章节 0','子标题 0','Grandchild','Another root','Second child'],rows(first))
    check('H4 remains hidden under depth three',not any('Fourth' in x for x in rows(first)))
    check('depth buttons do not scroll conversation',abs(h.ev('__test.getTimeline().scrollTop')-before)<2)
    check('depth buttons do not scroll left sidebar',h.ev('document.querySelector("aside").scrollTop')==0)
    check('task answer has independent depth controls',third.locator('.toc-depth-button',has_text='H1').count()==1)

    # Manual fold overrides the preset, retains remaining nodes' fold state.
    first.locator('.toc-node-toggle').first.click()
    check('manual fold clears preset active state',first.locator('.toc-depth-button[aria-pressed="true"]').count()==0)
    check('manual fold hides only clicked subtree',rows(first)==['章节 0','Another root','Second child'],rows(first))
    first.locator('.toc-depth-button',has_text='H1').click()
    h.ui('#search').fill('Fourth')
    check('search temporarily reveals deeper matching heading',any('Fourth' in x for x in rows(first)))
    h.ui('#search').fill('')
    check('clearing search restores selected depth',rows(first)==['章节 0','Another root'])
    saved=h.ev('JSON.stringify(__fixtureSession._data)')
    h.close('per-answer depth controls')

    h2=Harness(browser,markup,setup=f'() => Object.assign(window.__fixtureSession._data, JSON.parse({json.dumps(saved)}))')
    h2.ui('#launcher').click()
    first2=h2.ui('.turn-group').first
    check('saved answer remains expanded after refresh',first2.locator('.toc-body').count()==1)
    check('per-answer depth setting is restored',first2.locator('.toc-depth-button[aria-pressed="true"]').inner_text()=='H1')
    check('restored H1 shows only root headings',rows(first2)==['章节 0','Another root'])
    # Simulate virtualized removal: stored heading metadata remains available.
    h2.ev("() => __test.getTimeline().querySelector('[data-turn-key=\"u0\"]').closest('[data-measured-turn]').remove()")
    h2.wait(600)
    check('cached unmounted reply still exposes H1',h2.ui('.turn-group').first.locator('.toc-depth-button[aria-pressed="true"]').inner_text()=='H1')
    check('cached unmounted outline retains two top headings',rows(h2.ui('.turn-group').first)==['章节 0','Another root'])
    h2.close('persisted and virtualized outline')

    for width in (360,285):
        h3=Harness(browser,markup)
        h3.ui('#launcher').click()
        h3.ui('#panel').evaluate('(el,w)=>el.style.width=w+"px"',width)
        h3.ui('.turn-group').first.locator('.toc-depth-button',has_text='H2').click()
        geometry=h3.ui('.turn-group').first.locator('.toc-head').evaluate('''head=>{
          const r=head.getBoundingClientRect(), nodes=[...head.children];
          return {head:[r.left,r.right], children:nodes.map(n=>{const v=n.getBoundingClientRect();return [v.left,v.right,v.width]})};
        }''')
        check(f'{width}px depth controls remain within header', all(x[0]>=geometry['head'][0]-.5 and x[1]<=geometry['head'][1]+.5 for x in geometry['children']),geometry)
        h3.close(f'{width}px layout')
    browser.close()
print('TOC DEPTH TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT): raise SystemExit(1)
