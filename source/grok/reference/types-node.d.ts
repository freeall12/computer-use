/**
 * types-node.d.ts — node 内置模块的最小类型声明（零依赖类型检查用）。
 * 仅覆盖本目录引用的子集；安装 @types/node 后可删除本文件。
 */
declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:os' {
  export const homedir: () => string;
  export const tmpdir: () => string;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string): string;
}

declare module 'node:crypto' {
  export const randomUUID: () => string;
}

interface ErrnoException extends Error {
  code?: string;
}
