/**
 * 课序 — 核心逻辑统一出口
 * 约束：零依赖、零 DOM、零 Node API；浏览器 / Node / 未来 Android(WebView 或 JS 引擎) 均可直接使用。
 */
export * from './util.js';
export * from './weeks.js';
export * from './model.js';
export * from './parse-jwxt.js';
export * from './schedule.js';
export * from './remind.js';
