"""Offline synthetic Mermaid/formatting regressions. No saved chats or network."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import html, os, shutil

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'src/markdown/conversion.js').read_text(encoding='utf-8')
converter=(ROOT/'src/markdown/mermaid.js').read_text(encoding='utf-8')+source[:source.index('  function exportAPIBody')]
CHROMIUM=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('chromium-browser')
checks=[]
def check(name,condition):
    checks.append((name,bool(condition)))
    print(('PASS ' if condition else 'FAIL ')+name,flush=True)

def diagram():
    nodes=''.join(f'<g class="node" id="fixture-flowchart-{name}-{i}" transform="translate({x},{y})"><rect class="label-container"></rect><g class="label"><text>{label}</text></g></g>' for i,(name,x,y,label) in enumerate([('A',10,10,'Start'),('B',90,10,'Next'),('C',170,10,'End')]))
    paths=''.join(f'<path data-edge="true" data-id="L_{a}_{b}_0" class="flowchart-link edge-pattern-solid" marker-end="url(#fixture-pointEnd)"></path>' for a,b in [('A','B'),('B','C')])
    return '<div data-chatgpt-mermaid-preview><div data-code-block-preview-pane="mermaid"><svg class="flowchart" id="fixture" aria-label="Mermaid diagram"><style>.noise{fill:red}</style>'+nodes+paths+'</svg><button>Expand diagram</button></div></div>'

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=b.new_page();page.route('**/*',lambda r:r.abort())
    page.set_content('<!doctype html><html><body></body></html>')
    page.evaluate('()=>{const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));'+converter+'window.convertFixture=(markup,props)=>{const root=document.createElement("div");root.innerHTML=markup;document.body.replaceChildren(root);if(props)root.firstElementChild.__reactProps$fixture=props;return exportMarkdownDOM(root)};}')
    run=lambda markup,props=None:page.evaluate('args=>convertFixture(...args)',[markup,props])
    fence=chr(96)*3
    code='flowchart LR\n    A["Start"] --> B["Next"]\n    B --> C["End"]'
    svg=diagram()
    raw='<div data-client-defined-widget="code_block" data-mermaid-source="'+html.escape(code,quote=True)+'">'+svg+'</div>'
    r=run(raw)
    check('explicit source exact',r['markdown']==fence+'mermaid\n'+code+'\n'+fence and not r['codeIncomplete'])
    raw='<div data-client-defined-widget="code_block">'+svg+'</div>'
    r=run(raw,{'data':{'code':code}})
    check('bounded widget props source exact',r['markdown']==fence+'mermaid\n'+code+'\n'+fence and not r['codeIncomplete'])
    r=run(raw)
    check('SVG topology reconstructed',code in r['markdown'] and fence+'mermaid' in r['markdown'])
    check('reconstruction explicitly marked partial',r['codeIncomplete'] and 'SVG 重建' in r['markdown'])
    check('no SVG CSS or controls',all(t not in r['markdown'] for t in ['.noise','Expand diagram']))
    check('one diagram exported once',r['markdown'].count(fence+'mermaid')==1)
    unsupported=raw.replace('class="flowchart-link edge-pattern-solid"','class="flowchart-link edge-pattern-dotted"')
    r=run(unsupported)
    check('unsupported graph not guessed',r['codeIncomplete'] and 'Mermaid 源码未取得' in r['markdown'] and fence not in r['markdown'])
    r=run(raw,{'source':'graph TD\n X-->Y','code':'graph LR\n X-->Z'})
    check('conflicting candidate sources not trusted',r['codeIncomplete'] and code in r['markdown'])
    r=run('<div data-client-defined-widget="code_block"><pre data-code-block-source="true">'+html.escape(code)+'</pre>'+svg+'</div>')
    check('explicit source view preserved',r['markdown']==fence+'mermaid\n'+code+'\n'+fence and not r['codeIncomplete'])
    r=run('<p><strong>10</strong><strong> ms</strong></p><p>Next paragraph</p><div data-code-block="true" data-language="python"><pre><code>first\n\n\n    second</code></pre></div><p>Last</p>')
    check('adjacent emphasis merged','**10 ms**' in r['markdown'])
    check('paragraph spacing normalized','**10 ms**\n\nNext paragraph\n\n'+fence in r['markdown'])
    check('literal blank lines preserved','first\n\n\n    second' in r['markdown'])
    b.close()
print(f'TOTAL {sum(x[1] for x in checks)}/{len(checks)}')
assert all(x[1] for x in checks)
