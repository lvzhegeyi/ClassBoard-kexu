/**
 * 课序 iOS — 正方教务（jwglxt / zfsoft）直连导入
 *
 * 目标站点：文华学院 `https://jw1.hustwenhua.net`（与桌面端/安卓端同一套接口）。
 * 约束：纯 JS/TS + `fetch`，不依赖 Node API、不新增 npm 依赖；解析复用 `src/core`。
 *
 * 接口流程（均已在桌面端实测，见 classboard/docs/CONTRACT.md §5）：
 *   1. GET  `/jwglxt/xtgl/login_slogin.html`            取 csrftoken 与初始会话 Cookie；
 *   2. GET  `/jwglxt/xtgl/login_getPublicKey.html`       取 `{modulus, exponent}`（base64 大端整数）；
 *   3. POST `/jwglxt/xtgl/login_slogin.html`             表单 `csrftoken/yhm/mm/language=zh_CN`，
 *                                                        密码 RSAES-PKCS1-v1_5 加密后 base64；
 *   4. GET  `/jwglxt/xtgl/index_initMenu.html`           **以能打开菜单页判定登录成功**（成功/失败都可能 302）；
 *   5. GET  `/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html`     解析学年/学期下拉，确定默认学期；
 *   6. POST `/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151` body `xnm&xqm&kzlx=ck` → 课表 JSON；
 *   7. POST `/jwglxt/kbcx/xskbcx_cxRjc.html`             body `xnm&xqm&xqh_id` → 真实节次时间（失败降级默认节次）。
 *
 * Cookie 说明：
 *   React Native（iOS）的 `fetch` 走原生 NSURLSession，并默认使用
 *   `NSHTTPCookieStorage.sharedHTTPCookieStorage` 自动保存/携带 Cookie
 *   （见 react-native/Libraries/Network/RCTNetworking.mm 与 RCTHTTPRequestHandler.mm）。
 *   因此这里**不自己维护 CookieJar**，只需每个请求带 `credentials: 'include'`；
 *   这样也避免了与原生 Cookie 处理重复注入。该行为依赖 RN 实现，真机需联调确认。
 */

import * as C from '../core/index.js';
import type { SectionTime } from '../types';

/* ============================== 常量 ============================== */

/** 站点根地址（不带结尾斜杠） */
export const JWXT_BASE_URL = 'https://jw1.hustwenhua.net';

const PATH_LOGIN = '/jwglxt/xtgl/login_slogin.html';
const PATH_PUBLIC_KEY = '/jwglxt/xtgl/login_getPublicKey.html';
const PATH_MENU = '/jwglxt/xtgl/index_initMenu.html';
const PATH_SCHEDULE_INDEX = '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151';
const PATH_SCHEDULE_QUERY = '/jwglxt/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151';
const PATH_SECTION_TIMES = '/jwglxt/kbcx/xskbcx_cxRjc.html';

/** 与桌面端一致的 Chrome UA：避免教务系统按 UA 返回简版/拒绝页面 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 15_000;
/** 默认学期查不到课时，最多再尝试几个「同学年其它学期 / 上一学年」候选 */
const MAX_SCHEDULE_ATTEMPTS = 4;

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const JSON_ACCEPT = 'application/json, text/javascript, */*; q=0.01';

const LOGIN_FAILED_MESSAGE =
  '教务网登录失败：请检查学号与密码是否正确，或稍后重试（账号可能被限制登录）';

const CAPTCHA_MESSAGE =
  '教务网要求输入验证码，手机端暂不支持自动识别。请先在电脑浏览器登录教务网，再用「扫码导入」或「粘贴 JSON」导入课表。';

const MFA_MESSAGE =
  '教务网要求二次验证（短信/动态口令），手机端暂不支持。请先在电脑浏览器完成验证，再用「扫码导入」导入课表。';

const SSO_MESSAGE =
  '教务网跳转到了统一身份认证（SSO），手机端暂不支持该登录方式。请用电脑浏览器登录后「扫码导入」导入课表。';

const PERIOD_BY_RSDM: Record<string, string> = { '2': '上午', '8': '下午', '32': '晚上' };
const TERM_NAMES: Record<string, string> = { '3': '第一学期', '12': '第二学期', '16': '第三学期' };

/* ============================== 类型 ============================== */

export type JwxtErrorCode = 'AUTH' | 'NETWORK' | 'EMPTY' | 'PARSE' | 'BAD_INPUT' | 'CHALLENGE';

/** 统一异常：`message` 一律可直接展示给用户（中文） */
export class JwxtError extends Error {
  code: JwxtErrorCode;

  constructor(code: JwxtErrorCode, message: string) {
    super(message);
    this.name = 'JwxtError';
    this.code = code;
  }
}

export interface JwxtPublicKey {
  /** base64 编码的大端无符号整数（可能带前导 0 / URL-safe 变体） */
  modulusBase64: string;
  exponentBase64: string;
}

export interface JwxtSelectOption {
  value: string;
  label: string;
  selected: boolean;
}

