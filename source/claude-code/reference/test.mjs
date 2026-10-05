/**
 * source/claude-code/reference 自测 —— MCP server 骨架 + tier 权限门 + 浏览器工具。
 * 运行：node source/claude-code/reference/test.mjs
 */
import assert from "node:assert/strict";
import { createDesktopSim } from "./desktop-sim.ts";
import { createMcpServer } from "./mcp-server.ts";

let passed = 0;
const ok = (msg) => { passed += 1; console.log("  ok", `${passed}.`, msg); };

// 交互式授权回调：模拟用户在 permission_request 弹窗上的选择（false=拒绝）
let userSays = false;
const sim = createDesktopSim({ onPermissionRequest: () => userSays });

// ------------------------------------------------- 1. JSON-RPC 形状 + 工具清单
const server = createMcpServer({ sessionId: "sess_A", sim });
const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
assert.equal(init.result.protocolVersion, "2024-11-05");
assert.equal(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null, "notification 不回包");
const list = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const names = list.result.tools.map((t) => t.name);
const cuCount = names.filter((n) => !["tabs_context_mcp", "tabs_create_mcp", "tabs_select_mcp", "tabs_close_mcp", "navigate", "resize_window", "read_page", "find", "get_page_text", "read_console_messages", "read_network_requests", "computer", "form_input", "javascript_tool", "file_upload", "upload_image", "gif_creator", "browser_batch", "list_connected_browsers", "select_browser", "switch_browser", "shortcuts_list", "shortcuts_execute"].includes(n)).length;
assert.equal(cuCount, 42, `桌面 CU 工具应为 42 个（实际 ${cuCount}）`);
assert.equal(names.length - cuCount, 23, `浏览器 BU 工具应为 23 个`);
ok("initialize/tools/list：42 个 CU 工具 + 23 个 BU 工具");

// ------------------------------------------------- 2. request_access：整批 + tier 分级
const ra = await server.callTool("request_access", { apps: ["Safari", "Terminal", "Notes"], reason: "整理备忘录", clipboardRead: true, clipboardWrite: true });
const byApp = Object.fromEntries(ra.granted.map((g) => [g.app, g]));
assert.equal(byApp.Safari.tier, "read", "浏览器 → read");
assert.equal(byApp.Terminal.tier, "click", "终端 → click");
assert.equal(byApp.Notes.tier, "full", "普通应用 → full");
assert.equal(byApp.Notes.clipboardRead, true);
ok("request_access：整批授权 + tier 分级（read/click/full）+ 独立 grant");

// ------------------------------------------------- 3. tier 门控：前台应用检查
sim.setFrontmost("Safari");
await assert.rejects(() => server.callTool("left_click", { coordinate: [10, 10] }), /tier read: clicks are blocked.*claude-in-chrome/u);
sim.setFrontmost("Terminal");
await assert.rejects(() => server.callTool("type", { text: "rm -rf /" }), /typing is blocked.*Bash tool/u);
await assert.rejects(() => server.callTool("key", { text: "ctrl+c" }), /key presses are blocked/u);
ok("tier 门控：read 拒点击、click 拒打字/按键（防 AI 往 shell 里打命令）");

// ------------------------------------------------- 4. display-scope 动作 + 独占锁
sim.setFrontmost("Notes");
assert.ok((await server.callTool("left_click", { coordinate: [100, 100] })).ok);
sim.setFrontmost("Terminal");
await assert.rejects(() => server.callTool("type", { text: "ls" }), /typing is blocked/u); // click-tier
sim.setFrontmost("Notes");
// 独占锁：第二个会话动作报错
const serverB = createMcpServer({ sessionId: "sess_B", sim });
await assert.rejects(() => serverB.callTool("left_click", { coordinate: [1, 1] }), /Another Claude session is currently using the computer/u);
ok("display-scope 动作通过 + 独占锁（另一会话被拒）");

// ------------------------------------------------- 5. computer_batch：每步前台门控、首错停批
sim.setFrontmost("Notes");
const batch = await server.callTool("computer_batch", {
  actions: [{ tool: "left_click", coordinate: [1, 1] }, { tool: "left_click", coordinate: [2, 2] }],
});
assert.equal(batch.stepsCompleted, 2);
sim.setFrontmost("Safari"); // 中途弹出 read-tier 应用
const batch2 = await server.callTool("computer_batch", {
  actions: [{ tool: "left_click", coordinate: [1, 1] }, { tool: "left_click", coordinate: [2, 2] }],
});
assert.equal(batch2.stepsCompleted, 0, "第一步即门控失败停批");
assert.match(batch2.error, /tier read/u);
sim.setFrontmost("Notes");
ok("computer_batch：每步前台门控 + 首错停批");

// ------------------------------------------------- 6. 独立 grant：系统组合键 / 剪贴板
// 剪贴板 grant：Terminal（重新授权为不带独立勾选）
await server.callTool("request_access", { apps: ["Terminal"] });
sim.setFrontmost("Terminal");
await assert.rejects(() => server.callTool("read_clipboard"), /clipboardRead/u);
await server.callTool("request_access", { apps: ["Terminal"], clipboardRead: true, clipboardWrite: true });
sim.setClipboard("user-secret");
assert.equal((await server.callTool("read_clipboard")).text, "user-secret");
// 系统组合键 grant：Notes（full tier；click-tier 的 key 会被 tier 门先拦）
sim.setFrontmost("Notes");
await server.callTool("request_access", { apps: ["Notes"] });
await assert.rejects(() => server.callTool("key", { text: "cmd+q" }), /systemKeyCombos/u);
await server.callTool("request_access", { apps: ["Notes"], systemKeyCombos: true });
await server.callTool("key", { text: "cmd+q" });
ok("独立授权项：systemKeyCombos / clipboardRead（按前台应用 grant 判定）");

