# dev-webmcp 实测报告 — 公开 demo 与自定义工具面

> 日期：2026-10-03 · 状态：实测完成
> 被测：<https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/>
> 发布目录：`/home/u1/view-dir/2026-10-03_webmcp-devtools-demo/`（`index.html` + `devtools.js` + `preview.png`）
> 版本锁定：`dist/devtools.js` sha256 `52dbf98e0c472a474783137a363fde36a60fad5acd4e09d96d85af86ee11919b`，
> 与线上文件**逐字节相同**；git HEAD `3f9a80f`（fix: schema validation, frame-accurate post-action snapshots, machine-readable CLI）
> 发布副本与 `demo/index.html` 仅差一行：`<script src="/dist/devtools.js">` → `<script src="./devtools.js">`
> 执行：dev3-deepseek-default（Chrome 147.0.7727.137，SwiftShader 软渲染） + 本机 `harness/drive.mjs`（PC，Chrome 151.0.7922.173）

---
> 归档说明：本文件原名为 `01-demo-verification-2026-10-03.md`，因与
> `01-agent-usability-test.md` / `02-measurements.md` 撞号，改编号为 03。**正文未改**，
> 仅更新了指向本文件旧名的交叉引用。


## 0. 结论

**行，而且有用。** 15/15 工具可用，两种 runtime 各 20/20 通过。

| runtime | 浏览器 | 工具数 | `harness/drive.mjs` |
|---|---|---|---|
| native `--enable-features=WebMCP` | Chrome 151.0.7922.173（PC） | 15 | **20/20 PASS** |
| polyfill（无 flag） | Chrome 151（PC）/ Chrome 147.0.7727.137（dev3） | 15 | **20/20 PASS** |

三条最有说服力的证据：

1. **画布页面 DOM 只有 3 个按钮，`vitrine_state` 能读出整个场景状态**——
   `exhibit / triangles / reveal / shader / camera{position,target} / renderer{drawCalls,triangles,geometries,programs}`；
   同一份状态用 `eval` 读不到（drive 专门断言 `moduleScopeVisible: "undefined"`）。
2. **`dev_upload` 全链路**（dev3 独立复现，官方 fixture）：
   `Attached triangle.glb (624 bytes) to the file input and fired input+change`
   → 页面 toast `EXHIBIT INSTALLED — TRIANGLE`
   → `vitrine_state`: `exhibit:"triangle.glb", triangles:1, disabled:{shader:false, reset:false}`
   → `dev_click` RESET → 回到 `placeholder · cube`，两个按钮重新 disabled。
3. **应用工具在 UI 按钮 disabled 时照样能改状态**（`vitrine_set_shader` → `shader = original`）——
   这是"应用工具 ≠ DOM 操作"最直接的证明，也是本包相对"通用 click/eval"的差异化所在。

---

## 1. 关键修正：13 tools 还是 15 tools，取决于 WebGL

第一次在 dev3 无 GPU 的 headless Chrome 上跑，`getTools()` 只有 **13 条** `dev_*`，应用自己注册的两条工具不见了。
原因不是注册失败，而是应用模块**在注册之前就中断了**：

```
[error] THREE.WebGLRenderer: Error creating WebGL context.
[uncaught] Uncaught Error: Error creating WebGL context.
```

`new THREE.WebGLRenderer`（`demo/index.html` L142）抛未捕获异常 → 模块求值终止 →
其后所有 `addEventListener` 和文件末尾的两处 `window.devWebmcp.register(...)` 都没有执行。
（该 demo 的 `vitrine_state` 在 `demo/index.html` L683、`vitrine_set_shader` 在 L714。）

| 环境 | `getTools()` |
|---|---|
| dev3 headless，无 GL | 13（只有包自带工具） |
| dev3 headless + `--enable-unsafe-swiftshader --use-angle=swiftshader` | **15** |
| PC Chrome 151 native flag | **15** |
| PC Chrome 151 polyfill | **15** |

