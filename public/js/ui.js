'use strict';

// 轻量 DOM 工具，不依赖任何框架。

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// 生成元素：el('span', { className: 'x', textContent: '…' }, [child…])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
let toastHideTimer = null;

export function toast(text, ms = 2600) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  requestAnimationFrame(() => node.classList.add('is-show'));
  toastTimer = setTimeout(() => {
    node.classList.remove('is-show');
    toastHideTimer = setTimeout(() => {
      node.hidden = true;
    }, 220);
  }, ms);
}

// 根据名字稳定地挑一个头像配色
export function avatarTint(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `tint-${h % 5}`;
}

export function initialOf(name) {
  const s = String(name || '').trim();
  return s ? Array.from(s)[0].toUpperCase() : '?';
}

// 复制文本：局域网 http 下没有 clipboard API，退回 execCommand
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // 继续尝试旧方法
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (_) {
    return false;
  }
}
