# 1.9.0

基于用户已确认可用的 1.8.2，保持既有目录交互与布局设置。

## 可靠性

- 位置驱动的灰色轮次查找与消息 ID 精确确认。
- 统一扫描、跳转、返回和阅读恢复的取消/接管逻辑。
- 不跨不同布局版本混用比例坐标；保留跨挂载的身份先后关系。
- 无正文容器启动后可以自动恢复，旧扫描不能覆写新位置。
- API 分组优先明确轮次/任务/父子关系，不再仅按 20 秒阈值合并独立回复。
- 隐藏中间节点只用于追溯可见消息的关系，不纳入目录正文或 Markdown。

## 性能与维护

- 按节点内容版本缓存回答 TOC / Markdown，排除侧栏及纯 UI 更新。
- 移除正文 `innerHTML` 序列化缓存签名。
- 私有状态核心服务 + 23 个源码模块，纯 Python 标准库可重复构建单文件。
- 历史双接口 404/410 冷却；已缓存完整单轮导出不强制请求历史。
- 诊断增加内容重建计数、操作状态和布局版本；不输出章节原文。

## 新功能

- 某轮 Q/A、某条回答的 Markdown 复制 / 下载菜单。
- 一键复制当前 Q/A；Shift+点击全对话导出按钮可复制整个已取得对话。
- 剪贴板不可用时提供手动复制文本框。
- 已缓存正文搜索，显示缓存覆盖量，支持未挂载轮次。
- 消息身份 + 章节哈希 + 局部偏移的阅读恢复；显式按钮恢复，不自动抢滚动。
- 最新 HTML 中回答身份、原始 TeX 和行内代码的适配。

不包含收藏。没有改变默认尺寸、右侧贴边、左下角缩放、点击固定展开及回答 TOC 默认折叠规则。
## v1.9.1 — Compact controls

- Combine the search/filter and answer-outline controls into one toolbar row.
- Fit eight icon shortcuts into a single footer row; retain tooltips and accessible labels.
- Remove the always-visible verbose indexing/status sentence. Show temporary feedback only for actions and errors.
- Keep navigation, export, state persistence, and layout unchanged.

## Repository packaging

- Use the stable root installation artifact `chatgpt-turn-navigator.user.js`.
- The builder no longer creates versioned JS/TXT duplicates.
- README links directly to the latest userscript and Tampermonkey extension.

## v1.9.2 — Per-answer TOC depth presets

- Add H1/H2/H3 controls to each answer outline. Show the first one, two, or three heading-tree levels, including answers whose first source heading is H2.
- Selecting a depth opens only that answer and preserves other answers' fold states.
- Manual heading folds override the depth preset. Preset choices persist in session storage across refreshes and remain effective after virtualization unload.
- Search expansion remains temporary and does not discard the selected depth.
- Preserve the stable `chatgpt-turn-navigator.user.js` installation path.

## v1.9.3 — Whole-conversation Markdown hierarchy

- Use H2 for each conversation turn; present question/answer labels in bold instead of H3 headings when exporting the full conversation.
- Rebase each answer's topmost real Markdown heading to H3, preserving relative heading levels while skipping fenced code, math, quotes and indented code.
- Do not change single-Q/A or answer-only exports.
- Keep the single stable `chatgpt-turn-navigator.user.js` installer and modular source in sync.