**结论**：headless 验证**必须**带软渲染 flag。否则测到的只是半个工具面（13 条 dev 工具 + 0 条应用工具），
而且页面所有 DOM 监听器都不存在——此时"点了没反应"会被误判成工具的问题。

---

## 2. 逐项实测结果

### 2.1 runtime / 发现 / 注解

- `document.modelContext` 是 `Document.prototype` 上的 own property，`constructor.name === "ModelContext"`
  （符合 2026-05-27 draft）；`navigator.modelContext` 存在但只是 deprecated shim；
  `window.WebMCP` **不存在**（没有这个名字的全局，别按它探测）。
- `devWebmcp.runtime()`：dev3/Chrome 147 → `{native:false, polyfilled:true, polyfillFailed:false, hasModelContext:true}`；
  PC/Chrome 151 + flag → `native=true polyfilled=false`。
- 注解：`getTools()` 只保留 `readOnlyHint` / `untrustedContentHint`；
  **`debugging` 在 native 与 polyfill 两边都被丢弃**（Chrome 151 实测，与 README 已记录的 Chrome 151 现象一致）。
  即 Chrome 156 之前，消费端无法用 `debugging` 过滤 dev 工具。

### 2.2 调用姿势（容易踩）

`document.modelContext.executeTool()` 严格按 spec：第一个参数必须是 `getTools()` 返回的 **RegisteredTool 对象**，
第二个参数是 **JSON 字符串**；传工具名会得到 `TypeError: RegisteredTool must be an object`（polyfill 行为正确，不是 bug）。

```js
const t = (await document.modelContext.getTools()).find(x => x.name === 'dev_snapshot');
await document.modelContext.executeTool(t, JSON.stringify({})); // spec 路径
await devWebmcp.invoke('dev_snapshot', {});                     // 包内快捷方式
```

### 2.3 动作类工具

| 工具 | 实测 |
|---|---|
| `dev_snapshot` | 画布页面给出 3 个按钮，disabled 有标记 |
| `dev_read` | `ref=e1 <button#btnLoad>` + role/name/text/rect/attrs/value/style/selector 全齐 |
| `dev_click` | 真指针序列 + native click；disabled 元素给诊断；RESET 生效 |
| `dev_hover` | `Hovered e1.` + 一帧后 outline |
| `dev_scroll` | `scrolled to y=0`（页面无滚动，符合预期） |
| `dev_press` | `Pressed Tab.` |
| `dev_wait` | `Condition met after 0ms: selector "body"`；超时结果带当前 outline |
| `dev_eval` | `→ 2`；异常带完整 stack |
| `dev_console` | 抓到 three.js WebGL 报错与 `[dev-webmcp] 0.0.1 ready …` |
| `dev_fill` / `dev_type` / `dev_select` | 在 `<button>` 上给出语义化错误：`element is not fillable (expected input, textarea, or contenteditable)` / `not typable …` / `element is not a <select>` |
| `dev_upload` | 见 §0-2；`url` 与 `base64` 两种入参；都不给时 `file "x.glb" needs either a url or base64` |

### 2.4 应用自定义工具（最有价值的一半）

- `vitrine_state`（`readOnlyHint: true`）：一次调用返回 `exhibit / triangles / reveal / shader / camera / renderer / disabled`。
- `vitrine_set_shader`：在按钮 disabled 时依然 `shader = original`（读写都走 module scope）。
- 两条都通过 `window.devWebmcp.register()` 注册，`getTools()` 可见、`executeTool()` 可调，与包自带工具同构。

---

## 3. 本修订（`3f9a80f`）加固项逐条验证

