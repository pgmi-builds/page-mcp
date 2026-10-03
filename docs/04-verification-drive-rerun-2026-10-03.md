# dev-webmcp 复测报告 — drive 套件 + 消费模型

> 日期：2026-10-03 20:45 HKT · 状态：复测通过（与 `03-verification-demo-2026-10-03.md` 结论一致）
> 被测：<https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/>
> 执行：Hermes default profile（dev3）→ 通过 SSH 在 PC 上跑 `harness/drive.mjs` + `harness/browser.mjs`
> 环境：PC（homepc）· Chrome 151.0.7922.173 · Node v22.22.1 · bundle `devtools.js` v0.0.1

---
> 归档说明：本文件原名为 `02-drive-rerun-2026-10-03.md`，因与
> `02-measurements.md` 撞号，改编号为 04。**正文未改**，仅把指向 03 报告的引用更新为新文件名。


## 0. 结论

**行，而且有用。** 本次重新跑了一遍仓库自带 E2E 套件，针对线上发布件，结果 **20/20 通过**（native + polyfill 各一轮），与 03 报告一致。

| runtime | 浏览器 | 工具数 | drive.mjs |
|---|---|---|---|
| native `--enable-features=WebMCP` | Chrome 151（PC） | 15 | **20/20 PASS** |
| polyfill（无 flag） | Chrome 151（PC） | 15 | **20/20 PASS** |

15 = 13 条包自带 `dev_*` + 2 条应用自注册（`vitrine_state` / `vitrine_set_shader`）。

---

## 1. drive.mjs 断言矩阵（本轮全量输出）

每轮 10 断言，两轮共 20。关键证据：

| 断言 | native | polyfill | 证据摘要 |
|---|---|---|---|
| modelContext 可用 | ✅ | ✅ | `native=true` / `polyfilled=true`，tools=15 |
| getTools() 枚举 pack+app 工具 | ✅ | ✅ | 15 条 |
| snapshot 在 canvas 页可用 | ✅ | ✅ | 3 按钮，`[e2] disabled` 有标记 |
| 点 disabled 控件给出可读报错 | ✅ | ✅ | "is disabled — clicking it does nothing" |
| app 工具暴露 WebGL 场景状态 | ✅ | ✅ | `exhibit/triangles/reveal/shader/camera` |
| app 工具在按钮 disabled 时改状态 | ✅ | ✅ | `shader holographic → original` |
| console 捕获（无 devtools session） | ✅ | ✅ | `[dev-webmcp] 0.0.1 ready` + three.js warn |
| eval 触达全局、诚报 module scope | ✅ | ✅ | `canvases:1 webgl:true moduleScopeVisible:undefined` |

`debugging` 注解：本轮再次确认两个 runtime 都被 Chrome 151 丢弃（只回 `readOnlyHint` / `untrustedContentHint`），与 README 记录一致。

---

## 2. 消费模型实测（browser.mjs，agent 自持浏览器走 CDP）

agent 直接 CDP attach，无 relay / 无扩展 / 无 MCP server：

| 命令 | 结果 |
|---|---|
| `start <url>` | browser up on :9222 |
| `status` | `webmcp=available`，`devWebmcp=0.0.1` |
| `tools` | 15 条全列出 |
| `call dev_snapshot` | 3 按钮 outline |
| `call dev_read {ref:e1}` | `<button#btnLoad>` role/name/text/rect/attrs/style/selector 全齐 |
| `call dev_scroll {delta_y:200}` | `scrolled to y=0`（body overflow:hidden，无滚动内容，优雅返回） |
| `call dev_select {ref:e1}` | `missing required property "value"`（参数校验，未执行） |
| `call dev_fill {ref:e1}` | `element is not fillable (expected input, textarea, or contenteditable)` |

> 注意：`ref` 是 snapshot 作用域——换过 snapshot 后旧 ref 失效，需先 `dev_snapshot` 再 act（`dev_read e1` 在未快照时返回 "No live element … Take a new snapshot"）。03 报告 §2.2/§3 已详述，非 bug。

---

## 3. 与 03 报告的关系

本文件是**复测确认**，不重复 01 的完整内容。03 报告仍是对仓库 HEAD 的权威实测，其 §4 的 7 条问题清单（badge 计数陈旧、`dev_upload` include_snapshot 文案相反、`dev_wait` 吞谓词异常、`debugging` 丢弃、`NaN` 校验、favicon 404、`dev_eval` 任意 JS）本轮复测仍成立，无新增问题。

### 问题清单（沿用 01，按优先级）

| 级别 | 问题 |
|---|---|
| HIGH | `dev_eval` 页面内任意 JS（可读 cookie/localStorage），无 allow-list，仅 permission-policy 兜底——禁进生产 |
| MEDIUM | `dev_wait` 吞谓词异常（agent 分不清"条件未到" vs "谓词写错"） |
| MEDIUM | `dev_upload` 的 `include_snapshot` 默认值与其文案相反 |
| LOW | badge 计数陈旧（显示 13，实际 15，未计入应用后注册工具） |
| LOW | `debugging` 注解被 Chrome 151 丢弃（Chrome 156 前消费端无法靠它过滤） |
| LOW | 本 demo 无 `<select>`/file input 可见路径，select/upload/scroll 只能验参数校验与优雅报错 |

---

## 4. 复现命令

```bash
cd ~/workspaces/browser-agent/dev-webmcp
DEMO_URL=https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/ npm run drive

# 消费模型
node harness/browser.mjs start https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/
node harness/browser.mjs tools
node harness/browser.mjs call dev_snapshot
```
