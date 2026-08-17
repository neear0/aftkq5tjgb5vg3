/**
 * Minimálny ZIP writer.
 *
 * PREČO NIE Compress-Archive
 * PowerShell 5.1 (ten je na Windows štandardne) ukladá do ZIP-u cesty so
 * SPÄTNÝMI lomítkami — `ultrapeptidy\style.css`. ZIP špecifikácia predpisuje
 * dopredné. WordPress rozbaľuje cez PHP ZipArchive na Linuxe, ktorý taký
 * názov považuje za JEDEN súbor s backslashom v mene, nie za podadresár.
 * Téma sa potom nenainštaluje alebo sa nainštaluje rozsypaná.
 *
 * Preto si ZIP skladáme sami: deflate cez zlib, cesty vždy s `/`.
 * Žiadna externá závislosť.
 */
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

/* zlib.crc32 je v Node až od 20.12 — pre istotu fallback. */
let crcTable = null;
function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

/**
 * @param {{name:string, data:Buffer, mtime?:Date}[]} files
 *        `name` je cesta vnútri archívu, vždy s `/`
 * @returns {Buffer}
 */
export function createZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const raw = f.data;
    const comp = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const { time, date } = dosDateTime(f.mtime ?? new Date());

    // ── local file header ──
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);   // podpis
    lfh.writeUInt16LE(20, 4);           // verzia potrebná na rozbalenie
    lfh.writeUInt16LE(0x0800, 6);       // bit 11 = názvy v UTF-8
    lfh.writeUInt16LE(8, 8);            // metóda: deflate
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    lfh.writeUInt16LE(0, 28);           // bez extra polí

    chunks.push(lfh, name, comp);

    // ── záznam do centrálneho adresára ──
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(0x031E, 4);       // vytvorené na Unixe, verzia 3.0
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(time, 12);
    cdh.writeUInt16LE(date, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt16LE(0, 30);           // extra
    cdh.writeUInt16LE(0, 32);           // komentár
    cdh.writeUInt16LE(0, 34);           // číslo disku
    cdh.writeUInt16LE(0, 36);           // interné atribúty
    cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38); // unixové práva 644 (>>>0 kvôli znamienkovému posunu)
    cdh.writeUInt32LE(offset, 42);
    central.push(cdh, name);

    offset += lfh.length + name.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}
