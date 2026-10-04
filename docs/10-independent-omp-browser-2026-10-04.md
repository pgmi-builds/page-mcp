# 独立第三方复现 — omp 通用 harness 驱动线上 demo · 2026-10-04

> 日期:2026-10-04 · 状态:实测完成
> 被测:<https://view.pc.randomhash.app/2026-10-03_webmcp-devtools-demo/>(`devtools.js` 与 03 报告锁定的 sha256 同源发布件)
> 执行环境:**与本项目完全无关的通用 agent harness**(omp · GLM-5.3-flashx,dev3;
> 自带 headless Chromium,隐藏共享标签页,Puppeteer 桥)——没用 `harness/drive.mjs`,
> 没用 CDP 9222 脚本,没用任何仓库内代码。测试者事先只拿到 URL。
> 本报告是 03/04/09 之后的**第三个独立环境**的复现,价值在 harness 本身即"消费方样本":
> 一个不在本项目控制下的 agent 框架,拿到 URL 后能否把工具面用起来。
>
> **Triage(同会话,报告收录后执行):** 报告原文未动。处理结果——
> · §1 `executeTool` 错误形态 → 已写入 README 新增的 "`executeTool` calling contract" 小节(TypeError 与 DOMException 两种失败形态并排)。(采纳)
> · §3 节流环境自省 → 两处均已做:`vitrine_state` 增加 `visibility`(= `document.visibilityState`);`dev_perf` 的 frameSample 旁增加 `visibility` 与 `rAFThrottled`。驱测覆盖。(采纳)
> · §4 `getTools()` 23 条孤立异常 → 未复现,仅记录;polyfill 注册表快照语义留观。(不下结论,与报告一致)
> · §7 常规 DOM 测试矩阵 → 已落地:`harness/form-fixture.html` + drive 表单 pass(填写/事件序、select、按键、点击提交+assert、disabled 诊断、changes)。落地过程抓到一个本报告(与 03/04/09)都没发现的真 bug:`dev_click` 从未派发过 click 事件——指针序列齐全但 activation 缺失,提交按钮点了不会提交。已在 `synthClick` 修复(指针序列后接 `el.click()`,带 activation behavior,仍尊重 preventDefault)。(采纳,且超出报告的收获)
> · §2 宿主侧文件选择器上传:与 `dev_upload` 的 `url` 入参互补,无代码行动项。(仅记录)

---

## 0. 结论

**通。** 24/24 工具可枚举可执行,上传→安装→双着色器切换全链路通过,
且全程只靠 `document.modelContext` 与页面交互——证明 03/09 的结论
("应用自注册工具是唯一能看见 module scope 的窗口")对陌生 harness 同样成立。

| 项目 | 结果 |
|---|---|
| `getTools()` 枚举 | **24 条**(22 `dev_*` + 2 `vitrine_*`),连续 4 次稳定;一次孤立异常见 §4 |
| badge | `dev-webmcp · 22 + 2 tools · polyfill`——03 问题 1 的修复**在线上生效** |
| `vitrine_state` | 一次调用返回 exhibit/tris/reveal/shader/camera/renderer/disabled 全量状态 ✓ |
| `vitrine_set_shader` | `holo:false` → original,HUD 同步 `SHADER · ORIG`;`holo:true` 还原 ✓ |
| 模型安装全链路 | 宿主侧真实文件选择器上传 `DamagedHelmet.glb`(3.77 MB)→ toast `EXHIBIT INSTALLED`,15,452 tris,SHADER/RESET 解禁 ✓ |
| 像素验证 | 截图 ×3:占位立方体、全息头盔、原始材质头盔,均与状态工具读数一致 ✓ |
| `dev_snapshot` | 画布页 outline 近空(符合自述);`include_hidden` 捞出隐藏 `#file` ✓ |
| `dev_console` | 抓到 `[dev-webmcp] ready` 与 three.js PMREM `sigmaRadians` 警告 ✓ |

## 1. `executeTool` 契约(03 §2.2 的补充实测)

03 已记录正确姿势;本次补测了**错误姿势的报错形态**:

| 调用 | 结果 |
|---|---|
| `executeTool('vitrine_state', {})` | `TypeError: RegisteredTool must be an object`(03 已录) |
| `executeTool({name, arguments}, {})` | `RegisteredTool.description is required`(第一参数按 RegisteredTool 校验,不是查询对象) |
| `executeTool(tool, {})` | **`DOMException: UnknownError: Failed to parse input arguments`** |
| `executeTool(tool)` | 同上 |
| `executeTool(tool, '{}')` | ✓ 返回 run() 的**原始字符串**(本次为 451 字符 JSON),不是 `CallToolResult` 包装 |

