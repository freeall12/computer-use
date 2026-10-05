/**
 * sandbox.ts —— `devin --sandbox` 的配置→OS 隔离形状映射（cleanroom 重构）
 *
 * 事实来源：docs.devin.ai/cli/sandbox.md + cli/reference/permissions.md（2026-10-06）
 * [INV-F3/F4]。本骨架把文档口径的沙箱配置编译为两个平台的执行形状：
 *   Linux  → bubblewrap(bwrap) + socat（文档明示依赖）
 *   macOS  → Seatbelt (sandbox-exec) profile（`devin sandbox setup` 文档口径）
 *   Windows → 不支持（文档：硬失败 fail-closed，含 ACP server 形态）
 *
 * 网络过滤语义：本地 loopback 托管代理，子进程流量强制过代理；
 * allowed_domains 非空即白名单；denied_domains 恒拒（deny 胜 allow）；
 * network_mode "limited" 只放行 GET/HEAD/OPTIONS。
 */

export interface DevinSandboxConfig {
  allowed_domains?: string[];   // 默认 []（非空即白名单模式）
  denied_domains?: string[];    // 默认 []（恒拒）
  network_mode?: "full" | "limited";
  excluded?: {
    allow?: string[];  // Exec(...) 规则：命中即在沙箱外自动运行
    ask?: string[];    // 命中则提示后在沙箱外运行
    deny?: string[];   // 命中则强制留在沙箱内
  };
}

/** 域名通配三形态（文档原文）：example.com 精确 / *.example.com 子域 / **.example.com 含 apex。 */
export type DomainPattern = string;

export const SANDBOX_UNSUPPORTED_PLATFORMS = ["win32"] as const; // fail-closed

/** bwrap 参数形状（Linux）。仅示意 writable/readable/网络代理三组约束的映射。 */
export function buildBwrapArgv(
  cfg: DevinSandboxConfig,
  workspaceDir: string,
  writableScopes: string[],   // 由已授权 Write(...) 规则 + 工作区推导（文档口径）
  proxyPort: number,          // 本地 loopback 托管代理端口
): string[] {
  const argv = ["bwrap", "--die-with-parent", "--new-session", "--unshare-all"];
  // 可写：工作区 + Write(...) 授权路径（其余默认只读）
  argv.push("--bind", workspaceDir, workspaceDir);
  for (const w of writableScopes) argv.push("--bind", w, w);
  // 只读可见：除 Read(...) deny 隐藏路径外的系统根（骨架示意）
  argv.push("--ro-bind", "/", "/");
  // 网络：本机仅保留到 loopback 代理的出口（full/limited 的方法级差异由代理执行）
  argv.push("--dev", "/dev");
  argv.push("--proc", "/proc");
  argv.push("--tmpfs", "/tmp");
  argv.push(`--setenv`, "HTTPS_PROXY", `http://127.0.0.1:${proxyPort}`);
  argv.push(`--setenv`, "HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
  void cfg; void SANDBOX_UNSUPPORTED_PLATFORMS; // Windows 分支在调用方 fail-closed
  return argv;
}

/** Seatbelt profile 形状（macOS）。deny-by-default + 按授权放行 + 网络仅代理。 */
export function buildSeatbeltProfile(
  cfg: DevinSandboxConfig,
  workspaceDir: string,
  writableScopes: string[],
  proxyPort: number,
): string {
  const writeLines = [workspaceDir, ...writableScopes]
    .map((p) => `(allow file-write* (subpath "${p}"))`).join("\n");
  return `(version 1)
(deny default)
; 可写面 = 工作区 + Write(...) 授权（mid-session 授权动态扩张）
${writeLines}
; 读：除 Read(...) deny（隐藏路径完全不暴露）外默认允许
(allow file-read*)
; 网络强制走本地 loopback 代理（allowed/denied_domains 与 network_mode 由代理执行）
(allow network* (remote tcp-socket (to local-ip "127.0.0.1")))
(allow network* (remote unix-socket))
; 代理出口示例
; process-subprocess 环境变量 HTTPS_PROXY=http://127.0.0.1:${proxyPort}
; excluded.allow/ask/deny 的 Exec(...) 豁免由 CLI 前置判断（不进入本 profile）
; denied_domains=${JSON.stringify(cfg.denied_domains ?? [])}
`;
}

/**
 * 豁免规则（sandbox.excluded）解析口径 [INV-F4]：
 *  - 只支持 Exec(...) 规则；同一配置源内最具体规则胜；跨源 deny > ask > allow；
 *  - 不可解析的命令 → 留在沙箱内（fail-closed）；
 *  - PTY shell 命令恒在沙箱内。
 */
export function resolveExcludedVerdict(
  command: string,
  cfg: DevinSandboxConfig,
): "inside" | "outside-auto" | "outside-ask" {
  const rules = cfg.excluded ?? {};
  const match = (patterns?: string[]): boolean =>
    (patterns ?? []).some((pat) => {
      const m = /^Exec\((.+)\)$/.exec(pat);
      if (!m) return false;
      const prefix = m[1].replace(/ \*$/, ""); // "git status *" → 前缀 "git status"
      return command === m[1] || command.startsWith(prefix);
    });
  if (match(rules.deny)) return "inside";           // deny 恒胜
  if (match(rules.allow)) return "outside-auto";
  if (match(rules.ask)) return "outside-ask";
  return "inside";                                   // 无匹配规则 → 沙箱内（fail-closed）
}