/** 随机字节来源：纯函数可注入，便于单测（默认使用系统 CSPRNG，退化时用 Math.random） */
export type JwxtRandomBytes = (length: number) => Uint8Array;

export type JwxtImportResult = { ok: true; state: any } | { ok: false; message: string };

interface HttpResult {
  status: number;
  /** 跟随重定向后的最终 URL（RN 原生提供；拿不到时回退请求 URL） */
  url: string;
  body: string;
}

interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface TermCandidate {
  year: string;
  term: string;
}

/* ============================ 小工具 ============================ */

const str = (value: unknown): string =>
  value == null ? '' : String(value).replace(/\u00a0/g, ' ').trim();

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============================ Base64 ============================ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 → 字节（容忍空白、URL-safe 变体、缺失的 `=` 补位） */
export function decodeBase64ToBytes(value: string): Uint8Array {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/g, '');
  if (!normalized) return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/]+$/.test(normalized)) {
    throw new JwxtError('PARSE', '公钥字段不是合法 base64');
  }
  const out = new Uint8Array(Math.floor((normalized.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let outIndex = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const digit = BASE64_ALPHABET.indexOf(normalized[i]);
    if (digit < 0) throw new JwxtError('PARSE', '公钥字段不是合法 base64');
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (accumulator >> bits) & 0xff;
      outIndex += 1;
    }
  }
  return out;
}

/**
 * 正方公钥字段是 base64 编码的大端无符号整数，可能带空白 / URL-safe 变体 / 前导 0。
 * 返回去掉前导 0 的字节数组。
 */
export function decodeBase64Integer(value: string, field = 'value'): Uint8Array {
  const bytes = decodeBase64ToBytes(value);
  if (!bytes.length) throw new JwxtError('PARSE', `公钥字段 ${field} 为空或不是合法 base64`);
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  return bytes.slice(start);
}

/** 字节 → 标准 base64（带 `=` 补位，与桌面端 `Buffer.toString('base64')` 一致） */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/* ============================== UTF-8 ============================== */

/** 字符串 → UTF-8 字节（不依赖 TextEncoder，Hermes 上可用） */
export function utf8Encode(input: string): Uint8Array {
  const text = String(input ?? '');
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/* =============================== RSA =============================== */

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  return value;
}

function bigIntToFixedBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(rest & BigInt(0xff));
    rest >>= BigInt(8);
  }
  return out;
}

function bitLength(value: bigint): number {
  return value > BigInt(0) ? value.toString(2).length : 0;
}

/** 模幂：base^exponent mod modulus（平方-乘，RSA 公钥指数通常 65537，很快） */
function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = BigInt(1);
  let factor = base % modulus;
  let power = exponent;
  while (power > BigInt(0)) {
    if ((power & BigInt(1)) === BigInt(1)) result = (result * factor) % modulus;
    power >>= BigInt(1);
    factor = (factor * factor) % modulus;
  }
  return result;
}

/**
 * 默认随机字节来源：优先 WebCrypto（Node/Web/开发构建），
 * 否则退回 Math.random（仅用于 PKCS#1 v1.5 填充；传输层已有 HTTPS）。
 * 真机上 `importFromJwxt` 会优先通过 expo-crypto 注入系统 CSPRNG。
 */
export function defaultRandomBytes(length: number): Uint8Array {
  const size = Math.max(0, Math.floor(length));
  const out = new Uint8Array(size);
  const cryptoObject = (globalThis as any)?.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < size; i += 1) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** 解析 `login_getPublicKey.html` 的 JSON：`{"modulus": "...", "exponent": "..."}` */
export function parsePublicKeyJson(text: string): JwxtPublicKey {
  let json: any;
  try {
    json = JSON.parse(String(text ?? '').trim());
  } catch {
    throw new JwxtError('PARSE', '公钥接口返回的不是合法 JSON');
  }
  const modulus = typeof json?.modulus === 'string' ? json.modulus.trim() : '';
  const exponent = typeof json?.exponent === 'string' ? json.exponent.trim() : '';
  if (!modulus || !exponent) {
    throw new JwxtError('PARSE', '公钥接口缺少 modulus/exponent 字段');
  }
  // 先验证可解码，避免拿到坏公钥后才在加密阶段报错
  decodeBase64Integer(modulus, 'modulus');
  decodeBase64Integer(exponent, 'exponent');
  return { modulusBase64: modulus, exponentBase64: exponent };
}

function findJsString(html: string, key: string): string | null {
  // exponent 常见值就是 "AQAB"（4 字符），因此下限取 4 而不是 8
  const pattern = new RegExp(`\\b${key}\\b\\s*[:=]\\s*["']([A-Za-z0-9+/=_-]{4,})["']`, 'i');
  const match = pattern.exec(html);
  return match ? match[1] : null;
}

/**
 * 兜底：部分站点把 `modulus` / `exponent` 直接写在登录页内联 JS 里。
 * 主路径仍是 `login_getPublicKey.html`。
 */