对消费方的含义:参数必须是 **JSON 字符串**;传对象时的报错是 DOMException 而非 TypeError,
字符串匹配做错误分类的 harness 会漏判。**建议包 README 的调用示例里把这两种错误形态写明**
(03 只写了正确姿势和一个 TypeError 样例)。

## 2. 上传的第三条路径:宿主侧文件选择器

09 用 `dev_upload` 的 `url`/`base64` 两条入参;01-C 修出了 CDP 侧宿主路径。
本次走的是 harness 自带的 `uploadFile('#file', 本机路径)`(真实 Chromium 文件选择器,CDP `DOM.setFileInputFiles` 级别):

- `install()` 在 `change` 事件后同步完成,**不依赖 rAF**——见 §3,节流标签页里照样成功;
- 状态工具立即读数:`exhibit:"DamagedHelmet.glb", triangles:15452, disabled:{shader:false,reset:false}`;
- toast 确认;两张截图分别证实全息着色器(橙色体渲染)与 ORIGINAL(PBR 材质)。

对 dev-webmcp 本身无行动项;记录在此是因为它印证了 01 的设计取舍:
`dev_upload` 解决"页面里没有文件系统",而宿主侧上传解决"agent 手里有本机文件"——
两条路径互补,`dev_upload` 的 `url` 入参已覆盖后者的大多数场景。

## 3. 新发现:隐藏标签页 rAF 节流会让"状态真实但像坏了"

**现象**:omp 的隐藏共享标签页里 rAF 被强节流。上传成功后数十秒,
`vitrine_state` 仍报 `reveal:0, revealing:true`,HUD 停在 `MATERIALIZING [···]`;
相机停在 intro dolly 中途。截图会强制出一帧,所以截图序列里画面是正常的。

**风险**:状态工具如实报告了被节流的动画,但一个不知情的 agent 会把
`reveal 卡在 0` 误判成"页面 bug"或"安装失败"——本次测试者第一反应也是如此,
靠截图对照才排除。09 的 `dev_perf` 环境 章节(SwiftShader 慢)是同类问题的像素版。

**建议**(低成本,两处任选):
1. `vitrine_state` 这类应用状态工具的输出加 `document.visibilityState`——一行代码,消费方立判环境;
2. `dev_perf` 的输出已有 `frameSample`,再加 `rAFThrottled: document.hidden` 级别的提示即可。
   (方法学:03 §1 已有先例——"测到的只是半个工具面"是环境不是工具;本条是它的动画版。)

## 4. 枚举异常:一次 `getTools()` 少了 `dev_fill`(未复现)

首次枚举(重开标签页后约 5 秒的第一次成功调用)返回 **23 条,缺 `dev_fill`**,
但两条 `vitrine_*` 在——不是"注册到一半"的加载序问题(注册顺序上 `dev_fill` 更早)。
随后同一标签页 3 次 + 重开标签页 1 次,均稳定 24 条。置信度低,记为孤立异常;
若再现,值得查 polyfill 注册表的快照语义。**不下结论。**

## 5. 环境 bug(harness 侧,非本项目)

omp 浏览器设备:**新开标签页后的第一次 `tab.evaluate`/`tab.run` 必失败**
(`Failed to clear browser request interception after browser.run`,eval 单元被杀),
标签页存活,第二次调用起正常。复现 3 次(两个会话)。
已向 omp 侧报告(`xd://report_issue`)。记入此报告仅因方法学:
环境失败的报错形态与工具失败完全不同层,排查时应先换调用再换标签页,
本次为此多花了约 5 个来回——与 07 "陈旧标签页陷阱"同属"先怀疑环境"清单。

## 6. 与既有报告的关系

| 项 | 03/04/09 | 本报告 |
|---|---|---|
| 环境 | 仓库 harness / CDP 脚本 | 陌生通用 harness(omp) |
| 工具面 | 15 → 20 → 24 | 24 ✓(第三环境确认) |
| badge 修复 | 05/07 复验 | 线上文案 `22 + 2` 直接可见 ✓ |
| executeTool 契约 | 03 记正确姿势 | 补错误姿势报错形态(§1) |
| 上传 | dev_upload url/base64 + CDP 宿主路径 | 第三路径:真实文件选择器(§2) |
| 环境噪声 | headless 无 GL(03 §1)、SwiftShader 慢(09 §4) | 隐藏标签页 rAF 节流(§3,新) |

## 7. 对"换常规 DOM UI 测试"的预判

本次被测页无 DOM,`dev_fill`/`dev_select`/`dev_press`/焦点管理**没有任何正向路径被验过**
(03 §2.3 只验了语义化报错,04 也自认无 select 路径)。换常规 UI 时建议矩阵至少加:
表单填写+提交、`<select>` 选择、Tab 焦点序、disabled 按钮点击诊断、
动作后一帧快照时序(05 已修,常规 DOM 下才真正可观测)。
预期全部直接可测,无 canvas 特有障碍。
