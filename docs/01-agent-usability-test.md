# 01 · Agent-as-user 可用性测试

> 日期：2026-10-03 · 状态：已完成，发现项均已修复或记录为已知边界
> 目的：不靠"我觉得这个工具面挺好用"，而是把它交给**从没见过实现**的 agent，给真实任务，看它能不能做完。

---

## 0. 结论

| 轮次 | Agent | 任务 | 结果 |
|---|---|---|---|
| 1 | B | 把 `/tmp/triangle.glb` 装进 3D viewer | ❌ **工具面做不到**，退回 raw `eval` + 宿主机 base64 |
| 2 | C | 同一任务，修复后重跑 | ✅ **一次 `dev_upload` 调用完成** |
| 3 | A | 诊断"glow 不对 + 模型永远加载不完" | ✅ 任务完成，并挖出 4 个工具面 bug |

一句话：**工具面在"文件上传"这个真实场景上是残缺的，第一轮直接暴露；补齐后同样的 agent 一次调用搞定。** 而第二轮暴露的问题（schema 不校验、动作后快照是动作前的 DOM）是**静默错误**，比报错更危险。

---

## 1. 方法

- **目标页面**：`demo/index.html` —— 一个真实的 three.js WebGL viewer（VITRINE）。刻意选最难的一类：DOM 里几乎只有 3 个按钮，应用状态全在 module scope，加载路径是异步的。
- **agent 唯一的通道**：`harness/browser.mjs` —— 一个 CDP attach 客户端（agent 自己拉起的 Chrome）。这刻意**不是**本项目的桥，而是任何 coding agent 本来就有的东西。
- **隔离**：每个 agent 一个独立 Chrome（独立 CDP 端口 + 独立 profile），互不干扰。
- **禁止**：读取 `src/` 下工具实现。测试工具面，用内部实现就废了这次测试。
- **要求归因**：每个事实必须标注来自 (a) 页面暴露的工具 (b) 原始 `eval` (c) 页面源码 (d) 宿主机 shell。**这份归因才是真正的测量结果**——它告诉你工具面到底挡在了哪一层。

---

## 2. 第一轮 · Agent B：加载模型

### 结果：失败

模型最终被加载了，但**不是靠工具面**：agent 在宿主机做 `base64`，再用 raw `dev_eval` 手写 `DataTransfer` 往 `<input type=file>` 里塞字节。

### 原文摘录

> 阻塞性缺口是**文件上传**。这个应用接受模型的唯一途径是一个隐藏的 `<input type=file>`（或 drop 事件）。工具列表里没有任何东西能把字节送进这两者之一。

> 对 `e1`（PROJECT MODEL）调 `dev_click` 是最自然的动作，而它是一个**假成功**：它返回 `Clicked e1 (button#btnLoad "PROJECT MODEL")`，exit 0，控制台无报错，而状态从未改变。在 headless Chrome 里 file chooser 根本不会去任何地方——工具面不会给你任何信号说"你打开了一个无法驱动的原生对话框"，也没有办法应答它。

> 隐藏 input 对快照不可见（只列出 3 个按钮），所以它**没有 ref**，`dev_read`/`dev_fill` 都指不到它。而且就算有 ref，`dev_fill` 也会拒绝：`Error from dev_fill: element is not fillable (expected input, textarea, or contenteditable)`。

> 字节也不可能从页面内部取到：origin 是 `http://127.0.0.1:8940`，`/tmp/triangle.glb` 没有被 serve，所以 `fetch('file:///tmp/triangle.glb')` 被挡。只能靠**宿主机 shell** 桥（`base64`）。更大的模型会逼出分块注入——eval 这条路不可扩展。

### 它列出的缺失工具

