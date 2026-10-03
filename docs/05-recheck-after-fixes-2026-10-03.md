# dev-webmcp 复验 — `a4bffe6` 的三条修复

> 日期：2026-10-03 21:22 HKT · 状态：**三条修复全部生效，无回归**
> 被测：git `a4bffe6`（docs: collect external agent reports; fix the three bugs they found）
> 版本锁定：`dist/devtools.js` sha256 `bb52fb9e1405b212a475ab01a047d83c07c17361cf5479339bbbc5d6f682c632`，
> 2406 行 / 101544 B，与线上文件**逐字节相同**；`index.html` 未变
> 对照：`03-verification-demo-2026-10-03.md`（上一版 `52dbf98e…` 的三条 nit）
> 执行：dev3-deepseek-default（Chrome 147.0.7727.137 + `--enable-unsafe-swiftshader --use-angle=swiftshader`）
> ＋ PC `harness/drive.mjs`（Chrome 151.0.7922.173，native flag 与 polyfill 两轮）

---

## 0. 结论

`03` 报告里的三条问题**全部修好并实测通过**，配套回归全绿：

| 项 | 结果 |
|---|---|
| PC `harness/drive.mjs`（打线上发布件，native + polyfill） | **20/20 PASS**，工具数各 15 |
| dev3 软渲染 `getTools()` | 15（13 `dev_*` + `vitrine_state` + `vitrine_set_shader`） |
| 官方 fixture 上传 → 安装 → RESET 闭环 | 通过（见 §3） |
| 三条修复（badge / upload 默认值 / wait 谓词异常） | 通过（见 §1） |

---

## 1. 三条修复逐条复验（实测字符串）

### F1 · badge 计数（03 §4-1）✅

- 角标：`dev-webmcp · 13 + 2 tools · polyfill`（原来是写死的 `13 tools`）
- 展开面板：`tools (15)`，并列出全部工具，应用工具带 `(app)`：
  `… dev_upload vitrine_state (app) vitrine_set_shader (app)`
- 生效机制是注册表 `subscribe/emit` 重绘，不是第二次取巧：页面 400–500 ms 后（应用模块注册完）计数已稳定为 `13 + 2`。
- 保留了"包自身 / 应用"的分解，比单一数字更有信息量。

### F2 · `dev_upload` 的 `include_snapshot` 默认值（03 §4-2）✅

- 省略 `include_snapshot` → `Attached triangle.glb (624 bytes) to the file input and fired input+change`，
  **不含** `Page now`（`upload_default_has_outline = false`）
- 显式 `include_snapshot: true` → 附带一帧后的 outline（`Page now (outline taken one frame after the action; …)`）
- 该 prop 现在有独立文案，且 `getTools()` 返回的就是这句（agent 实际看到的）：
  `Include a page outline in the result. Default false — file parsing is always async, so an outline taken here would show pre-upload state.`
- 实现与文案一致，且理由（上传是异步解析，此刻 outline 只会显示上传前状态）说得通。

### F3 · `dev_wait` 谓词异常（03 §4-3）✅

- 抛异常的谓词 `code: "nope.value > 1"`：
  `Timed out after 300ms waiting for nope.value > 1.` +
  `The predicate THREW on every attempt, so this may be a broken condition rather than a slow one: ReferenceError: nope is not defined` +
  当前 outline
- 合法但为假的谓词 `code: "1 > 2"`：只有 timeout，**无** THREW 段 → 两种情况可区分（这正是缺的能力）
- `selector` 超时：无 THREW 段；`selector: "body"`：`Condition met after 0ms`（命中路径未受影响）

---

## 2. 顺带新增：未知参数现在被拒绝（03 未提，实测确认）

```
dev_click {ref:"e1", bogus:1}
→ invalid arguments — unknown property "bogus" — accepted: ref, include_snapshot. Rejected without running.

dev_snapshot {max_nodes:5, extra_a:1, extra_b:2}
→ invalid arguments — unknown properties "extra_a", "extra_b" — accepted: root, max_nodes, include_hidden. Rejected without running.
```

- **赞成**：拼错的参数不再静默失效（commit 说明里另一个 agent 的 `delta_y` 案例：滚动 0 却报成功，是最坏的一种失败）。
- **需留意**：这是新加的严格性——第三方 MCP 客户端/封装若在 arg 里带额外字段，会被整体拒绝而不是忽略。
  本机两个 runtime + drive 套件（20/20）都不受影响；建议在 README「Boundaries and known limits」补一行说明。

---

## 3. 回归检查

| 项 | 结果 |
|---|---|
| 官方 fixture 上传 → 安装 | `exhibit:"triangle.glb", triangles:1, disabled:{shader:false, reset:false}` |
| `dev_click` RESET | 回到 `placeholder · cube`，两个按钮重新 disabled |
| spec 路径 `executeTool(RegisteredTool, jsonString)` | 正常（`vitrine_state` 复读通过） |
| `dev_snapshot` / `dev_read` / `hover` / `press` / `scroll` / `console` / `eval` | 与 03 报告一致，无变化 |
| ref 失效诊断 | 仍为 `No live element for ref "e1" — it was removed or replaced. Take a new snapshot.` |
| 参数校验（类型/必填/items） | 仍生效（`invalid arguments … Rejected without running.`） |

---

## 4. 仍未变（非本次可修）

- `debugging` 注解在 native 与 polyfill 两边都被丢弃（Chrome 151 层；Chrome 156 前消费端别指望用它过滤）。
- headless 不带 swiftshader flag 仍只看到 **13 条**工具（应用模块在 `new THREE.WebGLRenderer` 处中断）——方法论坑，已在 commit 说明与 03 报告记录。
- `dev_eval` 仍是页面内任意 JS，无沙箱（README 已声明 Dev-only）。
- 页面 `/favicon.ico` 404（无害）。

---

## 5. 复现

```bash
# PC：拿线上发布件跑仓库自带套件
cd ~/workspaces/browser-agent/dev-webmcp
DEMO_URL=https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/ npm run drive

# dev3：软渲染 headless + CDP（必须带这两个 flag，否则只有 13 条工具）
node .scratch/webmcp-demo/cdp.cjs \
  https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/ probe6.js
```

## 6. 证据留存

- 本次 PC drive 完整日志：`.tmp/evidence/drive-2026-10-03-recheck.log`
- dev3 侧脚本：`cdp.cjs`（软渲染 CDP driver）、`probe6.js`（三条修复 + 未知参数）、`probe7.js`（badge 全文 + live schema）
