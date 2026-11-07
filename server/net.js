'use strict';

const os = require('os');

// 列出本机所有可用于局域网访问的 IPv4 地址
// 返回 [{ name, address, virtual }]，按"物理网卡优先"排序
function listAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      out.push({
        name,
        address: item.address,
        virtual: isVirtualName(name),
      });
    }
  }
  out.sort((a, b) => Number(a.virtual) - Number(b.virtual) || a.name.localeCompare(b.name));
  return out;
}

function isVirtualName(name) {
  return /vethernet|vmware|virtualbox|zerotier|tailscale|hamachi|radmin|hyper-v|wsl|docker|loopback|tap|tun/i.test(
    name
  );
}

function hostOf(addr, port) {
  return `http://${addr}:${port}`;
}

module.exports = { listAddresses, hostOf, isVirtualName };
