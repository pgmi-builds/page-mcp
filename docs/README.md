# page-mcp docs

> 2026-10-04 起包更名 **page-mcp**（原名 dev-webmcp）。各篇报告写作时的
> `dev-webmcp` / `devWebmcp` / `devtools.js` 均为当时的名字，正文按惯例保持 verbatim。

| # | 文档 | 作者 | 内容 |
|---|---|---|---|
| 00 | [prior-art-and-positioning](00-prior-art-and-positioning.md) | 本 session | 市场调研、消费模型（为什么不需要桥）、可借鉴清单、差异化候选、风险 |
| 01 | [agent-usability-test](01-agent-usability-test.md) | 本 session | 三个 agent 当真实用户使用工具面的实测报告、发现台账、修复映射 |
| 02 | [measurements](02-measurements.md) | 本 session | Chrome WebMCP 可用性矩阵、CSP 行为矩阵、输出体积、失败信号约定 |
| 03 | [verification-demo-2026-10-03](03-verification-demo-2026-10-03.md) | **另一 agent（dev3 / Hermes）** | 公开 demo 独立复现：15 工具全可用、两种 runtime 各 20/20；发现 4 个新问题 |
| 04 | [verification-drive-rerun-2026-10-03](04-verification-drive-rerun-2026-10-03.md) | **另一 agent（dev3 / Hermes）** | drive 套件复测、消费模型实测、问题清单复核 |
| 05 | [recheck-after-fixes-2026-10-03](05-recheck-after-fixes-2026-10-03.md) | **另一 agent（dev3 / Hermes）** | 对 `a4bffe6` 三条修复的逐条复验、未知参数严格化实测 |
| 06 | [proposed-tool-surface](06-proposed-tool-surface.md) | **另一 agent（dev3 / Hermes）** | 截图能力专项实测（canvas 时序 / clip 裁剪 / hit-test）、分层责任、6 个新工具建议（**建议稿，待拍板**） |
| 07 | [recheck-of-05-and-06-2026-10-03](07-recheck-of-05-and-06-2026-10-03.md) | 本 session | 对 05/06 的独立复验：05 全部通过、06 两处更正、陈旧标签页陷阱 |
| 08 | [tool-surface-benchmark](08-tool-surface-benchmark.md) | 本 session | 对 BU / Playwright MCP / DevTools MCP 的能力对标：抄什么、超什么、**不做什么**、执行顺序 |
| 09 | [agent-as-user-2026-10-03](09-agent-as-user-2026-10-03.md) | **另一 agent（新工具的真实用户）** | 22+2 工具面的真实使用报告（进行中/刚落地，以文件为准） |
| 10 | [independent-omp-browser-2026-10-04](10-independent-omp-browser-2026-10-04.md) | **另一 agent（omp / GLM，陌生通用 harness）** | 第三环境复现：24/24 工具通、宿主侧文件选择器上传全链路；新发现隐藏标签页 rAF 节流陷阱、executeTool 错误姿势报错形态 |
| 11 | [suggestions-third-env-2026-10-04](11-suggestions-third-env-2026-10-04.md) | **另一 agent（omp / GLM）** | 第三环境实测导出的建议稿：dev_wait 调应用工具、环境自省、页内截图证据、常规 UI 测试矩阵；附 vitrine_state 澄清（**建议稿，待拍板**） |
| — | [research/](research/) | 调研子代理 | 一手清单：Browser Use 24 actions、Playwright MCP 72、DevTools MCP 66、页内库、WebMCP 生态、polyfill 注解实测 |

> 03/04 是**独立第三方复现**，不是本 session 自述。它们原名为 `01-…` / `02-…`，
> 与本 session 的 01/02 撞号，已改编号；**正文未改**，只更新了交叉引用。
> 05/06 是同一 agent 在修复**之后**写的第二批：05 是复验，06 是建议稿。

阅读顺序：**00 决定做什么 → 02 硬约束 → 01 检验 → 03/04 复现 → 05 修复生效否 → 06 下一步 → 07 报告可不可信 → 08 对标与取舍（执行顺序在 §6）→ research/ 是 08 的证据层**。

