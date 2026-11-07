'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const MAX_BYTES = 2 * 1024 * 1024;

let ready = false;

function ts() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function ensure() {
  if (ready) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch (_) {
      /* 文件不存在 */
    }
    ready = true;
  } catch (_) {
    /* 日志目录不可写时只输出到控制台 */
  }
}

function write(level, args) {
  const line = `[${ts()}] [${level}] ` + args.join(' ');
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  ensure();
  if (!ready) return;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {
    /* 忽略写日志失败 */
  }
}

const logger = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  dir: LOG_DIR,
  file: LOG_FILE,
};

module.exports = logger;
