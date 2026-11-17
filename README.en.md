# ChatGPT Turn Navigator

[简体中文](README.md) · [Install userscript](ChatGPT_Turn_Navigator_v1.9.1.user.js) · [Architecture](ARCHITECTURE.md)

An independent **Tampermonkey userscript** for navigating long ChatGPT conversations. It provides a dark, right-docked, resizable table of contents with per-answer headings and Markdown export. This project is not affiliated with OpenAI.

## Features

- Navigate conversation turns, including scheduled assistant-only replies.
- Expand and collapse an outline for each answer. All answer outlines are collapsed by default.
- Retain known turns when long conversations virtualize off-screen messages; mounted turns are highlighted.
- Jump to cached positions of off-screen turns, with a manual scan for correcting uncertain order.
- Search questions and answer headings, or search the currently cached answer text.
- Export or copy a full conversation, a single Q/A turn, or a single answer as Markdown.
- Restore a previously saved reading point on demand.
- Keep the sidebar fixed to the right edge, move it vertically, and resize from its bottom-left corner.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open [`ChatGPT_Turn_Navigator_v1.9.1.user.js`](ChatGPT_Turn_Navigator_v1.9.1.user.js), click **Raw**, and allow Tampermonkey to install it. Alternatively paste the script into a new Tampermonkey script.
3. Open a conversation at `chatgpt.com` and refresh. Disable older versions of this script.

No external runtime libraries or extra Tampermonkey grants are required. The source is in [`src/`](src/) and is assembled with `python build.py`.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+J` | Toggle directory |
| `Alt+Shift+F` | Search turns/headings |
| `Alt+Shift+↑ / ↓` | Previous / next turn |

Clicking the directory keeps it open; hovering opens it temporarily. Drag the header vertically, resize from the bottom-left.

## Privacy and limitations

The script contains **no analytics, no third-party uploads, and no account information**. Any optional history requests use the same origin as the current ChatGPT page. The browser keeps layout settings and limited reading-point metadata locally; it does **not** persist full conversation text across sessions.

ChatGPT's DOM and history endpoints can change. In particular, the history API may return 404; the navigator then relies on the messages currently observed in the page. Scan results do not guarantee complete history, and Markdown exports warn when content may be missing. Images, attachments and interactive widgets are not embedded in Markdown.

## Development

Requirements: Python 3.9+ for building; Node.js for optional syntax checks. Browser regression tests additionally use Playwright, Chromium, and BeautifulSoup.

```sh
python build.py
node --check ChatGPT_Turn_Navigator_v1.9.1.user.js
```

See [`tests/README.md`](tests/README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`CHANGELOG.md`](CHANGELOG.md). Private browser snapshots are deliberately not part of the repository.

## License

MIT. See [LICENSE](LICENSE).