---

## 最该记住的结论

1. **不需要桥**（00）。前提是 coding agent 自己拉起浏览器。CDP `Runtime.evaluate` 在页面自己的 realm 执行，天然满足 `tools` 权限策略的 `'self'`。三个 agent 全程只用 CDP attach，replay/扩展/MCP server 一次都没用上。

2. **CSP 的结论和直觉相反**（02）。`<style>` 与 `el.style.x=` 都会被 `style-src` 拦，但 `CSSStyleSheet` + `adoptedStyleSheets` 能穿过。且 **CDP evaluate 绕过页面 CSP**——用它测页面安全策略会得到假结果（我一开始就踩了）。

3. **应用自注册的工具是唯一能看见 module scope 的窗口**（01）。agent 枚举了 `window` 的 1106 个属性，没有任何 app 全局变量。这不是推断，是实测。

4. **headless 必须带软渲染 flag**（03）。没有 GPU 的 headless Chrome 里 `new THREE.WebGLRenderer` 抛异常 → 应用模块求值中断 → 它末尾的 `register()` 全部没执行 → 只看到 13 条包自带工具，看起来像"应用工具注册失败"。
   正确做法：`--enable-unsafe-swiftshader --use-angle=swiftshader`（`harness/browser.mjs` 与 `drive.mjs` 都已带）。

5. **静默忽略参数是最贵的 bug 类型**（01 + 03）。两个 agent 各自踩了一次：`{"holo":"yes"}` 让 toggle 做了**相反**的事；`{"delta_y":200}` 被当成 0 静默通过。现在 schema 会拒绝未知属性和类型错误。

6. **「线上的文件是新的」不等于「页面在跑新代码」**（本 session 复验 05 时踩到）。demo 是无缓存投递，但一个在**部署之前**打开的标签页会把旧 bundle 留在内存里，直到 reload。我据此差点把 05 的三条修复全部判成「未生效」——实际是我在测一个 20:44 打开的页面，而修复 21:15 才部署。**复验前先 reload**，并且核对被测页面加载的那份构建，而不是只核对服务器上的文件。

7. **重构可以丢掉一行调用而全部测试保持绿色**（本 session 扩工具面时踩到）。`register()` 里的 `emit()` 被一次锚点编辑吞掉——注册照常、`specs()` 照常、46 条测试全绿，只有**页角 badge 的计数永远停在 22**，因为全页只有它在观察注册表。规则：**一个行为没有测试盯着，它就处于随时会坏的状态**；badge 现在有回归测试了。

8. **「工具说做成了」和「页面真的变了」之间可以隔着整个 bug 类别**（form fixture 落地时发现）。`dev_click` 从第一天起就从未派发过 click 事件——指针序列齐全、返回 "Clicked ✓"、驱测全绿；直到第一张有 click 语义的页面（form-fixture 的提交按钮）出现才暴露：submit 从不触发。此前所有被测页面对 click 没有任何可观察反应，测试只能断言工具自己的成功字符串。修复 = 指针序列后接 `el.click()` 让激活行为真正发生；表单测试现在断言**页面自己的 submit 事件与状态**，并用裸 `el.click()` 做环境对照。

---
## 发现项总台账

