# 可选离线测试

需要 Python、Playwright、Chromium 和 BeautifulSoup。测试不访问在线 ChatGPT，也不使用用户账号。

```sh
python tests/test_navigator.py
python tests/test_edge_cases.py
python tests/test_ui_actions.py
python tests/test_compact_layout.py
python tests/test_toc_depth.py
python tests/test_auto_outline.py
python tests/test_export_headings.py
```

可设置 `CHROMIUM_BIN` 指定本机 Chromium 可执行文件。未设置时优先使用系统 Chromium，否则使用 Playwright 默认浏览器。

`NAV_FIXTURES` 可指向含 `nov_saved.html`、`oct_saved.html`、`scheduled_saved.html` 的私有结构 fixture 文件夹。这些用户页面不随安装包发布；未提供时，跳过对应实际 HTML 测试，不伪造通过记录。

测试输出在 `test-output/`。仅测试期间在内存源码中加入路由、存储和函数入口替身；这些入口不在安装脚本中。