1. **`dev_set_files { ref, paths }`** ——"最重要的遗漏"。
2. **`dev_screenshot`** —— 对 WebGL 页面，这是唯一能确认模型**真的画出来了**的手段；`renderer.triangles: 1` 只说明"提交了"，不说明"可见"。
3. **`dev_snapshot { include_hidden }`** —— 页面最主要的那一个控件恰恰是隐藏的。
4. **`dev_wait`** —— 应用有 15–20s 的 MATERIALIZING 动画，agent 只能在 bash 里 sleep 再轮询。

### 顺带发现的旁证

> **加载过程中 DOM 在说谎。** 在 reveal 期间 `#stExhibit` 被进度条覆盖（`MATERIALIZING [####······] 040%`），而 `#stTris` 整段 ~15s 都保留着**陈旧的占位值** `12`。刚 `dev_eval` 完，只看 DOM 会得出"12 个三角形、还在加载"，而真相（`vitrine_state.triangles`）已经是 `1`。**只测 DOM 文本的人会错误地断定加载失败。**

这条是"应用自注册工具"价值最强的论据。

---

## 3. 第二轮 · Agent C：同一任务，修复后重跑

### 结果：成功，一次工具调用

### 原文摘录

> 加载本身是**一次页面工具调用** —— `dev_upload` 配合真实 `/tmp/triangle.glb` 的 base64。我只有一次动了 raw `eval`（侦察一个状态全局变量，没找到），宿主机 shell 只用于 `status`/`tools`/`screenshot`、字节比对和 base64 —— **从未用于做工具面能做的事**。

### 它仍然指出的两个缺口

1. > `dev_upload` 读不到宿主机路径，而它自己的描述里点名了一个 CDP `DOM.setFileInputFiles` 兜底——但这个 CLI 并没有暴露它。
2. > `dev_wait` 里没有任何东西能观测这个应用的状态，因为应用变量是 module scope 的，唯一的窗口是它自己的 `vitrine_state` 工具——所以我只能在 shell 里轮询它。

第 1 条是真问题（已在 CDP 侧补上 `browser.mjs upload`）。
第 2 条是**描述问题**不是能力问题：`dev_wait` 的 `code` 谓词本来就能调 app 工具，只是描述没教这个写法。已写进工具描述。

---

## 4. 第三轮 · Agent A：诊断任务

### 结果：任务完成。诊断结论

> **"永远加载不完"是假的。** `reveal` 精确到达 1，`revealing` 翻成 `false`，占位和真实 GLB 都如此；页面自己的状态栏独立印证。无报错、无 rejection、无卡死。

> 用户实际看到的是**慢动作，不是挂起**。进度是**按动画帧**推进的，`dt` 被 clamp 到 50ms。在这个页面 ~1.4 fps 下，1.6s 的动画 = 32 帧 ≈ 13–23s 墙钟时间。实测端到端 **~29s**，而 60fps 下是 ~2.7s。在 GPU 机器上动画正常；SwiftShader 下比代码写的慢约 10 倍。用户盯 20 秒，完全有理由说"它永远加载不完"——但它会完成。

它还独立测出了 demo 工具的一个**误导性读数**：

> `"renderer": { "drawCalls": 1, "triangles": 1, ... }` 这两个数字是**误导的**。hook 住 `WebGL2RenderingContext.prototype.drawElements/drawArrays` 后实测：2.14s 内 556 次 GL draw（~260/s），约 185 draws/帧。

`renderer.info.render.calls` 读到 1 是因为 `EffectComposer` 最后一个 pass（全屏 quad）把它重置了。**这是 demo app 自己写的工具不诚实**，不是我们框架的问题——但正好是"应用自注册的工具必须自己负责诚实"的绝佳案例。

### 它挖出的 4 个工具面 bug

1. **`hidden is not defined`** 泄漏成工具错误。（这是我在它运行期间引入又修掉的作用域 bug；但教训成立：内部 `ReferenceError` 不该长得像"你参数写错了"。）
2. **动作后的快照是动作前的 DOM** —— 点完之后两个按钮已启用，快照仍显示 disabled。
3. **`vitrine_set_shader` 不校验类型** —— `{"holo":"yes"}` 被静默接受，而它的 toggle 写法于是做了**相反**的事。
4. **工具面在会话中途变了**（11 → 13 → 15 个工具）—— 因为我边跑边重建。对真实用户是 CDN 版本固定的问题。

