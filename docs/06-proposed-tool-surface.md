# 06 · 截图与工具面扩展建议（含实测）

> 日期：2026-10-03 · 状态：建议稿（待拍板）
> 依据：`03-verification-demo-2026-10-03.md`、`05-recheck-after-fixes-2026-10-03.md` 的实测，
> 以及本次针对 capture 的专项实测
> 被测版本：`a4bffe6`，线上 `devtools.js` sha256 `bb52fb9e1405b212a475ab01a047d83c07c17361cf5479339bbbc5d6f682c632`
> 执行：dev3-deepseek-default，Chrome 147 + `--enable-unsafe-swiftshader --use-angle=swiftshader`

---

## 0. TL;DR

1. **页面内整页截图：不做。** 页面没有 DOM 光栅化原语；agent 本来就拥有 CDP，`Page.captureScreenshot` 一行就够。
2. **局部截图：做，但拆两层。** 页面只回答「哪个元素 / 在哪 / 什么状态」（新工具 `dev_box`），像素由 CDP 按 rect 裁。
   实测：`#btnShader` rect `130.34×33` → clip → PNG **正好 130×33 / 4770 B**。
3. **canvas 截图：可行但时序极脆，因此属于「应用自己的工具」，不做通用 `dev_screenshot`。**
   实测同一块画布：非 rAF 上下文读到 **全黑**，rAF 回调内读到真内容 —— `toDataURL` 两种情况都返回合法 PNG。
4. 另外建议 6 个工具：`dev_network` / `dev_observe`(+`dev_diff`) / `dev_box` / `dev_geometry_audit` / `dev_perf` / `dev_drag`。

---

## 1. 截图专项实测（原始数据）

| 实验 | 结果 |
|---|---|
| 页面内 `drawImage(vitrineCanvas)`，从 `setTimeout` 读 | **0 / 4096 非黑像素（全黑）** |
| 同上，在 `requestAnimationFrame` 回调内读 | **3333–3412 非黑像素（真内容）** |
| `vitrineCanvas.toDataURL('image/png')`，rAF 内 | 944 710 字符（有效 PNG，含模型） |
| 合成 canvas（attached，默认 opts）：绘制后同任务读 / 隔帧读 | 4096 / **0** |
| 合成 canvas（`preserveDrawingBuffer: true`）：同任务 / 隔帧 | 4096 / 4096 |
| CDP `Page.captureScreenshot{clip, captureBeyondViewport}`，rect 130.34×33 | PNG **130×33 / 4770 B** |

**结论**：无 `preserveDrawingBuffer` 时，WebGL 画布内容只在「同一帧的任务内」可读。
`toDataURL()` 在帧外**照样成功返回**一个 ~700 KB 的合法 PNG，内容全黑 —— 这是最坏的失败模式：agent 会把它当证据。
`demo/index.html:142` 的 `new THREE.WebGLRenderer({ antialias:true })` 正是这种配置。

---

## 2. 分层责任（谁负责什么）

| 能力 | 归属 | 理由 |
|---|---|---|
| 整页 / 跨视口 / 设备模拟下的像素 | **CDP** | 页面无 DOM 光栅化；`captureBeyondViewport`、`Emulation.setDeviceMetricsOverride` 都只在 CDP |
| 元素级裁剪 | **CDP 裁，页面给坐标** | 页面能精确知道 rect / dpr / scroll / 遮挡状态 |
| 画布像素（3D、图表） | **应用自己的工具**（或包内 rAF 内读 + 全黑检测） | 只有应用知道 render loop 与合成时机 |
| 响应式断点 | **CDP 改视口，页面报告状态** | 页面不能改自身视口，但能报 `matchMedia` / 溢出 |
| 语义、几何、状态、性能 | **页面** | 外界推不出来 |

---

## 3. `dev_box(ref)` 契约（建议 schema）

```jsonc
{
  "ref": "e3",
  "selector": "button#btnReset",
  "viewportRect": { "x": 538.6, "y": 434, "w": 130.3, "h": 33 },  // getBoundingClientRect：视口坐标
  "documentRect": { "x": 538.6, "y": 434, "w": 130.3, "h": 33 },  // + scrollX/scrollY：给 CDP clip 用
  "devicePixelRatio": 1,
  "scroll": { "x": 0, "y": 0 },
  "visibleFraction": 1.0,                 // 被视口/滚动容器裁掉多少
  "paint": {
    "display": "block", "visibility": "visible", "opacity": 1,
    "clipped": false,                     // scrollWidth>clientWidth 或 scrollHeight>clientHeight
    "overflow": { "x": false, "y": false }
  },
  "coveredBy": null,                      // 见 §4.1；祖先、disabled 不算
  "hitTestable": true,                    // false = disabled / pointer-events:none / inert
  "isCanvas": false,
  "animated": false,                      // 附近有 rAF 循环 / CSS 动画在跑
  "frameRelative": false,                 // true = 在跨域 iframe 内，坐标无法映射到顶层
  "lastPaintMs": null                     // 有 rAF 循环时给帧龄，或 "raf-running"
}
```

CDP 侧映射（调用方）：

```js
clip = { x: documentRect.x, y: documentRect.y, width: w, height: h, scale: devicePixelRatio };
await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
```

---

## 4. 两个必须写进实现的坑

### 4.1 hit-test 判遮挡会误报（本页实测到的反例）

