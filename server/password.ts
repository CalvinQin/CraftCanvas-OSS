import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// OWASP 的 32 MiB scrypt 配置；不依赖 Workers 的 PBKDF2 迭代上限。
const options = { N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 40 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await scryptAsync(password, salt, options);
  return `scrypt$32768$8$3$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split('$');
  const valid = parts?.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$3';
  // 不存在的邮箱也执行同样的 KDF，避免通过响应耗时判断账号是否存在。
  const salt = valid ? hexToBytes(parts[4]) : new Uint8Array(16);
  const expected = valid ? hexToBytes(parts[5]) : new Uint8Array(32);
  const actual = await scryptAsync(password, salt, options);
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ (expected[i] || 0);
  return Boolean(valid) && difference === 0;
}