| 变更 | 实测 |
|---|---|
| 参数 schema 校验（执行前拒绝） | `dev_click {ref:123}` → `invalid arguments — ref: expected a string, got 123. Rejected without running.`；缺必填 → `missing required property "ref"`；`files:["a.glb"]` → `files[0]: expected an object`；spec 路径与 `invoke()` 行为一致 |
| ref 失效由"软提示"改为抛错 | `No live element for ref "e99" — it was removed or replaced. Current page: …`（附带当前 outline，可直接换用新 ref） |
| 动作后快照改为"一帧之后" | `Page now (outline taken one frame after the action; async work may still be in flight — use dev_wait to wait on it)` |
| 内部错误归因分支（`ReferenceError`/`TypeError`） | 真实场景未能自然触发，属防御性代码，**未验证** |
| `snapshotAfterAction` 默认开 | 动作类工具默认带 outline；`dev_upload` 例外，见 §4-2 |

---

## 4. 发现的问题与建议（按优先级）

1. **角标计数陈旧（假信息）**：badge 显示 `dev-webmcp · 13 tools · polyfill`，实际 15 条。
   `src/badge.js:47` 在包加载时取一次 `api.specs()`，`src/index.js:57` 只渲染一次，
   应用随后注册的两条工具不会反映到计数上。建议监听 `context.ontoolchange` 重渲染，或显示 `13 + 2` 这样的分解。
2. **`dev_upload` 的 `include_snapshot` 默认值与自身文案相反**：`src/tools.js:428` 传 `include_snapshot ?? false`，
   而同一个 prop 的描述（`src/tools.js:81`）写的是 `Default true`；其他工具走 `after()` 的
   `includeSnapshot ?? snapshotAfterAction`（`src/tools.js:73`，默认 true）。要么统一默认值，要么改文案。
3. **`dev_wait` 吞掉谓词异常**：`code: 'nope.value > 1'`（ReferenceError）、`(undefined).foo()`（TypeError）、
   语法错误一律返回 `Timed out after 300ms waiting for …`。agent 分不清"条件还没到"和"谓词写错了"。
   建议像 `dev_eval` 一样把异常打出来。
4. **`debugging` 注解在两个 runtime 都被丢弃**（Chrome 151）——README 已记录，本报告补一次复现；
   Chrome 156 之前不要指望消费端能靠它过滤。
5. `validate()` 认为 `NaN` 是合法 `number`（`typeof NaN === 'number'`）；JSON 传不进 NaN，实际无害。
6. 页面加载时 404：`/favicon.ico`。无害。
7. `dev_eval` 是页面内任意 JS（实测可读 `document.cookie` / `localStorage`），无 allow-list、无用户手势门槛，
   仅靠 `tools` permission-policy 兜底——与 README "Dev-only by construction" 一致，禁止进生产构建。

---

## 5. 复现命令

```bash
# PC：仓库自带套件打"线上发布件"（本次 20/20，native + polyfill 各一轮）
cd ~/workspaces/browser-agent/dev-webmcp
DEMO_URL=https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/ npm run drive

# dev3：软渲染 headless + CDP（本报告的独立复现路径）
#   Chrome 必须带 --enable-unsafe-swiftshader --use-angle=swiftshader，否则只能看到 13 条工具
node .scratch/webmcp-demo/cdp.cjs https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/ probe5.js
```

浏览器控制台一行自检：

```js
devWebmcp.runtime();
document.modelContext.getTools().then(ts => console.log(ts.length, ts.map(t => t.name)));
// 期望：{native:…, polyfilled:…, hasModelContext:true} 与 15 条（含 vitrine_state / vitrine_set_shader）
```

---

## 6. 证据留存

- PC 完整 drive 日志（native + polyfill 两轮全量输出）：`.tmp/evidence/drive-2026-10-03-published.log`
- dev3 侧脚本与原始产物：dev3 `/home/u1/workspaces/base/.scratch/webmcp-demo/`
  （`cdp.cjs` 软渲染 CDP driver、`probe.js` / `probe5.js`、`live/` 线上文件快照）
- 线上文件的 sha256 见文首；`dist/devtools.js` 与线上文件一致，故本报告结论对仓库 HEAD 成立。