export function extractPublicKeyFromHtml(html: string): JwxtPublicKey | null {
  const text = String(html ?? '');
  if (!text) return null;
  const modulus = findJsString(text, 'modulus');
  const exponent = findJsString(text, 'exponent');
  if (!modulus || !exponent) return null;
  try {
    decodeBase64Integer(modulus, 'modulus');
    decodeBase64Integer(exponent, 'exponent');
    return { modulusBase64: modulus, exponentBase64: exponent };
  } catch {
    return null;
  }
}

/**
 * RSAES-PKCS1-v1_5 加密密码，返回 base64（正方 `mm` 字段格式）。
 *
 * 纯 BigInt 实现，等价于桌面端 `crypto.publicEncrypt({ padding: RSA_PKCS1_PADDING })`。
 * `randomBytes` 可注入以便单测；真机由 expo-crypto 提供系统随机数。
 */
export function rsaEncryptPassword(
  password: string,
  key: JwxtPublicKey,
  randomBytes: JwxtRandomBytes = defaultRandomBytes,
): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new JwxtError('BAD_INPUT', '密码不能为空');
  }
  const modulus = bytesToBigInt(decodeBase64Integer(key.modulusBase64, 'modulus'));
  const exponent = bytesToBigInt(decodeBase64Integer(key.exponentBase64, 'exponent'));
  if (modulus <= BigInt(0) || exponent <= BigInt(0)) {
    throw new JwxtError('PARSE', '教务网 RSA 公钥格式异常');
  }

  // PKCS#1 v1.5：EM = 0x00 || 0x02 || PS(随机非零) || 0x00 || M，长度 = 模长
  const k = Math.ceil(bitLength(modulus) / 8);
  const message = utf8Encode(password);
  if (message.length > k - 11) {
    throw new JwxtError('BAD_INPUT', `密码过长（最多 ${k - 11} 字节），无法使用教务网 RSA 公钥加密`);
  }
  const psLength = k - message.length - 3;
  const block = new Uint8Array(k);
  block[0] = 0x00;
  block[1] = 0x02;
  const padding = randomBytes(psLength);
  for (let i = 0; i < psLength; i += 1) {
    const byte = padding && i < padding.length ? padding[i] : 0;
    block[2 + i] = byte === 0 ? 0x01 : byte; // 填充字节不能为 0
  }
  block[2 + psLength] = 0x00;
  block.set(message, 3 + psLength);

  const encrypted = modPow(bytesToBigInt(block), exponent, modulus);
  return encodeBase64(bigIntToFixedBytes(encrypted, k));
}

/* ============================ HTML 解析 ============================ */

const ENTITY_NAMES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

/** 解码常见 HTML 实体（顺序与桌面端一致，避免二次解码） */
export function decodeHtmlEntities(input: string): string {
  const text = String(input ?? '');
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITY_NAMES[body.toLowerCase()] ?? whole;
  });
}

/** 去掉标签、保留纯文本（用于 `<option>` 的展示文本） */
export function stripTags(html: string): string {
  return String(html ?? '').replace(/<[^>]*>/g, ' ');
}

interface HtmlInput {
  id: string;
  name: string;
  type: string;
  value: string;
}

function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attrText)) !== null) {
    const name = match[1].toLowerCase();
    if (!name || name === '/') continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

function parseInputTags(html: string): HtmlInput[] {
  const inputs: HtmlInput[] = [];
  const pattern = /<input\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] ?? '');
    inputs.push({
      id: attrs.id ?? '',
      name: attrs.name ?? '',
      type: attrs.type ?? '',
      value: attrs.value ?? '',
    });
  }
  return inputs;
}

/**
 * 从登录页隐藏域提取 csrftoken。
 *
 * 本站值形如 `uuid,uuid去掉横线的uuid`，必须原样回传（不要拆开、不要只取一段）。
 */
export function extractCsrfToken(html: string): string {
  const text = String(html ?? '');
  const inputs = parseInputTags(text);
  const byName = inputs.find((item) => item.name.toLowerCase() === 'csrftoken' && item.value !== '');
  if (byName) return byName.value;
  const byId = inputs.find((item) => item.id.toLowerCase() === 'csrftoken' && item.value !== '');
  if (byId) return byId.value;
  const inline = /csrftoken["']?\s*[:=]\s*["']([^"']+)["']/i.exec(text);
  return inline ? inline[1] : '';
}

/** 解析页面里某个 `<select>` 的全部 `<option>`（支持单/双/无引号 value、selected） */
export function parseSelectOptions(html: string, selectId: string): JwxtSelectOption[] {
  const text = String(html ?? '');
  if (!text || !selectId) return [];
  const selectPattern = new RegExp(
    `<select\\b[^>]*\\bid\\s*=\\s*["']${escapeRegExp(selectId)}["'][^>]*>([\\s\\S]*?)</select>`,
    'i',
  );
  const selectMatch = selectPattern.exec(text);
  if (!selectMatch) return [];
  const inner = selectMatch[1] ?? '';
  const options: JwxtSelectOption[] = [];
  const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = optionPattern.exec(inner)) !== null) {
    const attrText = match[1] ?? '';
    const valueMatch = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrText);
    const rawValue = valueMatch ? (valueMatch[1] ?? valueMatch[2] ?? valueMatch[3] ?? '') : '';
    const label = decodeHtmlEntities(stripTags(match[2] ?? '')).replace(/\s+/g, ' ').trim();
    options.push({
      value: decodeHtmlEntities(rawValue).trim(),
      label,
      selected: /\bselected\b/i.test(attrText),
    });
  }
  return options;
}

