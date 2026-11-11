// Portable ZIP32, stored entries: images are already compressed. No shell or temporary paths.
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
export function createZip(files: { name: string; data: Buffer }[]) {
  if (files.length > 1000 || files.reduce((sum, f) => sum + f.data.length, 0) > 250 * 1024 * 1024) throw new Error("ZIP exceeds 250 MB. Download the individual files instead.");
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    if (!/^[a-z0-9][a-z0-9.-]{0,100}$/.test(file.name)) throw new Error("Invalid ZIP entry name.");
    const name = Buffer.from(file.name), crc = crc32(file.data); const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(33, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(file.data.length, 18); h.writeUInt32LE(file.data.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(file.data.length, 20); c.writeUInt32LE(file.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, name, file.data); central.push(c, name); offset += h.length + name.length + file.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
