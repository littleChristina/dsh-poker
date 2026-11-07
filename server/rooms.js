'use strict';

const { Room } = require('./room');
const logger = require('./util/logger');

// 去掉了容易看错的 0/O、1/I
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomManager {
  constructor(hub) {
    this.hub = hub;
    this.rooms = new Map();
    this.cleaner = setInterval(() => this.cleanup(), 60 * 1000);
    this.cleaner.unref?.();
  }

  makeCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('无法生成房间码');
  }

  create() {
    const code = this.makeCode();
    const room = new Room(code, this.hub);
    this.rooms.set(code, room);
    logger.info(`房间 ${code} 已创建，当前房间数 ${this.rooms.size}`);
    return room;
  }

  get(code) {
    if (!code) return null;
    return this.rooms.get(String(code).toUpperCase().trim()) || null;
  }

  findByToken(token) {
    if (!token) return null;
    for (const room of this.rooms.values()) {
      const p = room.findByToken(token);
      if (p) return { room, player: p };
    }
    return null;
  }

  remove(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
    logger.info(`房间 ${code} 已关闭，当前房间数 ${this.rooms.size}`);
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.isIdle(now)) this.remove(code);
    }
  }
}

module.exports = { RoomManager, CODE_CHARS };