/** 判断响应是不是登录页（登录态失效时可能 302，也可能 200 直接渲染登录页） */
export function isLoginPageHtml(html: string): boolean {
  const text = String(html ?? '');
  if (!text) return false;
  const hasUsernameInput = /(?:id|name)\s*=\s*["']yhm["']/i.test(text);
  const hasLoginMarker = /login_slogin|login_getPublicKey|userAccountError|loginBox|login-box/i.test(text);
  return hasUsernameInput && hasLoginMarker;
}

/** 判断 URL 是否指向登录相关页面（多为 302 Location） */
export function isLoginUrl(url: string): boolean {
  const text = String(url ?? '');
  if (!text) return false;
  return /login_slogin|login_getPublicKey|login_sso|ssologin/i.test(text);
}

/** 从登录失败页面提取可读原因（用户名或密码错误等）；识别不到返回空串 */
export function extractLoginError(html: string): string {
  const text = String(html ?? '');
  if (!text) return '';
  const patterns = [
    /用户名或密码错误[^<>。\n]{0,30}/,
    /密码错误[^<>。\n]{0,30}/,
    /用户不存在[^<>。\n]{0,30}/,
    /账号[^<>。\n]{0,20}错误/,
    /验证码[^<>。\n]{0,30}/,
    /登录失败[^<>。\n]{0,30}/,
    /该用户[^<>。\n]{0,30}/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return '';
}

/**
 * 粗略判断「登录后菜单页」是否正常。
 *
 * 登录成功判定不能只看 302（正方成功与失败都可能 302 回登录页），
 * 这里以「能拿到菜单页」为准；真正强校验由后续打开课表页完成。
 */
export function looksLikeMenuPage(html: string): boolean {
  const text = String(html ?? '');
  if (text.length < 200) return false;
  if (isLoginPageHtml(text)) return false;
  return ['initMenu', 'index_initMenu', 'gnmkdm', 'mainFrame', 'menu', 'xtgl'].some((marker) =>
    text.toLowerCase().includes(marker.toLowerCase()),
  );
}

/** 从 URL 的 query 提取参数（用于检查 SSO/统一身份认证跳转参数，如 service/ticket/execution） */
export function parseUrlParams(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  const text = String(url ?? '');
  const queryIndex = text.indexOf('?');
  if (queryIndex < 0) return result;
  const hashIndex = text.indexOf('#', queryIndex);
  const query = text.slice(queryIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  for (const part of query.split('&')) {
    if (!part) continue;
    const separator = part.indexOf('=');
    const rawKey = separator < 0 ? part : part.slice(0, separator);
    const rawValue = separator < 0 ? '' : part.slice(separator + 1);
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      if (key) result[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // 非法的百分号编码：忽略该参数，不影响整体失败信息
    }
  }
  return result;
}

/** 检测统一身份认证（SSO）跳转；返回中文提示，无需处理时返回 null */
export function detectSsoChallenge(url: string): string | null {
  const target = String(url ?? '').toLowerCase();
  if (!target) return null;
  if (/login_sso|ssologin|\/idp\/|\/cas\/|\/sso\/|shibboleth/.test(target)) return SSO_MESSAGE;
  return null;
}

/**
 * 检测验证码 / 二次验证页面，返回可直接展示的中文提示；未检测到返回 null。
 *
 * 注意：只应在「登录表单提交后的响应」上调用；登录页本身可能内联验证码相关脚本，
 * 提前调用容易误判。
 */
export function detectAuthChallenge(url: string, html: string): string | null {
  const sso = detectSsoChallenge(url);
  if (sso) return sso;
  const text = String(html ?? '');
  if (!text) return null;
  if (/二次验证|双因素|两步验证|动态口令|动态密码|短信验证|手机验证码|\bmfa\b|one[- ]time password/i.test(text)) {
    return MFA_MESSAGE;
  }
  if (/输入验证码|请输入验证码|验证码错误|验证码不正确|captcha|verifycode|checkcode|validatecode/i.test(text)) {
    return CAPTCHA_MESSAGE;
  }
  return null;
}

/* ============================ 节次时间 ============================ */

const HM_PATTERN = /^(\d{1,2}):(\d{2})\s*$/;

/** `8:10` / `08:10` → `08:10`；非法返回空串 */
export function normalizeClockTime(value: unknown): string {
  const match = HM_PATTERN.exec(str(value));
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * 解析节次时间接口 JSON：
 * `[{"jcmc":"1","qssj":"08:10","jssj":"08:55","rsdmc":"上午","rsdm":"2"}, ...]`
 * （也兼容 `{"rows":[...]}`）。按节次升序去重；无可用数据抛 EMPTY。
 */
export function parseSectionTimes(text: string): SectionTime[] {
  const trimmed = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new JwxtError('EMPTY', '节次时间接口返回空响应');

  let list: unknown;
  try {
    const data: any = JSON.parse(trimmed);
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.rows)) list = data.rows;
    else list = [];
  } catch {
    if (isLoginPageHtml(trimmed)) {
      throw new JwxtError('AUTH', '查询节次时间：登录态已失效，请重新登录教务网');
    }
    throw new JwxtError('PARSE', '节次时间接口返回的不是合法 JSON，站点可能已改版');
  }

  const parsed: SectionTime[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const index = Math.round(Number(record.jcmc));
    if (!Number.isFinite(index) || index < 1 || index > 20) continue;
    const start = normalizeClockTime(record.qssj);
    const end = normalizeClockTime(record.jssj);
    if (!start || !end) continue;
    const period = str(record.rsdmc) || PERIOD_BY_RSDM[str(record.rsdm)] || '';
    parsed.push({ index, start, end, period });
  }
  if (!parsed.length) throw new JwxtError('EMPTY', '节次时间接口没有返回可用的节次数据');

  const seen = new Set<number>();
  const unique: SectionTime[] = [];
  for (const section of parsed.sort((a, b) => a.index - b.index)) {
    if (seen.has(section.index)) continue;
    seen.add(section.index);
    unique.push(section);
  }
  return unique;
}

/* ============================ 学期工具 ============================ */

/** xqm 代码 → 中文学期名 */
export function termDisplayName(term: string): string {
  const key = str(term);
  return TERM_NAMES[key] ?? `第${key}学期`;
}

/**
 * 生成 `meta.term.label`，例如 `2026-2027 学年 第一学期`。
 * `yearRangeText` 为课表页学年下拉的展示文本（如 `2026-2027`），为空时按 year 推算。
 */
export function buildTermLabel(year: string, term: string, yearRangeText?: string): string {
  const label = termDisplayName(term);
  const range =
    str(yearRangeText) ||
    (() => {
      const start = Number(str(year));
      return Number.isFinite(start) && start > 0 ? `${start}-${start + 1}` : '';
    })();
  return range ? `${range} 学年 ${label}` : label;
}

/** 按当前日期猜「学年起始年」：9 月及以后属于本自然年，否则属于上一自然年 */
export function academicYearFromDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  return String(date.getMonth() + 1 >= 9 ? year : year - 1);
}

/** 候选学期：先当前学年的各学期（选中项优先），再上一学年；最多 MAX_SCHEDULE_ATTEMPTS 个 */
function buildTermCandidates(
  termOptions: JwxtSelectOption[],
  selectedYear: string,
  selectedTerm: string,
): TermCandidate[] {
  const termValues: string[] = [];
  for (const option of termOptions) {
    if (option.value && !termValues.includes(option.value)) termValues.push(option.value);
  }
  if (!termValues.includes(selectedTerm)) termValues.unshift(selectedTerm);
  const orderedTerms = [selectedTerm, ...termValues.filter((value) => value !== selectedTerm)];
  const currentYear = Number(selectedYear);
  const previousYear = Number.isFinite(currentYear) && currentYear > 0 ? String(currentYear - 1) : selectedYear;

  const candidates: TermCandidate[] = [];
  for (const term of orderedTerms) candidates.push({ year: selectedYear, term });
  if (previousYear !== selectedYear) {
    for (const term of orderedTerms) candidates.push({ year: previousYear, term });
  }
  return candidates.slice(0, MAX_SCHEDULE_ATTEMPTS);
}

/** 从课表 JSON 里取校区 id（节次接口需要），拿不到时用 `1` */
function pickXqhId(rawSchedule: string): string {
  try {
    const json: any = JSON.parse(rawSchedule);
    const records = [
      ...(Array.isArray(json?.kbList) ? json.kbList : []),
      ...(Array.isArray(json?.sjkList) ? json.sjkList : []),
    ];
    for (const record of records) {
      const id = str(record?.xqh_id);
      if (id) return id;
    }
  } catch {
    // 非 JSON 时交给后续解析流程报错
  }
  return '1';
}

/* ============================= 网络层 ============================= */

/**
 * 发送请求并返回「最终响应」。
 *
 * - 依赖 RN 原生 Cookie 管理（`credentials: 'include'`），不做手动 Cookie 拼接；
 * - `redirect: 'follow'`：RN/iOS 会自动跟随 302，最终 URL 由原生 responseURL 提供；
 * - 15 秒超时（AbortController + 兜底提示），所有异常转成中文 [JwxtError]。
 */
async function httpRequest(pathOrUrl: string, init: HttpInit = {}): Promise<HttpResult> {
  const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : JWXT_BASE_URL + pathOrUrl;
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
  };
  for (const [key, value] of Object.entries(init.headers ?? {})) headers[key] = String(value);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => {
    try {
      controller?.abort();
    } catch {
      // abort 失败不影响超时提示
    }
  }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      credentials: 'include',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    const name = (error as any)?.name;
    if (name === 'AbortError') {
      throw new JwxtError('NETWORK', `连接教务网超时（${REQUEST_TIMEOUT_MS / 1000} 秒），请检查网络后重试`);
    }
    throw new JwxtError('NETWORK', `无法连接教务网（请检查网络）：${describeError(error)}`);
  } finally {
    clearTimeout(timer);
  }

  let body = '';
  try {
    body = await response.text();
  } catch (error) {
    throw new JwxtError('NETWORK', `读取教务网响应失败：${describeError(error)}`);
  }
  return { status: response.status, url: response.url || url, body };
}

