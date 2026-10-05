/**
 * oauth.ts —— Devin CLI 登录流骨架（cleanroom 重构）
 *
 * 协议事实来源：本机第三方开源参考实现（oh-my-pi registry/oauth/devin.ts）+ docs.devin.ai
 * （[INV-E1/E2/E3/F5]）。端口 59653、路径 /auth/cli/continue、/auth/cli/token 均为接口事实。
 *
 * 运行前提：需要真实 Devin 账号在浏览器完成授权。本骨架不携带、不持久化任何凭据。
 */
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const DEVIN_WEBAPP_URL = "https://app.devin.ai";   // [INV-E2]
const DEVIN_API_URL = "https://api.devin.ai";      // [INV-E1]
const CALLBACK_PORT = 59653;                       // [INV-E3]
const CALLBACK_PATH = "/callback";                 // [INV-E3]
const TOKEN_PATH = "/auth/cli/token";              // [INV-E3]
const AUTH_CONTINUE_PATH = "/auth/cli/continue";   // [INV-E3]

interface PkcePair { verifier: string; challenge: string }

/** RFC 7636 PKCE（S256）。CLI 实测即此方法（auth URL 参数 code_challenge_method=S256）。 */
function generatePkce(): PkcePair {
  const verifier = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface DevinLoginResult {
  /** JWT（exp 字段用于过期判断；文档称该 token 持久不过期，参考实现回退 365 天） */
  token: string;
  apiEndpoint: string;
  enterpriseUrl: string;
}

/**
 * 复刻 `devin auth login` 的网络形状：
 * 1. 起 127.0.0.1:59653/callback 本地回调；
 * 2. 打开 app.devin.ai/auth/cli/continue（prompt=select_account, PKCE S256）；
 * 3. 收到 ?code= 后 POST api.devin.ai/auth/cli/token {code, code_verifier} 换 JWT。
 */
export async function loginDevin(openBrowser: (url: string) => void): Promise<DevinLoginResult> {
  const pkce = generatePkce();
  const state = randomUUID();

  const codePromise = new Promise<string>((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) { res.writeHead(404).end(); return; }
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" }).end(
        err ? `<p>login failed: ${err}</p>` : "<p>login complete, return to terminal.</p>",
      );
      server.close();
      if (code) resolve(code); else reject(new Error(err ?? "no code in callback"));
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });

  const params = new URLSearchParams({
    redirect_uri: `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`,
    state,
    prompt: "select_account",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });
  openBrowser(`${DEVIN_WEBAPP_URL}${AUTH_CONTINUE_PATH}?${params.toString()}`);

  const code = await codePromise;
  const res = await fetch(`${DEVIN_API_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: pkce.verifier }),
  });
  if (!res.ok) throw new Error(`devin cli token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token?: string };
  if (typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("devin cli token exchange returned an empty token");
  }
  return { token: data.token, apiEndpoint: DEVIN_API_URL, enterpriseUrl: DEVIN_WEBAPP_URL };
}

/** JWT exp 读取（提前 5 分钟判过期）；非 JWT 时参考实现回退 365 天。 */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 - 5 * 60 * 1000 : null;
  } catch { return null; }
}

/**
 * 文档口径的凭据存储位（本骨架只写出位置事实，不实现写盘）：
 *   $XDG_DATA_HOME/devin/credentials.toml 或 ~/.local/share/devin/credentials.toml
 *   Windows: %APPDATA%\devin\credentials.toml   [INV-F5]
 * ACP 模式下不使用本地凭据：宿主经 authenticate(meta: api_key+api_server_url) 注入。[INV-F5]
 */
export const CREDENTIALS_FILE_CANDIDATES = [
  `${process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`}/devin/credentials.toml`,
] as const;
