# ChatGPT Turn Navigator

## 🚀 One-click install / update

**[➡️ Install the latest userscript (Tampermonkey)](https://raw.githubusercontent.com/zhangfeiran/chatgpt-turn-navigator/main/chatgpt-turn-navigator.user.js)**

First install the [Tampermonkey extension](https://www.tampermonkey.net/) if needed. If no install prompt appears, download the `.user.js` file and import it manually in Tampermonkey.

> The URL always points to the latest `chatgpt-turn-navigator.user.js`; it does not change between versions.


[简体中文](README.md) · [Install userscript](chatgpt-turn-navigator.user.js) · [Architecture](ARCHITECTURE.md)

An independent **Tampermonkey userscript** for navigating long ChatGPT conversations. It provides a dark, right-docked, resizable table of contents with per-answer headings and Markdown export. This project is not affiliated with OpenAI.

## Features

- Navigate conversation turns, including scheduled assistant-only replies.
- Expand and collapse an outline for each answer. Answer outlines start **collapsed**. Only after you manually open an answer's outline does it show top-level headings and automatically follow the current root as you scroll; branches fold when you leave unless explicitly pinned open. Manually opened or closed branches persist. H1/H2/H3 buttons lock an answer's depth; click the active preset again to resume auto-follow. The ↵ button toggles full wrapping of question and TOC heading labels.
- Retain known turns when long conversations virtualize off-screen messages; mounted turns are highlighted.
- Jump to cached positions of off-screen turns, with a manual scan for correcting uncertain order.
- Search questions and answer headings, or search the currently cached answer text.
- Export or copy a full conversation, a single Q/A turn, or a single answer as Markdown.
- Restore a previously saved reading point on demand.
- Keep the sidebar fixed to the right edge, move it vertically, and resize from its bottom-left corner.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Click the install link at the top; alternatively open [`chatgpt-turn-navigator.user.js`](chatgpt-turn-navigator.user.js), click **Raw**, or import the script manually.
3. Open a conversation at `chatgpt.com` and refresh. Disable older versions of this script.

No external runtime libraries or extra Tampermonkey grants are required. The source is in [`src/`](src/) and is assembled with `python build.py`.

## Whole-conversation Markdown heading levels (v1.9.3)

Only for whole-conversation copy/download: the conversation title stays at `#`, each turn begins with `## 第 N 轮`, and Question / Answer are bold labels rather than Markdown headings. Each answer's highest native heading is rebased to `###`, keeping its relative subheading levels. Fenced code, display math, quoted examples and indented code remain unchanged. Markdown headings are limited to H6. Single-turn Q/A and answer-only exports keep their existing formatting.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+J` | Toggle directory |
| `Alt+Shift+F` | Search turns/headings |
| `Alt+Shift+↑ / ↓` | Previous / next turn |

Clicking the directory keeps it open; hovering opens it temporarily. Drag the header vertically, resize from the bottom-left.

## Code block exports (v1.9.6)

Markdown copy/download prefers the complete copy-source attribute on ChatGPT code blocks, with fallbacks for conventional code viewers and editors. Language, indentation, line breaks and literal characters are preserved; action-bar labels are excluded. If source is missing or only a virtualized editor viewport can be read, the export is explicitly marked partial.

## Privacy and limitations

The script contains **no analytics, no third-party uploads, and no account information**. Any optional history requests use the same origin as the current ChatGPT page. The browser keeps layout settings and limited reading-point metadata locally; it does **not** persist full conversation text across sessions.

ChatGPT's DOM and history endpoints can change. In particular, the history API may return 404; the navigator then relies on the messages currently observed in the page. Scan results do not guarantee complete history, and Markdown exports warn when content may be missing. Images, attachments and interactive widgets are not embedded in Markdown.

## Development

Requirements: Python 3.9+ for building; Node.js for optional syntax checks. Browser regression tests additionally use Playwright, Chromium, and BeautifulSoup.

```sh
python build.py
node --check chatgpt-turn-navigator.user.js
```

See [`tests/README.md`](tests/README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`CHANGELOG.md`](CHANGELOG.md). Private browser snapshots are deliberately not part of the repository.

## License

MIT. See [LICENSE](LICENSE).