---

## 5. 这三个 agent 到底测出了什么

1. **"假成功"是最坏的失败模式。**
   `dev_click` 点一个会打开原生对话框的按钮，返回成功、exit 0、无报错、状态没变。**沉默的失败比报错贵得多**——agent 会一直重试。
   → 现在：工具失败一律带 `Error from <tool>: ` 前缀 + 非零退出码；`--json` 给 `{ok, tool, result}`。

2. **schema 不校验 = 静默做错事。**
   `{"holo":"yes"}` 不是"报错"，是**翻转成了相反的值**。这比缺工具危险。
   → 现在：`register()` 在运行前校验 type/required/enum/items。

3. **应用自注册的工具是最高价值的那一半，而且是唯一的那一半。**
   Agent A 枚举了 `window` 的 1106 个属性，**没有任何 app 全局变量**；`eval` 结构性地够不到 module scope。
   > "the page is a **black box to `eval` by construction**; the two registered tools are the only window into it"
   → 这不是我们猜的，是测出来的。

4. **"agent 拥有浏览器"这个前提是对的。**
   三个 agent 全程只用了 CDP attach，没有 relay、没有扩展、没有 MCP server。需要桥的那个场景在这几轮里**从未出现**。

5. **页内 vs CDP 侧的边界是真的。**
   上传宿主机路径、截图——这两件事页内工具**原理上做不到**。agent 们反复试图让页内工具做这两件事，都撞墙了。边界必须写进工具描述（已写）。

---

## 6. 发现项台账

| # | 发现 | 来源 | 处置 | commit |
|---|---|---|---|---|
| 1 | 没有文件上传能力 | B | 新增 `dev_upload`（url / base64，ref 可省，自动找 file input） | `9152183` |
| 2 | 隐藏元素对所有工具不可见 | B | `dev_snapshot { include_hidden }`，标记 `hidden` | `9152183` |
| 3 | 没有等待原语，agent 在 bash 里 sleep 轮询 | B | 新增 `dev_wait`（selector / text / predicate），描述里教"等 app state"的写法 | `9152183` / `3f9a80f` |
| 4 | 工具失败退出码为 0 | B | 统一失败前缀 + 退出码；`call --json` | `9152183` / `3f9a80f` |
| 5 | schema 不校验，静默做相反的事 | A | `register()` 前置校验 type/required/enum/items | `3f9a80f` |
| 6 | 动作后快照是动作前的 DOM | A | 快照延后一帧，并在文案里说明 | `3f9a80f` |
| 7 | `dev_upload` 返回异步前的陈旧快照 | A | 上传默认不带快照 | `3f9a80f` |
| 8 | 内部 `ReferenceError` 长得像参数错误 | A | 区分为 internal bug，并说明重试无用 | `3f9a80f` |
| 9 | 改名：`buttons:{shader:true}` 读起来像"启用" | A + B | demo 工具改名为 `disabled` | `9152183` |
| 10 | `dev_upload` 读不到宿主机路径 | C | CDP 侧补 `browser.mjs upload <path...>`（`DOM.setFileInputFiles`） | `3f9a80f` |
| 11 | 没有截图 | A + B + C | CDP 侧补 `browser.mjs screenshot`（理由见 §5.5） | `9152183` |

---

## 7. 外部复测（另一 agent，同日）

在 §2–§4 三轮之后，**另一个 agent**（dev3 / Hermes，Chrome 147 软渲染 + SSH 到本机 Chrome 151）
独立复现了公开 demo，产出 [`03`](03-verification-demo-2026-10-03.md) / [`04`](04-verification-drive-rerun-2026-10-03.md)
两份报告。结论一致：15/15 工具可用，两种 runtime 各 20/20 通过。

