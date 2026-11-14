import { describe, expect, test } from 'bun:test';
import { mnrGlyph } from '../web/src/lib/mnr.ts';
import { shortTrainLabel } from '../web/src/lib/format.ts';

const glyph = (label: string) => mnrGlyph(shortTrainLabel(label))?.codePointAt(0);

describe('mnrGlyph', () => {
  test('kind logos and line badges from MNR2007', () => {
    expect(glyph('IC 562 TOKAJ')).toBe(0x1da);
    expect(glyph('rjx 62')).toBe(0x1e1);
    expect(glyph('Sz 359')).toBe(0x1e4);
    expect(glyph('EC 142 LISZT FERENC')).toBe(0x1d3);
    expect(glyph('IR85 MÁTRA')).toBe(0x21d);
    expect(glyph('S80')).toBe(0x16e);
    expect(glyph('S10')).toBe(0x14f);
    expect(glyph('Z60')).toBe(0x181);
    expect(glyph('G40')).toBe(0x18f);
  });

  test('codes the font does not have stay text badges', () => {
    for (const label of ['ICB 873 BALATON', 'VESz 5420', 'BESZ 6031', 'Pótló 5267', '39830']) {
      expect(mnrGlyph(shortTrainLabel(label))).toBeNull();
    }
  });
});
