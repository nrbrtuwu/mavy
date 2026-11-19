// In-process unzip, used when the server image has no unzip/bsdtar (e.g. Pelican's Bun image).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { extractZipInProcess } from '../src/gtfs/import.ts';

const tmp = mkdtempSync(join(tmpdir(), 'mavy-unzip-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A zip with the given entries: stored when method is 0, deflated when 8 (CRCs left at 0). */
function makeZip(entries: { name: string; data: string; method: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const body = e.method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe('extractZipInProcess', () => {
  test('extracts stored and deflated files, folders included', () => {
    const zip = join(tmp, 'feed.zip');
    writeFileSync(zip, makeZip([
      { name: 'stops.txt', data: 'stop_id,stop_name\nBPK,Budapest-Keleti\n', method: 8 },
      { name: 'gtfs/agency.txt', data: 'agency_id\nMAV\n', method: 0 },
    ]));
    const out = join(tmp, 'out');
    extractZipInProcess(zip, out);
    expect(readFileSync(join(out, 'stops.txt'), 'utf8')).toBe('stop_id,stop_name\nBPK,Budapest-Keleti\n');
    expect(readFileSync(join(out, 'gtfs', 'agency.txt'), 'utf8')).toBe('agency_id\nMAV\n');
  });

  test('refuses paths outside the target folder and files that are not zips', () => {
    const evil = join(tmp, 'evil.zip');
    writeFileSync(evil, makeZip([{ name: '../escaped.txt', data: 'x', method: 0 }]));
    expect(() => extractZipInProcess(evil, join(tmp, 'out2'))).toThrow(/unsafe path/);
    const notZip = join(tmp, 'not.zip');
    writeFileSync(notZip, 'hello');
    expect(() => extractZipInProcess(notZip, join(tmp, 'out3'))).toThrow(/not a zip/);
  });
});
