import { describe, expect, it } from 'vitest';
import { exportCsv, parseCsv, planImport, serializeCsv } from '../src/csv.js';
import type { EntryWithStatus, Gender } from '../src/types.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });
  it('handles quoted fields, escaped quotes, embedded commas and newlines', () => {
    expect(parseCsv('"a,b","say ""hi""","line1\nline2"')).toEqual([['a,b', 'say "hi"', 'line1\nline2']]);
  });
  it('handles CRLF and missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips through serializeCsv', () => {
    const rows = [['key', 'notes'], ['0006-mega_x-male', 'has "quotes", commas\nand newlines']];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
});

const catalogue: { entryKey: string; dex: number; formSlug: string; gender: Gender }[] = [
  { entryKey: '0006-default-male', dex: 6, formSlug: 'default', gender: 'male' },
  { entryKey: '0006-default-female', dex: 6, formSlug: 'default', gender: 'female' },
  { entryKey: '0006-mega_x-male', dex: 6, formSlug: 'mega_x', gender: 'male' },
  { entryKey: '0006-mega_x-female', dex: 6, formSlug: 'mega_x', gender: 'female' },
  { entryKey: '0150-default-genderless', dex: 150, formSlug: 'default', gender: 'genderless' },
];

describe('planImport', () => {
  it('matches by entryKey', () => {
    const plan = planImport('entryKey,caught\n0006-mega_x-male,true\n', catalogue);
    expect(plan.unmatched).toEqual([]);
    expect(plan.matchedRows).toBe(1);
    expect(plan.patches).toEqual([{ entryKey: '0006-mega_x-male', caught: true, line: 2 }]);
  });

  it('a flat dex row fans out to every matching form and gender slot', () => {
    const plan = planImport('dex,name,caught\n6,Charizard,yes\n', catalogue);
    expect(plan.matchedRows).toBe(1);
    expect(plan.patches.map((p) => p.entryKey).sort()).toEqual([
      '0006-default-female', '0006-default-male', '0006-mega_x-female', '0006-mega_x-male',
    ]);
  });

  it('narrows by form and gender columns when present', () => {
    const plan = planImport('dex,form,gender,caught\n6,mega-x,female,x\n', catalogue);
    expect(plan.patches).toEqual([{ entryKey: '0006-mega_x-female', caught: true, line: 2 }]);
  });

  it('reports unmatched rows instead of failing (spec §6)', () => {
    const plan = planImport(
      'entryKey,caught\n9999-nope-male,true\n0006-default-male,true\n',
      catalogue,
    );
    expect(plan.matchedRows).toBe(1);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0]).toMatchObject({ line: 2, reason: 'unknown entryKey "9999-nope-male"' });
  });

  it('reports bad caught values, dex numbers, genders and headers', () => {
    expect(planImport('dex,caught\n6,maybe\n', catalogue).unmatched[0]!.reason).toContain('unrecognized caught value');
    expect(planImport('dex,caught\nsix,true\n', catalogue).unmatched[0]!.reason).toContain('invalid dex');
    expect(planImport('dex,gender,caught\n6,attack helicopter,true\n', catalogue).unmatched[0]!.reason).toContain('unrecognized gender');
    expect(planImport('name,caught\nCharizard,true\n', catalogue).unmatched[0]!.reason).toContain('entryKey');
    expect(planImport('entryKey\n0006-default-male\n', catalogue).unmatched[0]!.reason).toContain('caught');
  });

  it('carries gameOrigin/method/notes onto the patch', () => {
    const plan = planImport(
      'entryKey,caught,game,method,notes\n0006-default-male,true,emu:HeartGold,bred,first shiny\n',
      catalogue,
    );
    expect(plan.patches[0]).toMatchObject({
      entryKey: '0006-default-male',
      caught: true,
      gameOrigin: 'emu:HeartGold',
      method: 'bred',
      notes: 'first shiny',
    });
  });

  it('accepts header aliases and separator variations', () => {
    const plan = planImport('National Dex,Owned\n150,✓\n', catalogue);
    expect(plan.patches).toEqual([{ entryKey: '0150-default-genderless', caught: true, line: 2 }]);
  });
});

describe('exportCsv → planImport round trip', () => {
  it('re-importing an export reproduces the same statuses', () => {
    const entries: EntryWithStatus[] = [
      {
        entryKey: '0006-mega_x-male', dex: 6, name: 'Charizard', formSlug: 'mega_x',
        formLabel: 'Mega Charizard X', gender: 'male', types: ['fire', 'dragon'],
        generation: 1, spriteUrl: 'https://example/6.png', isCosmetic: false,
        status: {
          entryKey: '0006-mega_x-male', caught: true, caughtAt: '2026-07-10T09:12:00.000Z',
          gameOrigin: 'emu:HeartGold', method: 'bred', notes: 'notes, with "commas"',
        },
      },
      {
        entryKey: '0150-default-genderless', dex: 150, name: 'Mewtwo', formSlug: 'default',
        formLabel: null, gender: 'genderless', types: ['psychic'],
        generation: 1, spriteUrl: 'https://example/150.png', isCosmetic: false, status: null,
      },
    ];
    const csv = exportCsv(entries);
    const plan = planImport(csv, catalogue.concat([{ entryKey: '0150-default-genderless', dex: 150, formSlug: 'default', gender: 'genderless' }]));
    expect(plan.unmatched).toEqual([]);
    expect(plan.matchedRows).toBe(2);
    const caughtPatch = plan.patches.find((p) => p.entryKey === '0006-mega_x-male')!;
    expect(caughtPatch).toMatchObject({
      caught: true, gameOrigin: 'emu:HeartGold', method: 'bred', notes: 'notes, with "commas"',
    });
    const uncaught = plan.patches.find((p) => p.entryKey === '0150-default-genderless')!;
    expect(uncaught.caught).toBe(false);
  });
});