对 `#btnShader`（当时 `disabled`）中心点做检测，第一版逻辑报 `occluded: true, topAtCenter: "DIV"`；
真实堆栈是 `DIV.actions → CANVAS → DIV#scene → BODY → HTML` —— 那个 "DIV" 是它的**父节点**，
因为 disabled 的表单控件在 Chrome 里不参与命中测试。

规则：

- 用 `elementsFromPoint` 逐层，而不是只看 `elementFromPoint`；
- 跳过 `pointer-events:none` / `opacity:0` / `visibility:hidden` 的候选；
- 覆盖者是 ref 的**祖先** → 不算遮挡；
- ref 自身 `disabled` / `pointer-events:none` → 记为 `hitTestable: false`，**不是**遮挡；
- 正例：本页 `#drop` 有 `opacity:0;pointer-events:none`，上述规则把它正确跳过；
- 非矩形遮挡（圆角、镂空、mask）用「中心点 + 四角」采样，给覆盖百分比而不是布尔值。

### 4.2 坐标系与新鲜度

- **viewport vs document**：`getBoundingClientRect()` 是视口坐标，CDP clip 要 document 坐标（+scroll）。
  给了 scroll 再滚一下页面，只报 `viewportRect` 的实现会裁到隔壁元素。
- **滚动容器**：元素在内部滚动容器里时，`documentRect` 仍成立（rect 已经是最终屏幕位置），
  但 `visibleFraction` / `clipped` 必须按最近的可滚动祖先算。
- **dpr**：`scale` 不传或与 `devicePixelRatio` 不一致，截图会糊或被裁。
- **iframe**：iframe 内 rect 是 iframe 相对坐标；同源可自底向上累加偏移，跨域**不可能** ——
  这种情况要显式报 `frameRelative: true`，让 CDP 侧改用该 frame 的 session 截图。
- **新鲜度**：像素有年龄（最好情况也是一帧前）。给出 `lastPaintMs` / 是否在跑 rAF，
  否则 agent 会去 debug 一帧旧画面。

---

## 5. 建议新增工具（按优先级）

| # | 工具 | 一句话 | 关键字段 | 归属 |
|---|---|---|---|---|
| 1 | `dev_network` | fetch/XHR 环形缓冲：UI 悄悄吞掉 500 是目前最大盲区 | method, url, status, ms, failed, req/res(body 截断), initiator | 页面 |
| 2 | `dev_observe(ms)` / `dev_diff(token)` | 返回**增量**而非重拍快照：回答"我这次改动变了什么" | mutations(added/removed/changed), console, layout-affecting | 页面 |
| 3 | `dev_box(ref)` | 局部截图的契约（§3） | 见 §3 | 页面 |
| 4 | `dev_geometry_audit()` | 不需要像素就能**证明**的视觉 bug | 文字溢出/裁剪、零尺寸、屏外、图片 `naturalWidth===0`、字体未加载、对比度 | 页面 |
| 5 | `dev_perf` | "卡不卡"快照答不了 | long tasks, CLS/INP 归因, 帧耗时, rAF 循环 | 页面 |
| 6 | `dev_drag(from,to)` | 本 demo 的核心交互（拖拽旋转）现在驱动不了 | mousedown→move×N→up、wheel+modifiers、pointer 序列 | 页面 |
| 7 | `dev_storage`（可选） | 复现依赖登录态的 UI | localStorage/sessionStorage/IndexedDB/cookie 读写 | 页面 |

**不要做**：视频录制（`getDisplayMedia` 需用户手势）、OCR、DOM→图片光栅化（依赖大且失真）、
页面内"改视口尺寸"（属于 `Emulation.setDeviceMetricsOverride`）。

---

## 6. `harness/browser.mjs` 落地（小改）

现状：`screenshot [path] [--full]`。建议加：

```bash
node harness/browser.mjs shot out.png --ref e3 [--pad 8] [--scale 2] [--annotate]
```

步骤：

1. `dev_box(ref)` 拿 `documentRect`（页面侧）；
2. `x-pad, y-pad, w+2pad, h+2pad`，clamp 到 `(0, 0, documentWidth, documentHeight)`；
3. `Page.captureScreenshot({ clip, captureBeyondViewport: true })`；
4. 落盘；返回文件路径 + 实际 PNG 尺寸（便于断言没裁歪）。

配套细节：

- **先等稳定再截**：动作后先 `dev_wait`（或等一帧），否则截到旧帧；
- **canvas 元素**：`isCanvas: true` 时建议走应用工具；本仓实测 **CDP 截图对 canvas 是有效的**，
  因为它截的是合成后的页面（`.tmp/evidence/model_holo.png` 即证据）；
- **`--annotate`**：先让页面高亮目标 ref 再截，截图自解释，省掉"这张图说的哪个元素"的来回。

---

## 7. 复现

```bash
# dev3：软渲染 + CDP
node .scratch/webmcp-demo/cdp.cjs  <url> probe10.js   # attached canvas：同任务 / 隔帧 / preserveDrawingBuffer
node .scratch/webmcp-demo/cdp.cjs  <url> probe11.js   # 真实 demo 画布：rAF 内 vs setTimeout 内
node .scratch/webmcp-demo/cdp.cjs  <url> probe12.js   # hit-test 堆栈（遮挡误报反例）
node .scratch/webmcp-demo/cdp-shot.cjs <url> "#btnShader" /tmp/scoped-shot.png   # ref→rect→clip 全链路
```

脚本与原始输出留在 dev3：`/home/u1/workspaces/base/.scratch/webmcp-demo/`
（本次另有副本归档到 PC `.tmp/evidence/capture-2026-10-03/`）。
