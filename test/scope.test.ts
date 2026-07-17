import { describe, expect, it } from 'vitest';
import type { EntryWithStatus, Obtainability } from '../src/types.js';
import { GENDER_PREFS, GOAL_SCOPES, isRegionalForm, parseGenderPref, parseGoalScope, scopeEntries, slotEntries } from '../src/planner/scope.js';

const VIS_DIFF: Obtainability = {
  availability: [], gmaxCapable: false, teraAvailable: false, catchableOnSwitch: false,
  shinyLegalSomewhere: true, unobtainableLegit: false, genderVisualDiff: true, shinyLockedIn: [], originGames: [],
};

function entry(dex: number, formSlug: string, gender: string, caught = false, visualDiff = false): EntryWithStatus {
  const entryKey = `${String(dex).padStart(4, '0')}-${formSlug}-${gender}`;
  return {
    entryKey, dex, name: `mon${dex}`, formSlug, formLabel: formSlug === 'default' ? null : formSlug,
    gender: gender as EntryWithStatus['gender'], types: ['normal'], generation: 1, spriteUrl: '', isCosmetic: false,
    status: caught ? { entryKey, caught: true, caughtAt: null, gameOrigin: null, method: null, notes: null } : null,
    specimen: null, obtainability: visualDiff ? VIS_DIFF : null,
  };
}
const keys = (s: { entries: EntryWithStatus[] }) => s.entries.map((e) => e.entryKey);

// Species 1: default male+female + a cosmetic form. Species 2: default + Alolan form.
const SLOTS = [
  entry(1, 'default', 'male'),
  entry(1, 'default', 'female'),
  entry(1, 'fancy', 'male'), // cosmetic/other form — only counts in `all`
  entry(2, 'default', 'male'),
  entry(2, 'alola', 'male'),
];

describe('isRegionalForm', () => {
  it('detects regional segments in underscore slugs', () => {
    expect(isRegionalForm('alola')).toBe(true);
    expect(isRegionalForm('galarian_standard')).toBe(true);
    expect(isRegionalForm('hisui')).toBe(true);
    expect(isRegionalForm('default')).toBe(false);
    expect(isRegionalForm('mega_x')).toBe(false);
  });
});

describe('scopeEntries', () => {
  it('species: one representative per dex, regional slots excluded', () => {
    expect(keys(scopeEntries(SLOTS, 'species'))).toEqual(['0001-default-male', '0002-default-male']);
  });

  it('species: a caught slot represents its species (never asks to re-catch)', () => {
    const slots = [entry(1, 'default', 'male'), entry(1, 'default', 'female', true)];
    const scoped = scopeEntries(slots, 'species');
    expect(keys(scoped)).toEqual(['0001-default-female']);
    expect(scoped.entries[0]!.status?.caught).toBe(true);
  });

  it('species-regional: adds one group per regional form', () => {
    expect(keys(scopeEntries(SLOTS, 'species-regional'))).toEqual(
      ['0001-default-male', '0002-alola-male', '0002-default-male']);
  });

  it('all: every slot, untouched', () => {
    expect(scopeEntries(SLOTS, 'all').entries).toBe(SLOTS);
  });

  it('phased: phase 1 is species until every species group is caught', () => {
    const scoped = scopeEntries(SLOTS, 'phased');
    expect(scoped.phase).toEqual({ n: 1, of: 3, label: 'Species', caught: 0, total: 2 });
    expect(keys(scoped)).toEqual(['0001-default-male', '0002-default-male']);
  });

  it('phased: phase 2 (regional) once species are done, phase 3 (everything) after that', () => {
    const speciesDone = [
      entry(1, 'default', 'male', true), entry(1, 'default', 'female'), entry(1, 'fancy', 'male'),
      entry(2, 'default', 'male', true), entry(2, 'alola', 'male'),
    ];
    const p2 = scopeEntries(speciesDone, 'phased');
    expect(p2.phase).toMatchObject({ n: 2, label: 'Regional forms', caught: 2, total: 3 });

    const regionalDone = speciesDone.map((e) => e.entryKey === '0002-alola-male' ? entry(2, 'alola', 'male', true) : e);
    const p3 = scopeEntries(regionalDone, 'phased');
    expect(p3.phase).toMatchObject({ n: 3, label: 'Every form & gender', caught: 3, total: 5 });
    expect(p3.entries).toHaveLength(5);
  });
});

describe('gender preference (slotEntries / scopeEntries)', () => {
  // Species 3: dual-gender, NOT visually dimorphic. Species 4: dual-gender,
  // visually dimorphic. Species 5: genderless.
  const GSLOTS = [
    entry(3, 'default', 'male'), entry(3, 'default', 'female'),
    entry(4, 'default', 'male', false, true), entry(4, 'default', 'female', false, true),
    entry(5, 'default', 'genderless'),
  ];

  it('distinct collapses non-dimorphic pairs, keeps dimorphic + genderless slots', () => {
    expect(slotEntries(GSLOTS, 'distinct').map((e) => e.entryKey)).toEqual([
      '0003-default-male', '0004-default-female', '0004-default-male', '0005-default-genderless',
    ]);
    expect(slotEntries(GSLOTS, 'all')).toBe(GSLOTS);
  });

  it('a caught slot represents its collapsed pair (caught-any)', () => {
    const slots = [entry(3, 'default', 'male'), entry(3, 'default', 'female', true)];
    const out = slotEntries(slots, 'distinct');
    expect(out.map((e) => e.entryKey)).toEqual(['0003-default-female']);
    expect(out[0]!.status?.caught).toBe(true);
  });

  it('gender preference shapes the all scope and the phased final phase', () => {
    const all = scopeEntries(GSLOTS, 'all', 'distinct');
    expect(all.entries).toHaveLength(4);

    // species done → phased lands on phase 3, whose universe honours the pref.
    const done = GSLOTS.map((e) => ({ ...e, status: { entryKey: e.entryKey, caught: true, caughtAt: null, gameOrigin: null, method: null, notes: null } }));
    const p3 = scopeEntries(done, 'phased', 'distinct');
    expect(p3.phase).toMatchObject({ n: 3, caught: 4, total: 4 });
    expect(scopeEntries(done, 'phased', 'all').phase).toMatchObject({ n: 3, caught: 5, total: 5 });
  });

  it('species scope is unaffected by the gender preference', () => {
    expect(scopeEntries(GSLOTS, 'species', 'distinct').entries).toHaveLength(3);
    expect(scopeEntries(GSLOTS, 'species', 'all').entries).toHaveLength(3);
  });
});

describe('parseGoalScope / parseGenderPref', () => {
  it('accepts every scope, falls back when absent, rejects junk', () => {
    for (const s of GOAL_SCOPES) expect(parseGoalScope(s, 'all')).toBe(s);
    expect(parseGoalScope(undefined, 'all')).toBe('all');
    expect(parseGoalScope('', 'phased')).toBe('phased');
    expect(parseGoalScope('everything', 'all')).toBeNull();
  });
  it('gender pref parses the same way', () => {
    for (const g of GENDER_PREFS) expect(parseGenderPref(g, 'all')).toBe(g);
    expect(parseGenderPref(undefined, 'all')).toBe('all');
    expect(parseGenderPref('females-first', 'all')).toBeNull();
  });
});
