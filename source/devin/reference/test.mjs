/**
 * source/devin/reference 自测 —— types 常量/工具面枚举 + oauth(PKCE) 注入形状 + cloud-sessions 会话协议
 * + cascade-gateway Connect 帧编解码回环 + acp-server 能力位协商/握手 + sandbox fail-closed 裁决。
 * 运行：node source/devin/reference/test.mjs（零依赖；网络调用全部打桩，仅 loopback 回环）
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

import {
  ACP_AUTH_METHOD_ID,
  CONNECT_COMPRESSED_FLAG,
  CONNECT_END_STREAM_FLAG,
  DEVIN_API_BASE,
  DEVIN_WEBAPP_BASE,
  MAX_CONNECT_FRAME_PAYLOAD,
  SESSION_CDP_ENDPOINT,
} from "./src/types.ts";
import { CREDENTIALS_FILE_CANDIDATES, loginDevin, tokenExpiry } from "./src/oauth.ts";
import { DevinSessionClient } from "./src/cloud-sessions.ts";
import {
  GATEWAY_BASE_URL,
  PATH_GET_CHAT_MESSAGE,
  PATH_GET_CLI_MODEL_CONFIGS,
  PATH_GET_USER_JWT,
  decodeFrames,
  decompressMaybe,
  encodeFrame,
} from "./src/cascade-gateway.ts";
import { DevinAcpServer, parseClientCapabilities } from "./src/acp-server.ts";
import {
  SANDBOX_UNSUPPORTED_PLATFORMS,
  buildBwrapArgv,
  buildSeatbeltProfile,
  resolveExcludedVerdict,
} from "./src/sandbox.ts";

let passed = 0;
const ok = (msg) => { passed += 1; console.log("  ok", `${passed}.`, msg); };

// ------------------------------------------------- 1. types：端点/常量形状
assert.equal(DEVIN_API_BASE, "https://api.devin.ai");
assert.equal(DEVIN_WEBAPP_BASE, "https://app.devin.ai");
assert.equal(SESSION_CDP_ENDPOINT, "http://localhost:29229"); // 会话 VM 内固定 CDP 端口
assert.equal(ACP_AUTH_METHOD_ID, "windsurf-api-key");          // ACP authenticate 方法 id（实测）
ok("types：api/webapp/CDP 端点与 windsurf-api-key 常量形状");

// ------------------------------------------------- 2. schemas：工具面枚举交叉核对
const schema = JSON.parse(readFileSync(new URL("../schemas/tools.json", import.meta.url), "utf8"));
assert.equal(schema.coreVerdict.execution, "cloud-only");
assert.deepEqual(schema.surfaces.cli_local_tools.builtinToolMatchers, ["read", "edit", "grep", "glob", "exec"]);
assert.deepEqual(
  schema.surfaces.cloud_session_tools.computer.actions,
  ["click", "type", "scroll", "keyboard shortcuts", "drag"],
);
assert.equal(schema.surfaces.acp_extension.clientCapabilitiesObserved.browser_preview, true);
assert.ok(schema.surfaces.acp_extension.cognitionExtMethodsObserved.includes("cognition.ai/skills/list"));
ok("schemas：CU/BU 全云判定、CLI 五工具匹配器、computer 动作面、browser_preview 能力位");

// ------------------------------------------------- 3. oauth：tokenExpiry（JWT exp - 5min；坏 token → null）
const fakeJwt = `hdr.${Buffer.from(JSON.stringify({ exp: 1893456000 })).toString("base64url")}.sig`;
assert.equal(tokenExpiry(fakeJwt), 1893456000 * 1000 - 5 * 60 * 1000);
assert.equal(tokenExpiry("not-a-jwt"), null);
ok("oauth：tokenExpiry 按 exp 提前 5 分钟判过期，非 JWT 回退 null");

// ------------------------------------------------- 4. oauth：loginDevin 全流程（fetch 打桩 + 59653 回环回调）
{
  const realFetch = globalThis.fetch;
  const fakeToken = `h.${Buffer.from(JSON.stringify({ exp: 1900000000 })).toString("base64url")}.s`;
  let tokenReq = null;
  try {
    globalThis.fetch = async (url, init) => {
      tokenReq = { url: String(url), init };
      return { ok: true, json: async () => ({ token: fakeToken }) };
    };
    let authUrl = "";
    const pending = loginDevin((u) => { authUrl = u; });
    await new Promise((r) => setTimeout(r, 30)); // 等 59653 监听
    const u = new URL(authUrl);
    assert.equal(u.origin + u.pathname, `${DEVIN_WEBAPP_BASE}/auth/cli/continue`);
    assert.equal(u.searchParams.get("prompt"), "select_account");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    const redirect = new URL(u.searchParams.get("redirect_uri"));
    assert.equal(redirect.host, `127.0.0.1:59653`);
    assert.equal(redirect.pathname, "/callback");
    const challenge = u.searchParams.get("code_challenge");
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/u);
    await realFetch(`http://127.0.0.1:59653/callback?code=test-code&state=${u.searchParams.get("state")}`);
    const result = await pending;
    assert.equal(result.token, fakeToken);
    assert.equal(result.apiEndpoint, DEVIN_API_BASE);
    assert.equal(result.enterpriseUrl, DEVIN_WEBAPP_BASE);
    assert.equal(new URL(tokenReq.url).pathname, "/auth/cli/token"); // api.devin.ai 域由 DEVIN_API_BASE 前缀保证
    const body = JSON.parse(tokenReq.init.body);
    assert.equal(body.code, "test-code");
    // PKCE 回环：URL 里的 challenge === base64url(sha256(交换用的 verifier))
    assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge);
    assert.equal(CREDENTIALS_FILE_CANDIDATES[0].endsWith("/devin/credentials.toml"), true);
  } finally {
    globalThis.fetch = realFetch;
  }
}
ok("oauth：auth/cli/continue(PKCE S256) → 127.0.0.1:59653/callback → auth/cli/token 交换，challenge/verifier 回环一致");

// ------------------------------------------------- 5. cloud-sessions：v1 创建会话协议形状
{
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, json: async () => ({ sessionId: "s-1", url: "https://app.devin.ai/sessions/s-1" }) };
  };
  const client = new DevinSessionClient({ token: "pat-test", fetchImpl: stub });
  const handle = await client.createSessionV1({ prompt: "do things", idempotencyKey: "k1" });
  assert.equal(handle.sessionId, "s-1");
  assert.equal(calls[0].url, `${DEVIN_API_BASE}/v1/sessions`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer pat-test");
  assert.deepEqual(JSON.parse(calls[0].init.body), { prompt: "do things", idempotencyKey: "k1" });
  ok("cloud-sessions：v1 会话创建 POST /v1/sessions + Bearer PAT + JSON 体");
}

// ------------------------------------------------- 6. cloud-sessions：v3 消息/查询形状 + ssh 形状
{
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, json: async () => ({ status: "running" }) };
  };
  const client = new DevinSessionClient({ token: "pat-test", fetchImpl: stub });
  await client.sendMessageV3("s-1", "继续");
  await client.getSessionV3("s-1");
  assert.equal(calls[0].url, `${DEVIN_API_BASE}/v3/organizations/sessions/s-1/messages`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { message: "继续" });
  assert.equal(calls[1].url, `${DEVIN_API_BASE}/v3/organizations/sessions/s-1`);
  assert.equal(calls[1].init.method, "GET");
  assert.equal(DevinSessionClient.sshCommandShape("devin-abc", "gw:22"), "devin ssh devin-abc --gateway gw:22");
  ok("cloud-sessions：v3 消息/查询端点族形状 + ssh --gateway 命令形状");
}

// ------------------------------------------------- 7. cascade-gateway：5 字节 envelope 编→解码回环
{
  const text = '{"deltaText":"你好","messageId":"m-1"}';
  const gz = gzipSync(Buffer.from(text, "utf8"));
  assert.equal(gz.readUInt32BE(0) !== 0, true); // 确实压缩过
  const dataFrame = encodeFrame({ flag: CONNECT_COMPRESSED_FLAG, payload: gz });
  const trailer = Buffer.from(JSON.stringify({ error: null }));
  const endFrame = encodeFrame({ flag: CONNECT_END_STREAM_FLAG, payload: trailer });
  const wire = Buffer.concat([dataFrame, endFrame]);
  // 帧头形状：flag(1B) + len(4B BE)
  assert.equal(dataFrame[0], 0x01);
  assert.equal(dataFrame.readUInt32BE(1), gz.length);
  const frames = [...decodeFrames(wire)];
  assert.equal(frames.length, 2);
  const roundtrip = decompressMaybe(frames[0].payload, frames[0].flag).toString("utf8");
  assert.equal(roundtrip, text); // 编→解码回环还原
  assert.equal(decompressMaybe(frames[1].payload, frames[1].flag).toString("utf8"), trailer.toString("utf8"));
  // 不压缩帧（flag 无 0x01 位）应原样通过
  const plain = encodeFrame({ flag: 0, payload: Buffer.from("plain") });
  const [f] = [...decodeFrames(plain)];
  assert.equal(decompressMaybe(f.payload, f.flag).toString(), "plain");
  ok("cascade-gateway：Connect 帧 编→gzip→解→gunzip 回环 + end-of-stream trailer + 明文帧直通");
}

// ------------------------------------------------- 8. cascade-gateway：截断/超限防御 + 端点常量
{
  const gz = gzipSync(Buffer.from("x"));
  const wire = encodeFrame({ flag: CONNECT_COMPRESSED_FLAG, payload: gz });
  assert.equal([...decodeFrames(wire.subarray(0, 3))].length, 0, "帧头不足 5 字节不产出");
  assert.equal([...decodeFrames(wire.subarray(0, 5))].length, 0, "载荷不完整不产出");
  const evil = Buffer.alloc(5);
  evil[0] = 0;
  evil.writeUInt32BE(MAX_CONNECT_FRAME_PAYLOAD + 1, 1);
  assert.throws(() => [...decodeFrames(evil)], /too large/u, "长度前缀超 16MiB 上限立即失败");
  assert.equal(GATEWAY_BASE_URL, "https://server.codeium.com");
  assert.equal(PATH_GET_USER_JWT, "/exa.auth_pb.AuthService/GetUserJwt");
  assert.equal(PATH_GET_CHAT_MESSAGE, "/exa.api_server_pb.ApiServerService/GetChatMessage");
  assert.equal(PATH_GET_CLI_MODEL_CONFIGS, "/exa.api_server_pb.ApiServerService/GetCliModelConfigs");
  ok("cascade-gateway：截断缓冲零产出、恶意长度前缀 fail-fast、exa.* 三端点路径常量");
}

// ------------------------------------------------- 9. acp-server：26 个能力位的协商形状（browser_preview 等）
const CAP_KEYS = [
  "terminal", "terminal_auth", "fs.read", "fs.write", "subagents", "elicitation",
  "partial_content", "multi_root", "grouped_options", "windsurf_config", "message_grouping",
  "raw_ref_tags", "revert", "wiki", "request_diagnostics", "editor_context", "terminal_context",
  "mcp", "plugins", "fast_context", "subagent_control", "workspace_dir_commands", "chains",
  "browser_preview", "browser_preview_open", "clipboard_write",
];
{
  const allTrue = parseClientCapabilities({ clientCapabilities: Object.fromEntries(CAP_KEYS.map((k) => [k, true])) });
  assert.deepEqual(CAP_KEYS.every((k) => allTrue[k] === true), true, "全真宿主广告 → 26 位全 true");
  const none = parseClientCapabilities({});
  assert.deepEqual(CAP_KEYS.every((k) => none[k] === false), true, "空能力 → 全 false（缺省关闭）");
  const only = parseClientCapabilities({ clientCapabilities: { browser_preview: true } });
  assert.equal(only.browser_preview, true);
  assert.equal(only.browser_preview_open, false);
  assert.equal(only.terminal, false);
  ok("acp-server：能力位逐位协商（全开/全关/仅 browser_preview 三种宿主广告形状）");
}

// ------------------------------------------------- 10. acp-server：initialize/authenticate 握手与扩展方法
{
  const server = new DevinAcpServer();
  const init = await server.dispatch({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "1", clientCapabilities: { browser_preview: true, browser_preview_open: true } },
  });
  assert.equal(init.result.protocolVersion, "1");
  assert.equal(init.result.authMethods[0].id, ACP_AUTH_METHOD_ID);
  const bad = await server.dispatch({
    jsonrpc: "2.0", id: 2, method: "authenticate", params: { methodId: "some-other" },
  });
  assert.equal(bad.error.code, -32602);
  const auth = await server.dispatch({
    jsonrpc: "2.0", id: 3, method: "authenticate",
    params: { methodId: "windsurf-api-key", meta: { api_key: "sk-test", api_server_url: "https://server.codeium.com" } },
  });
  assert.deepEqual(auth.result, {});
  assert.deepEqual(server.meta, { api_key: "sk-test", api_server_url: "https://server.codeium.com" }); // 宿主注入、仅驻内存
  const ext = await server.dispatch({ jsonrpc: "2.0", id: 4, method: "cognition.ai/skills/list", params: {} });
  assert.deepEqual(ext.result, {});
  const unknown = await server.dispatch({ jsonrpc: "2.0", id: 5, method: "no/such/method", params: {} });
  assert.equal(unknown.error.code, -32601);
  ok("acp-server：initialize 广告 windsurf-api-key、authenticate 宿主凭据注入、cognition.ai/* 扩展路由、未知方法 -32601");
}

// ------------------------------------------------- 11. sandbox：excluded 裁决 fail-closed
{
  assert.equal(resolveExcludedVerdict("git status", {}), "inside", "无规则 → 留在沙箱内");
  assert.equal(
    resolveExcludedVerdict("git push", { excluded: { allow: ["Exec(git status)"], deny: ["Exec(git *)"] } }),
    "inside",
    "deny 恒胜 allow（跨更严者胜口径）",
  );
  assert.equal(resolveExcludedVerdict("git status", { excluded: { allow: ["Exec(git status)"] } }), "outside-auto");
  assert.equal(resolveExcludedVerdict("ls -la", { excluded: { ask: ["Exec(ls *)"] } }), "outside-ask");
  assert.equal(resolveExcludedVerdict("rm -rf /", { excluded: { allow: ["not-a-rule"] } }), "inside", "不可解析规则 → 留在沙箱内");
  ok("sandbox：excluded 裁决 deny>ask>allow、无匹配/坏规则一律留在沙箱内（fail-closed）");
}

// ------------------------------------------------- 12. sandbox：平台 fail-closed 与 bwrap/Seatbelt 形状
{
  assert.ok(SANDBOX_UNSUPPORTED_PLATFORMS.includes("win32"), "Windows 无 OS 级沙箱 → 硬失败平台清单");
  const argv = buildBwrapArgv({ network_mode: "limited" }, "/work/ws", ["/work/out"], 7801);
  assert.equal(argv[0], "bwrap");
  assert.deepEqual(argv.slice(1, 4), ["--die-with-parent", "--new-session", "--unshare-all"]);
  assert.ok(argv.includes("/work/ws") && argv.includes("/work/out"), "工作区 + Write 授权路径可写绑定");
  assert.ok(argv.includes("HTTPS_PROXY") && argv.includes("http://127.0.0.1:7801"), "子进程流量强制过 loopback 代理");
  const sb = buildSeatbeltProfile({ denied_domains: ["evil.example"] }, "/work/ws", [], 7801);
  assert.ok(sb.includes("(deny default)"), "Seatbelt deny-by-default");
  assert.ok(sb.includes("http://127.0.0.1:7801"), "Seatbelt 代理出口");
  assert.ok(sb.includes("evil.example"), "denied_domains 记录进 profile 注释");
  ok("sandbox：win32 硬失败清单、bwrap argv 骨架、Seatbelt deny-by-default + loopback 代理形状");
}

console.log(`\nALL PASSED (${passed} checks) — source/devin/reference`);
