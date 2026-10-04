# 建议稿 — 第三环境(omp)实测导出 · 2026-10-04

> 日期:2026-10-04 · 状态:**建议稿,待拍板**(与 06 同性质)
> 依据:[10-independent-omp-browser-2026-10-04](10-independent-omp-browser-2026-10-04.md) 的实测。
> 与 06 的分工:06 是工具面建议稿(截图时序/clip/hit-test 专项);本文档是陌生 harness
> 消费方视角的增量建议,尽量不与 06 重复,重叠处注明。
> 文末附一段澄清,纠正对 `vitrine_state` 的一种误读。
>
> **Triage(同会话,建议稿收录后逐条核验):** 原文未动。逐条结果——
> · §1 `dev_wait` 谓词调用应用工具 → **前提不成立,驳回**:谓词本来就能经 `devWebmcp.invoke` 调应用工具(`dev_wait` 描述已写明);本会话实测谓词内调 `vitrine_state` 成功,返回 `trianglesNow:12`、条件 0ms 满足。10 §3 场景失败的真因是 intro 时序(triangles 暂为 0),不是能力缺失。`@tool:` 前缀方案不采纳。
> · §2 环境自省 → 已做:`vitrine_state` 加 `visibility`,`dev_perf` 加 `visibility`/`rAFThrottled`。(采纳)
> · §3 页内截图 → 维持 06 结论:像素留在 CDP;扩展内纯 WebMCP 消费方的缺口继续记在 docs/09 MISSING。`captureAt` 时间戳建议随该议题留档,若将来落地一并考虑。(缓议)
> · §4 测试矩阵 → 已落地为 `harness/form-fixture.html` + drive 表单 pass,六行全覆盖;其中 Tab 行实测出一个边界事实:合成 keydown 能到达页面 handler(正向路径首次验证),但焦点遍历是 trusted-only 默认行为,Tab 不移焦点——`dev_press` 描述已写明。(采纳)
> · §5 README 错误形态 → 已加 "`executeTool` calling contract" 小节,两种失败形态并排。(采纳)
> · 附(澄清)无需行动。

---

## 1. `dev_wait` 谓词应能调用应用工具

**动机**(报告 10 §3):隐藏标签页 rAF 节流下,`reveal` 长时间为 0,
轮询 `vitrine_state` 是确认"动画在走"的唯一手段。现状是个悖论:
`dev_wait` 谓词只能 eval 页面 JS,而 module scope 恰恰是 eval 摸不到的——
**最需要等待的状态,恰恰是最难等待的状态。**

**实现草图**(两选一,都守"参数前置校验"的既有风格):
- 谓词字符串支持 `@tool:vitrine_state` 前缀,谓词收到该工具的字符串返回值;
- 或 `dev_wait` 增加 `{"tool":"vitrine_state","until":<js 谓词,入参为 JSON.parse 后的结果>}`。

## 2. 状态/perf 类输出附带环境自省

**动机**:同类"环境噪声被误判为页面问题"已第三次出现——
03 §1(headless 无 GL → 只见半个工具面)、09 §4(SwiftShader 慢被读成页面卡)、
10 §3(隐藏标签页 rAF 节流 → `reveal` 卡 0)。
前两次靠人写进文档,第三次仍靠测试者自己意识到。

**建议**(两处任选或都做,一行代码级):
- 应用状态工具的输出模板加 `document.visibilityState`(demo 的 `vitrine_state` 可作示范);
- `dev_perf` 的 `frameSample` 旁加 `rAFThrottled: document.hidden` 级别的提示。

## 3. 页内截图工具(与 06 §截图 对齐,补充消费方证据)

06 已论证截图进工具面的时序/裁剪问题;10 号报告补一条消费方证据:
第三环境全程靠 harness 宿主侧 CDP 截图完成像素验证——**没有宿主 CDP 的纯 WebMCP
agent(如浏览器扩展内运行的消费方)目前无法回答"画面真的变了吗"**,
与 09 §3 MISSING 条目相互印证。若 06 的方案落地,建议输出里带
`captureAt: <rAF 时间戳>`,方便与 `vitrine_state` 的时间轴对账(节流场景下帧与状态不同步)。

## 4. 换常规 DOM UI 的测试矩阵(承接 10 §7)

3D demo 没验过任何输入类工具的正向路径。换常规 UI 时按下表打一轮,
预期无 canvas 特有障碍:

| 路径 | 覆盖工具 | 此前状态 |
|---|---|---|
| 表单填写 + 提交 + change/input 事件序 | `dev_fill` / `dev_type` | 只有语义化报错被验过(03 §2.3) |
| `<select>` 选择 | `dev_select` | 04 自认无 select 路径 |
| Tab 焦点序 / 键盘导航 | `dev_press` | 只验过 `Pressed Tab.` 一条 |
| disabled 按钮点击诊断 | `dev_click` | demo 的 disabled 按钮可用(已验),但诊断文案未在真实 disabled 上验过 |
| 动作后一帧快照时序 | 全部动作类 | 05 修复后只在 canvas 页粗验;常规 DOM 下才真正可观测 |
| 子树变更可见性 | `dev_changes` | 09 NIT:子树折叠,常规 UI 增删列表时可复验 |

## 5. 文档级(零代码)

README 的调用示例只写了 `executeTool` 正确姿势。补两种错误形态各一行:
`executeTool('name', …)` → `TypeError: RegisteredTool must be an object`;
`executeTool(tool, 对象)` → `DOMException: Failed to parse input arguments`(报错是
DOMException 非 TypeError,做错误分类的 harness 会漏判)。出处:10 §1。

---

## 附:澄清 — `vitrine_state` 是手写工具,不是堆枚举

10 号报告口头汇报时引发一种误读,记录在此以免扩散:

- `vitrine_state` **没有**"枚举 JS 内存里所有 object"的能力;WebMCP 与 polyfill
  都不存在这个原语。它是 demo 作者在 `index.html` 末尾显式
  `window.devWebmcp.register({…})` 的两个工具之一,`run` 函数闭包直接引用
  module 作用域的 `user / state / renderer / controls`,把值序列化返回。
- 测试者能快速用上它,靠的是两个正交信息源:`getTools()` 的自声明
  (名字 + title + description + inputSchema)与页面源码本身。
- 这正是设计意图:**不读源码的 agent 本来看不见 module scope**
  (01 实测:枚举 `window` 1106 个属性,无任何 app 全局变量),
  所以必须由应用作者显式写工具把状态"递出来"。
  工具面的质量上限 = 应用作者愿意暴露什么,这也是 06/08 把
  "应用该注册哪些领域工具"当作独立议题的原因。