| 来源 | 发现 | 状态 |
|---|---|---|
| 01 · Agent B | 没有文件上传能力 | 已修：`dev_upload` |
| 01 · Agent B | 隐藏 `<input type=file>` 不可见 | 已修：`include_hidden` |
| 01 · Agent B | 没有等待原语 | 已修：`dev_wait` |
| 01 · Agent B | 工具失败退出码为 0 | 已修：统一前缀 + `--json` |
| 01 · Agent A | schema 不校验，静默做相反的事 | 已修：前置校验 |
| 01 · Agent A | 动作后快照是动作前的 DOM | 已修：延后一帧 |
| 01 · Agent A | `dev_upload` 返回陈旧快照 | 已修：默认不带快照 |
| 01 · Agent A | 内部 `ReferenceError` 像参数错误 | 已修：区分 internal failure |
| 01 · Agent C | `dev_upload` 读不到宿主机路径 | 已修：CDP 侧 `browser.mjs upload` |
| **03** | **badge 计数陈旧（显示 13，实际 15）** | **已修：订阅 registry 变更重绘** |
| **03** | **`dev_upload` 的默认值与自身文案相反** | **已修：独立描述** |
| **03** | **`dev_wait` 吞掉谓词异常** | **已修：超时消息里带上异常** |
| 03 | headless 无 GL → 应用工具不注册 | 已记录（§4），工具无解，属方法学 |
| 03 / 04 | `debugging` 注解被 Chrome 151 丢弃 | 已知边界，Chrome 156 前无法依赖 |
| 03 | `validate()` 认为 `NaN` 是合法 number | 无害（JSON 传不进 NaN） |
| 03 | `/favicon.ico` 404 | 无害 |
| 03 / 04 | `dev_eval` 是页面内任意 JS，仅靠 permission-policy 兜底 | 设计如此，禁进生产构建 |
| 04 | 本 demo 无可见 `<select>` / file input 路径 | 已知：`dev_select` 只验了参数校验 |
| **05** | **三条修复（badge / upload 默认值 / wait 谓词）复验** | **本 session 独立复现：三条全部通过** |
| **05** | **未知参数严格化** | **本 session 复现：`invoke` 与 `executeTool` 两条路径都拒绝** |
| **06** | **canvas 帧外读取返回全黑的合法 PNG** | **本 session 复现（解码 nonBlack=0）；但 06 记的 944710 字符未复现，本次 11274 字符——全黑图不可能压到 700 KB** |
| **06** | **hit-test 遮挡误报（disabled 控件）** | **本 session 复现，但成因要改**：是应用自己的 `.actions button:disabled{pointer-events:none}`，不是「disabled 控件不参与命中测试」 |
| **06** | **CDP clip 裁剪尺寸精确** | **本 session 复现：130×33**（字节数随内容变，06 记 4770 B，本次 4481 B） |
| 10 | 隐藏标签页 rAF 节流：状态真实但 reveal 卡 0，易误判为页面 bug | **已做（本 session）：`vitrine_state` 加 `visibility`，`dev_perf` 加 `visibility`/`rAFThrottled`，驱测覆盖** |
| 10 | executeTool(tool, 对象参数) → DOMException（非 TypeError）；正确姿势见 03 §2.2 | **已写进 README "`executeTool` calling contract" 小节（本 session）** |
| 10 | 一次 getTools() 返回 23 条缺 dev_fill，未复现 | 孤立异常，置信度低 |
| 10 | omp harness 新开标签页首次 evaluate 必失败（非本项目） | 已上报 omp |
| **11** | **dev_wait 谓词调不到应用工具（「最需要等待的状态最难等待」）** | **前提不成立：谓词里 `devWebmcp.invoke` 本来就通（本 session 实测 Condition met after 0ms）；那次失败是 intro 期 triangles=0 的时序** |
| **11** | **换常规 DOM UI 的输入类测试矩阵** | **已建 `harness/form-fixture.html` 并进 drive（本 session）** |
| 11 | 页内截图证据（无宿主 CDP 的消费方无法验证画面） | 维持原决策：像素归 CDP（docs/08 §1.4）；已在 docs/09 MISSING 条目记录 |
| **本 session（form fixture 落地时发现，03–10 全部报告均未发现）** | **`dev_click` 从未派发过 click 事件：指针序列齐全但 activation 缺失，提交按钮点了不提交、链接不导航、复选框不勾** | **已修：`synthClick` 在指针序列后接 `el.click()`（激活行为生效、仍尊重 preventDefault）；form pass 断言页面自己的 submit+状态，裸 `el.click()` 做环境对照** |
| 本 session | 合成 Tab 键能到达页面 handler（正向路径首次验证），但焦点遍历是 trusted-only，Tab 不移焦点 | 已测（form pass）；`dev_press` 描述已写明该边界 |
