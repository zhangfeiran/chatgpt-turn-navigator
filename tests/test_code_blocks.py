"""Code block export regressions using synthetic fixtures only (offline Chromium)."""
from pathlib import Path
import html
from playwright.sync_api import sync_playwright
import shutil, os

ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'src/markdown/conversion.js').read_text(encoding='utf-8')
converter=source[:source.index('  function exportAPIBody')]
CHROMIUM=os.environ.get('CHROMIUM_BIN') or shutil.which('chromium') or shutil.which('chromium-browser')
checks=[]
def check(name,condition):
    checks.append((name,bool(condition)))
    print(('PASS ' if condition else 'FAIL ')+name,flush=True)

with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=b.new_page()
    page.route('**/*',lambda r:r.abort())
    page.set_content('<!doctype html><html><body></body></html>')
    page.evaluate('()=>{const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));'+converter+'window.convertCodeFixture=html=>{const root=document.createElement("div");root.innerHTML=html;document.body.replaceChildren(root);return exportMarkdownDOM(root)};}')
    run=lambda markup:page.evaluate('html=>convertCodeFixture(html)',markup)
    code='def foo(x):\n    # keep the indent\n    return x ** 2\n\nprint(foo(3))\n'
    header='<div class="ActionBar-Example" data-markdown-copy="exclude"><div class="truncate">Python</div><button>Copy</button><button>Run</button></div>'
    wrapped='<div data-chatgpt-copy-code="'+html.escape(code,quote=True)+'"><div data-code-block="true" data-markdown-copy="code-block">'+header+'<div contenteditable="true">Partial rendering</div></div></div>'
    tick=chr(96)
    fence=tick*3
    result=run(wrapped);expected=fence+'python\n'+code+fence
    check('raw copy-source restored without pre/code',result['markdown']==expected)
    check('code source is not truncated or altered',code in result['markdown'])
    check('no Python/Copy/Run UI labels leak',all(t not in result['markdown'] for t in ['Python','Copy','Run','Partial rendering']))
    check('authoritative raw code is complete',not result['codeIncomplete'])
    result=run('<div data-markdown-copy="code-block">'+header+'<pre><code>'+html.escape(code)+'</code></pre></div>')
    check('marked block with pre viewer restores language and source',result['markdown']==expected)
    result=run('<pre><code class="language-python">'+html.escape(code)+'</code></pre>')
    check('legacy pre/code language and whitespace preserved',result['markdown']==expected)
    result=run('<div data-code-block="true" data-language="python">'+header+'<textarea>'+html.escape(code)+'</textarea></div>')
    check('marked textarea code source is recovered',result['markdown']==expected and not result['codeIncomplete'])
    result=run('<div data-code-block="true">'+header+'<div class="cm-editor"><div class="cm-content" contenteditable="true"><div class="cm-line">def f():</div><div class="cm-line">    return 1</div></div></div></div>')
    check('CodeMirror lines reconstructed with indentation',result['markdown']==fence+'python\ndef f():\n    return 1\n'+fence)
    check('virtualized editor is explicitly partial',result['codeIncomplete'] and bool(result['notes']))
    result=run('<div data-code-block="true">'+header+'</div>')
    check('missing source gets explicit placeholder',result['codeIncomplete'] and '代码块源码未取得' in result['markdown'])
    check('missing source does not silently export only Python',result['markdown']!='Python')
    result=run('<p>Python is a language.</p><span data-markdown-copy="inline-code">print(x)</span><div data-markdown-copy="exclude">Do not export me</div>')
    check('ordinary text and inline code remain unchanged', 'Python is a language.' in result['markdown'] and tick+'print(x)'+tick in result['markdown'] and 'Do not export me' not in result['markdown'])
    nested='# Title\n'+fence+'python\n    x=1\n'+fence
    result=run('<div data-code-block="true" data-language="markdown" data-chatgpt-copy-code="'+html.escape(nested,quote=True)+'"></div>')
    check('nested backticks safely enclosed',result['markdown'].startswith(tick*4+'markdown\n# Title') and result['markdown'].endswith('\n'+tick*4))
    result=run('<div data-code-block="true" data-language="python"><pre><code>a<br>    b</code></pre></div>')
    check('HTML br inside literal source becomes newline',result['markdown']==fence+'python\na\n    b\n'+fence)
    b.close()
print(f'TOTAL {sum(x[1] for x in checks)}/{len(checks)}')
assert all(x[1] for x in checks)
