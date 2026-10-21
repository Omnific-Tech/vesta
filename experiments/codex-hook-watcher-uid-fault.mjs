// Fault injection preload for the foreign-owner transcript contract (`--import`). A process cannot create another uid's file without root,
// so every descriptor opened under a `/sessions/` path is reported by fstat as owned by uid+1. The product's own uid gate must reject it.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const tracked = new Map();
const open = fs.openSync;
const close = fs.closeSync;
const fstat = fs.fstatSync;
fs.openSync = (path, ...rest) => {
  const fd = open(path, ...rest);
  if (typeof path === 'string' && path.includes('/sessions/')) tracked.set(fd, path);
  return fd;
};
fs.closeSync = fd => {
  tracked.delete(fd);
  return close(fd);
};
fs.fstatSync = (fd, ...rest) => {
  const st = fstat(fd, ...rest);
  return tracked.has(fd)
    ? new Proxy(st, {
        get: (target, key) =>
          key === 'uid'
            ? target.uid + 1
            : typeof target[key] === 'function'
              ? target[key].bind(target)
              : target[key],
      })
    : st;
};
syncBuiltinESMExports();