async function httpGet(path: string, referer?: string, accept = HTML_ACCEPT): Promise<HttpResult> {
  const headers: Record<string, string> = { Accept: accept };
  if (referer) headers.Referer = referer;
  return httpRequest(path, { method: 'GET', headers });
}

async function httpPostForm(
  path: string,
  body: string,
  referer?: string,
  accept = HTML_ACCEPT,
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    Accept: accept,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: JWXT_BASE_URL,
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (referer) headers.Referer = referer;
  return httpRequest(path, { method: 'POST', body, headers });
}

/** HTTP 状态与登录页校验：通过则返回，不通过抛中文 [JwxtError] */
function ensureOk(response: HttpResult, action: string): void {
  if (isLoginUrl(response.url)) {
    throw new JwxtError('AUTH', `${action}：登录态已失效，请重新登录教务网`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new JwxtError('AUTH', `${action}：没有访问权限或登录已失效（HTTP ${response.status}）`);
  }
  if (response.status >= 500) {
    throw new JwxtError('NETWORK', `${action}：教务网服务异常（HTTP ${response.status}），请稍后重试`);
  }
  if (response.status >= 400) {
    throw new JwxtError('NETWORK', `${action}：教务网返回 HTTP ${response.status}`);
  }
  if (response.status >= 300) {
    throw new JwxtError('NETWORK', `${action}：教务网重定向到未知地址（HTTP ${response.status}）`);
  }
  if (isLoginPageHtml(response.body)) {
    throw new JwxtError('AUTH', `${action}：登录态已失效，请重新登录教务网`);
  }
}

/* ============================= 登录流程 ============================= */

/** 取加密公钥：主路径 `login_getPublicKey.html`，失败时兜底解析登录页内联 JS 的 modulus/exponent */
async function fetchPublicKey(loginHtml: string, referer: string): Promise<JwxtPublicKey> {
  try {
    const response = await httpGet(PATH_PUBLIC_KEY, referer, JSON_ACCEPT);
    // 注意：不能用 isLoginUrl(response.url) 判断——公钥接口本身就叫 login_getPublicKey.html，
    // 只有「解析成 JSON 且带 modulus/exponent」才算拿到公钥。
    if (response.status >= 200 && response.status < 300 && response.body.trim()) {
      return parsePublicKeyJson(response.body);
    }
  } catch {
    // 接口不可用 / 返回的不是公钥 JSON：继续尝试登录页内联公钥
  }
  const fromHtml = extractPublicKeyFromHtml(loginHtml);
  if (fromHtml) return fromHtml;
  throw new JwxtError(
    'PARSE',
    '无法获取教务网 RSA 公钥（接口与登录页均未提供 modulus/exponent），站点可能已改版',
  );
}

/** 尝试通过已安装的 expo-crypto 获取系统 CSPRNG（无原生模块时返回 null） */
async function loadDeviceRandomBytes(): Promise<JwxtRandomBytes | null> {
  try {
    const expoCrypto: any = await import('expo-crypto');
    const getRandomBytes = expoCrypto?.getRandomBytes;
    if (typeof getRandomBytes === 'function') {
      return (length: number) => getRandomBytes(length) as Uint8Array;
    }
  } catch {
    // Expo Go 旧环境 / Web / 单测环境没有该原生模块：退回 defaultRandomBytes
  }
  return null;
}

/**
 * 校验登录态：能打开 `index_initMenu.html` 菜单页才算登录成功。
 *
 * 仅看 302 不可靠：正方登录失败与成功都可能跳回登录页，且失败页可能是 200 渲染的登录页。
 */
async function verifyLogin(): Promise<void> {
  const menu = await httpGet(PATH_MENU, JWXT_BASE_URL + '/');
  const sso = detectSsoChallenge(menu.url);
  if (sso) throw new JwxtError('CHALLENGE', sso);
  if (menu.status === 401 || menu.status === 403) throw new JwxtError('AUTH', LOGIN_FAILED_MESSAGE);
  if (menu.status >= 500) {
    throw new JwxtError('NETWORK', `登录失败：教务网服务异常（HTTP ${menu.status}）`);
  }
  if (menu.status >= 400) {
    throw new JwxtError('NETWORK', `登录失败：教务网返回 HTTP ${menu.status}`);
  }
  if (!menu.body.trim() || isLoginPageHtml(menu.body) || isLoginUrl(menu.url)) {
    throw new JwxtError('AUTH', LOGIN_FAILED_MESSAGE);
  }
  if (!looksLikeMenuPage(menu.body)) {
    throw new JwxtError('PARSE', '登录失败：登录后未能打开教务网菜单页（可能被重定向到其它页面），请稍后重试');
  }
}

/** 账号密码登录；成功后会话 Cookie 已由原生 Cookie 存储持有 */
async function login(username: string, password: string): Promise<void> {
  // 1) 打开登录页：拿 csrftoken 与初始会话 Cookie
  const loginPage = await httpGet(PATH_LOGIN, JWXT_BASE_URL + '/');
  const sso = detectSsoChallenge(loginPage.url);
  if (sso) throw new JwxtError('CHALLENGE', sso);
  if (loginPage.status >= 500) {
    throw new JwxtError('NETWORK', `打开教务网登录页失败：服务异常（HTTP ${loginPage.status}）`);
  }
  if (loginPage.status >= 400) {
    throw new JwxtError('NETWORK', `打开教务网登录页失败（HTTP ${loginPage.status}）`);
  }
  if (!loginPage.body.trim()) {
    throw new JwxtError('PARSE', '教务网登录页返回空内容，请检查网络后重试');
  }
  const csrfToken = extractCsrfToken(loginPage.body);
  if (!csrfToken) {
    throw new JwxtError('PARSE', '教务网登录页缺少 csrftoken 隐藏域，站点可能已改版');
  }
  if (!/(?:id|name)\s*=\s*["']yhm["']/i.test(loginPage.body)) {
    throw new JwxtError('PARSE', '教务网登录页缺少用户名输入框，站点可能已改版');
  }

  // 2) 取 RSA 公钥并加密密码（PKCS#1 v1.5）
  const publicKey = await fetchPublicKey(loginPage.body, loginPage.url);
  const deviceRandomBytes = await loadDeviceRandomBytes();
  const encryptedPassword = rsaEncryptPassword(password, publicKey, deviceRandomBytes ?? defaultRandomBytes);

  // 3) 提交登录表单（字段与桌面端一致：csrftoken/yhm/mm/language）
  const form = [
    `csrftoken=${encodeURIComponent(csrfToken)}`,
    `yhm=${encodeURIComponent(username)}`,
    `mm=${encodeURIComponent(encryptedPassword)}`,
    'language=zh_CN',
  ].join('&');
  const loginResponse = await httpPostForm(PATH_LOGIN, form, loginPage.url);
  if (loginResponse.status >= 500) {
    throw new JwxtError('NETWORK', `登录失败：教务网服务异常（HTTP ${loginResponse.status}）`);
  }
  if (loginResponse.status === 401 || loginResponse.status === 403) {
    throw new JwxtError('AUTH', LOGIN_FAILED_MESSAGE);
  }
  // 验证码 / 二次验证 / SSO：给出明确提示，而不是笼统“登录失败”
  const challenge = detectAuthChallenge(loginResponse.url, loginResponse.body);
  if (challenge) throw new JwxtError('CHALLENGE', challenge);
  const errorMessage = extractLoginError(loginResponse.body);
  if (errorMessage) {
    throw new JwxtError('AUTH', `教务网登录失败：${errorMessage}`);
  }

  // 4) 登录成功判定：能打开菜单页（不要只看 302）
  await verifyLogin();
}

/* ============================= 课表流程 ============================= */

/** 打开个人课表页（内含学年/学期下拉），并校验登录态 */
async function openScheduleIndex(): Promise<HttpResult> {
  const response = await httpGet(PATH_SCHEDULE_INDEX, JWXT_BASE_URL + PATH_MENU);
  const sso = detectSsoChallenge(response.url);
  if (sso) throw new JwxtError('CHALLENGE', sso);
  ensureOk(response, '打开课表页');
  return response;
}

/**
 * 查询某学年/学期的原始课表 JSON。
 * `kbList: []` 表示该学期没有课（正常返回）；空响应才抛 EMPTY。
 */
async function querySchedule(year: string, term: string): Promise<string> {
  const form = `xnm=${encodeURIComponent(year)}&xqm=${encodeURIComponent(term)}&kzlx=ck`;
  const response = await httpPostForm(
    PATH_SCHEDULE_QUERY,
    form,
    JWXT_BASE_URL + PATH_SCHEDULE_INDEX,
    JSON_ACCEPT,
  );
  ensureOk(response, '查询课表');
  const text = response.body.trim();
  if (!text) throw new JwxtError('EMPTY', '查询课表返回空响应，可能该学期没有课表数据');
  return text;
}

/** 查询真实节次时间；失败时返回 null，由调用方降级为默认节次（不影响导入） */
async function fetchSectionTimes(
  year: string,
  term: string,
  xqhId: string,
): Promise<SectionTime[] | null> {
  try {
    const form = `xnm=${encodeURIComponent(year)}&xqm=${encodeURIComponent(term)}&xqh_id=${encodeURIComponent(xqhId)}`;
    const response = await httpPostForm(
      PATH_SECTION_TIMES,
      form,
      JWXT_BASE_URL + PATH_SCHEDULE_INDEX,
      JSON_ACCEPT,
    );
    ensureOk(response, '查询节次时间');
    return parseSectionTimes(response.body);
  } catch {
    // 节次时间只影响倒计时精度，拉取失败不应让整个导入失败
    return null;
  }
}

/* ============================== 主入口 ============================== */

/**
 * 登录正方教务网并抓取课表，返回与桌面端同构的 state
 * （可直接交给 `store.replaceState()`；settings 会被调用方保留）。
 *
 * - 默认取课表页下拉框当前选中的学年/学期；
 * - 该学期查不到课时，按「同学年其它学期 → 上一学年」最多再试 4 个候选，避免学期切换期导入空课表；
 * - 真实节次时间拉取失败自动降级为默认节次；
 * - 可选传入当前 `baseState`（传入则复用桌面端 `mergeImported`，保留调休规则/已校准开学日期等）；
 * - 所有失败都返回 `{ ok:false, message }`，不会向 UI 抛异常。
 */
export async function importFromJwxt(
  username: string,
  password: string,
  baseState?: any,
): Promise<JwxtImportResult> {
  const user = String(username ?? '').trim();
  const pass = String(password ?? '');
  if (!user) return { ok: false, message: '请先输入教务网学号' };
  if (!pass) return { ok: false, message: '请先输入教务网密码' };

  try {
    await login(user, pass);

    const indexPage = await openScheduleIndex();
    const years = parseSelectOptions(indexPage.body, 'xnm').filter((option) => /^\d{4}$/.test(option.value));
    const termOptions = parseSelectOptions(indexPage.body, 'xqm').filter((option) => option.value !== '');
    if (!years.length || !termOptions.length) {
      throw new JwxtError('PARSE', '教务网课表页缺少学年/学期下拉框，站点可能已改版');
    }

    const selectedYear =
      years.find((option) => option.selected)?.value || academicYearFromDate();
    const selectedTerm =
      termOptions.find((option) => option.selected)?.value || termOptions[0].value;
    const yearRangeText = years.find((option) => option.value === selectedYear)?.label ?? '';
    const candidates = buildTermCandidates(termOptions, selectedYear, selectedTerm);

    let parsed: any = null;
    let chosen: TermCandidate | null = null;
    let chosenRaw = '';
    let lastEmptyMessage = '';
    for (const candidate of candidates) {
      let raw = '';
      try {
        raw = await querySchedule(candidate.year, candidate.term);
      } catch (error) {
        if (error instanceof JwxtError && error.code === 'EMPTY') {
          lastEmptyMessage = error.message;
          continue;
        }
        throw error;
      }
      const label = buildTermLabel(
        candidate.year,
        candidate.term,
        candidate.year === selectedYear ? yearRangeText : '',
      );
      const result: any = C.parseJwxtResponse(raw, {
        year: candidate.year,
        term: candidate.term,
        label,
      });
      if (!result?.statePatch?.meta) {
        const warning = Array.isArray(result?.warnings) ? result.warnings.join('；') : '';
        throw new JwxtError('PARSE', `课表响应解析失败${warning ? `：${warning}` : '，站点可能已改版'}`);
      }
      parsed = result;
      chosen = candidate;
      chosenRaw = raw;
      const summary = result.summary ?? {};
      const hasData = (Number(summary.courseCount) || 0) > 0 || (Number(summary.floatingCount) || 0) > 0;
      if (hasData) break;
    }

    const triedText = candidates
      .map((candidate) => `${candidate.year} 学年${termDisplayName(candidate.term)}`)
      .join('、');

    if (!parsed || !chosen) {
      return {
        ok: false,
        message:
          lastEmptyMessage ||
          `未查询到课表数据：已尝试 ${triedText}，教务网没有返回课程（可能该学期尚未排课）`,
      };
    }
    const summary = parsed.summary ?? {};
    const hasData = (Number(summary.courseCount) || 0) > 0 || (Number(summary.floatingCount) || 0) > 0;
    if (!hasData) {
      return {
        ok: false,
        message: `未查询到课表数据：已尝试 ${triedText}，教务网没有返回课程（可能该学期尚未排课）`,
      };
    }

    // 真实节次时间（失败降级默认节次）
    const sections = await fetchSectionTimes(chosen.year, chosen.term, pickXqhId(chosenRaw));
    let finalParsed: any = parsed;
    if (sections && sections.length) {
      const label = buildTermLabel(
        chosen.year,
        chosen.term,
        chosen.year === selectedYear ? yearRangeText : '',
      );
      finalParsed = C.parseJwxtResponse(chosenRaw, {
        year: chosen.year,
        term: chosen.term,
        label,
        sections,
      });
    }

    // 与桌面端导入保持一致：有 baseState 时保留调休规则/已校准开学日期/手动配色；
    // 没有时合并进默认 state（调用方用 store.replaceState() 写入时会保留本机设置）。
    const merged: any = C.mergeImported(baseState ?? null, finalParsed.statePatch);
    const state = merged?.state ?? finalParsed.statePatch;
    if (!state) throw new JwxtError('PARSE', '课表解析结果为空');
    return { ok: true, state };
  } catch (error) {
    if (error instanceof JwxtError) return { ok: false, message: error.message };
    return { ok: false, message: `教务网导入失败：${describeError(error)}` };
  }
}
