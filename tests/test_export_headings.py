"""Whole-conversation Markdown heading hierarchy; offline Chromium regression."""
from pathlib import Path
exec((Path(__file__).resolve().parent/'test_navigator.py').read_text(encoding='utf-8').split('with sync_playwright() as p:')[0])

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=CHROMIUM,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    first=turn(0,extra='<h4>Nested H4</h4><pre><code># code header\n## code sub</code></pre>')
    second=turn(1).replace('<h2>章节 1</h2>','<h1>章节 1</h1>').replace('<h3>子标题 1</h3>','<h2>子标题 1</h2>')
    h=Harness(browser,doc(first+second))
    data=h.ev('''() => {
      const turns=__test.turns.map((turn,i)=>({turn,number:i+1}));
      return {all:__test.exportBuild(turns,'all').markdown,
              single:__test.exportBuild(turns.slice(0,1),'turn').markdown,
              answer:__test.exportBuild(turns.slice(0,1),'answer').markdown};
    }''')
    whole=data['all'];single=data['single']
    check('full export retains H1 document title',whole.startswith('# 测试'))
    check('two turn headings use H2',whole.count('\n## 第 ')==2)
    check('full export uses bold question/answer roles','**提问**' in whole and '**回答**' in whole)
    check('full export has no H3 role titles','\n### 提问' not in whole and '\n### 回答' not in whole)
    check('H2-first reply rebased to H3','\n### 章节 0' in whole)
    check('H3 becomes H4 in first reply','\n#### 子标题 0' in whole)
    check('H4 becomes H5 in first reply','\n##### Nested H4' in whole)
    check('H1-first second reply rebased to H3','\n### 章节 1' in whole)
    check('H2 becomes H4 in second reply','\n#### 子标题 1' in whole)
    check('code content remains literal','# code header\n## code sub' in whole)
    check('single turn still uses H3 role headings','\n### 提问' in single and '\n### 回答' in single)
    check('single turn preserves original H2 heading','\n## 章节 0' in single)
    check('answer-only export retains old role title','\n### 回答' in data['answer'])
    check('incomplete history warning preserved','未确认完整历史' in whole)
    check('full export does not scroll left sidebar',h.ev('document.querySelector("aside").scrollTop')==0)
    pure=[
      ('H1->H3','# Main\n## Sub','### Main\n#### Sub'),
      ('H2->H3','## Main\n### Sub','### Main\n#### Sub'),
      ('H3 unchanged','### Main\n#### Sub','### Main\n#### Sub'),
      ('fenced code ignored','~~~md\n# Code\n~~~\n## Main','~~~md\n# Code\n~~~\n### Main'),
      ('math display ignored','$$\n# x\n$$\n## Main','$$\n# x\n$$\n### Main'),
      ('blockquote ignored','> # Example\n## Main','> # Example\n### Main'),
      ('setext supported','Main\n====\nSub\n----','### Main\n\n#### Sub\n'),
      ('no heading unchanged','Ordinary answer','Ordinary answer')
    ]
    for name,source,expected in pure:
      output=h.ev('(text)=>__test.exportRebaseAnswerHeadings(text)',source)
      check(name,output==expected,output if output!=expected else None)
    h.close('Markdown heading hierarchy')
    browser.close()
print('MARKDOWN HEADING TOTAL',sum(x['passed'] for x in RESULT),'/',len(RESULT))
if not all(x['passed'] for x in RESULT):raise SystemExit(1)