// ------------------------------------------------- 7. app-scoped：后台动作 + secure_input 守卫 + app_menu
const shot = await server.callTool("app_screenshot", { app: "Notes" });
assert.ok(shot.axElements.some((l) => l.includes("新建")));
await assert.rejects(() => server.callTool("app_click", { app: "Notes", button: "right" }), /context_menu_rclick_refused/u);
sim.setSecureInput(true);
await assert.rejects(() => server.callTool("app_type", { app: "Notes", text: "pwd" }), /secure_input_active/u);
sim.setSecureInput(false);
await assert.rejects(() => server.callTool("app_type", { app: "Notes", text: "x", mode: "replace" }), /would_replace_content/u);
const menuList = await server.callTool("app_menu", { app: "Notes", list: "File" });
assert.ok(menuList.items.includes("Export as PDF…"));
const menuHit = await server.callTool("app_menu", { app: "Notes", path: ["File", "Export as PDF..."] }); // 省略号/大小写归一
assert.equal(menuHit.clicked, "Export as PDF…");
ok("app-scoped：右键拒 / secure_input / would_replace_content / app_menu 遍历");

// ------------------------------------------------- 8. teach 模式
const teach = await server.callTool("teach_step", { explanation: "点击这里新建笔记", next_preview: "高亮「新建」按钮", actions: [] });
assert.equal(teach.exited, false);
ok("teach 模式：tooltip 步骤形状");

// ------------------------------------------------- 9. 浏览器：tab 组沙箱 + 权限
// 白名单先于导航设置（ask 模式 + 无白名单 + 无人应答 = fail-closed 拒绝）
sim.chrome.setMode("ask");
sim.chrome.setAllowedDomains(["example.com"]);
const ctx = await server.callTool("tabs_context_mcp", { createIfEmpty: true });
assert.equal(ctx.tabs.length, 1);
const tabId = ctx.tabs[0].id;
await server.callTool("navigate", { tabId, url: "https://example.com" });
// 组沙箱：别会话的 tab 不可见
const serverB2 = createMcpServer({ sessionId: "sess_B2", sim });
await assert.rejects(() => serverB2.callTool("read_page", { tabId }), /not in this session's MCP tab group/u);
ok("tab 组沙箱：组外 tab 不可见");

// ------------------------------------------------- 10. 逐动作授权：白名单 / 用户允许 / 用户拒绝
await assert.rejects(() => server.callTool("navigate", { tabId, url: "https://evil.test" }), /refused by the permission prompt/u, "域外 + 用户拒绝");
userSays = true; // 用户在弹窗上点了「允许」
const allowedTab = await server.callTool("navigate", { tabId, url: "https://user-allowed.test" });
assert.equal(allowedTab.url, "https://user-allowed.test");
userSays = false;
await assert.rejects(() => server.callTool("navigate", { tabId, url: "https://another.test" }), /refused/u);
ok("权限模型：allowedDomains 白名单 + ask 模式逐动作授权（用户允许/拒绝）");

// ------------------------------------------------- 11. read_page / find / computer(ref) / form_input / javascript
sim.chrome.setAllowedDomains(["example.com", "shop.test"]); // 本节用例的白名单
await server.callTool("navigate", { tabId, url: "https://example.com" });
const page = await server.callTool("read_page", { tabId });
assert.ok(page.tree.includes("ref_2: link \"More information...\""));
const found = await server.callTool("find", { tabId, query: "more information" });
assert.equal(found.ref, "ref_2");
assert.ok((await server.callTool("computer", { action: "left_click", ref: "ref_2", tabId })).ok);
await assert.rejects(() => server.callTool("computer", { action: "left_click", ref: "ref_99", tabId }), /stale/u);
await assert.rejects(() => server.callTool("computer", { action: "screenshot" }), /tabId/u, "浏览器版 computer 的 tabId 必填");
const shop = await server.callTool("navigate", { tabId, url: "https://shop.test" });
await server.callTool("form_input", { ref: "ref_4", value: true, tabId });
const page2 = await server.callTool("read_page", { tabId });
assert.ok(page2.tree.includes('"Subscribe" value=true'));
const js = await server.callTool("javascript_tool", { action: "javascript_exec", text: "document.title", tabId });
assert.equal(js.value, "https://shop.test");
ok("read_page/find/computer(ref)/form_input/javascript_tool + tabId 必填 + ref 失效");

// ------------------------------------------------- 12. browser_batch：每项独立权限检查、首错停批、不嵌套
const bb = await server.callTool("browser_batch", {
  actions: [
    { name: "navigate", input: { tabId, url: "https://example.com" } },           // 白名单内 → 放行
    { name: "navigate", input: { tabId, url: "https://denied.test" } },           // 域外 → 拒
    { name: "navigate", input: { tabId, url: "https://never-reached.test" } },    // 不应执行
  ],
});
assert.equal(bb.stepsCompleted, 1, "第一项通过后第二项权限拒绝停批");
assert.match(bb.error, /refused/u);
await assert.rejects(() => server.callTool("browser_batch", { actions: [{ name: "browser_batch", input: { actions: [] } }] }), /cannot nest/u);
ok("browser_batch：每项独立权限检查 + 首错停批 + 禁止嵌套");

console.log(`\nALL PASSED (${passed} checks) — source/claude-code/reference`);