它找出了**三个我没发现的真 bug**：

| 发现 | 证据 | 修复 |
|---|---|---|
| badge 计数陈旧 | 角标显示 `dev-webmcp · 13 tools`，实际 15 条 | 订阅 registry 变更重绘；现在显示 `13 + 2 tools`，显式区分包自带与应用注册 |
| `dev_upload` 的 `include_snapshot` 默认值与自身文案**相反** | 实现传 `?? false`，prop 描述写的是 `Default true` | 给它独立的属性描述 |
| `dev_wait` 吞掉谓词异常 | `code: 'nope.value > 1'` 只返回 `Timed out after 300ms`，agent 分不清"条件没到"和"谓词写错" | 超时消息里带上最后一次异常 |

外加一个**方法学陷阱**，是这批报告里最有价值的一条：

> headless Chrome 无 GPU 时 `new THREE.WebGLRenderer` 抛未捕获异常 → **应用模块求值中断** →
> 它末尾的两处 `window.devWebmcp.register(...)` 从未执行 → `getTools()` 只有 13 条。

它一开始把这误判成"应用工具注册失败"，加上 `--enable-unsafe-swiftshader --use-angle=swiftshader`
后恢复 15 条。这是一类**通用**陷阱：应用把工具注册写在模块末尾，模块里任何更早的异常都会
**静默吃掉全部注册**，而且失败长得和"没注册"一模一样。
对本包的设计含义：把 `register()` 放在应用最早的初始化路径上，不要让它在一次 WebGL 失败后就消失。

它还独立确认了几件值得记的事：

- `window.WebMCP` 这个全局**不存在**，不要按它探测；`document.modelContext` 是 `Document.prototype` 上的属性，`constructor.name === "ModelContext"`。
- `executeTool()` 第一个参数必须是 `getTools()` 返回的 **RegisteredTool 对象**，传工具名会得到 `TypeError: RegisteredTool must be an object`。第二个参数是 **JSON 字符串**。
- `dev_eval` 实测能读 `document.cookie` / `localStorage`——与 README "dev-only by construction" 一致。

它的复测也踩到了同一类"静默忽略参数"：`dev_scroll {"delta_y":200}` 被当成 0 静默通过并返回成功
（我自己的 schema 用的是 `dx`/`dy`）。这直接促成了 `validate()` 现在**拒绝未知属性**并列出可接受的键名。

## 8. 未解决 / 存疑

- **Agent A 报了一个无法复现的现象**：一次 404 上传之后，连续 10 次 `vitrine_state` 返回非 JSON。但它自己用 `head -1` 截断了消息，没留下证据。未追。现在有 `--json`，下次会留下完整记录。
- **Agent A 坚持截图是最大缺口**，而我把它放在 CDP 侧。对"agent 拥有浏览器"这个主路径这是对的；对"agent 不拥有浏览器"那个次要场景，页内确实无解（`canvas.toDataURL` 只在 app 保留了 drawing buffer 时可用，`gl.readPixels` 返回全零）。
- **工具面在会话中途变更**（#4 of Agent A）——生产形态下 CDN URL 必须版本固定，否则消费方的工具集会在脚下换掉。这条只在 CDN 发布策略里解决，代码层无解。

---

## 9. 复现方式

```bash
node build.mjs
node serve.mjs &                                  # http://127.0.0.1:8940/demo/
node harness/browser.mjs start http://127.0.0.1:8940/demo/
node harness/browser.mjs tools
node harness/browser.mjs call dev_snapshot
node harness/browser.mjs upload /tmp/triangle.glb # CDP 侧：宿主机路径
node harness/browser.mjs call dev_upload '{"files":[{"name":"t.glb","url":"/fixtures/triangle.glb"}]}'
node harness/browser.mjs screenshot /tmp/shot.png
```

给下一个 agent 的 prompt 模板见本文件 §1「方法」——关键是**归因要求**和**禁止读实现**。
