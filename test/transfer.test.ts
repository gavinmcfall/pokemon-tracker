import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/obtainability/games.js';
import { TRANSFER_BY_GAME, transferFor, type HomeReach } from '../src/obtainability/transfer.js';

describe('transfer topology', () => {
  it('covers every canonical game group', () => {
    for (const g of GAMES) {
      expect(TRANSFER_BY_GAME[g.gameId], `missing transfer info for ${g.gameId}`).toBeDefined();
    }
  });

  it('each entry is internally consistent with its reach', () => {
    for (const info of Object.values(TRANSFER_BY_GAME)) {
      expect(info.gameId).toBeTruthy();
      switch (info.reach as HomeReach) {
        case 'native':
        case 'go':
          expect(info.directToHome).toBe(true);
          expect(info.requiresBank).toBe(false);
          expect(info.requiresGames).toEqual([]);
          expect(info.possible).toBe(true);
          break;
        case 'bank':
          expect(info.directToHome).toBe(false);
          expect(info.requiresBank).toBe(true);
          expect(info.requiresGames).toEqual([]); // no other game needed to reach Bank
          expect(info.possible).toBe(true);
          break;
        case 'chain':
          expect(info.directToHome).toBe(false);
          expect(info.requiresBank).toBe(true);
          expect(info.requiresGames.length).toBeGreaterThan(0); // needs intermediate games
          expect(info.possible).toBe(true);
          break;
        case 'none':
          expect(info.possible).toBe(false);
          break;
        case 'unknown':
          // Unreleased / unmapped — not asserted either way. Route may be blank.
          expect(info.directToHome).toBe(false);
          break;
      }
      // A known route must be spelled out; unknown/none may leave it blank.
      if (info.reach !== 'unknown' && info.reach !== 'none') {
        expect(info.route.length).toBeGreaterThan(0);
      }
    }
  });

  it('chain hops reference real game groups (AND-of-ORs)', () => {
    const known = new Set(GAMES.map((g) => g.gameId));
    for (const info of Object.values(TRANSFER_BY_GAME)) {
      for (const hop of info.requiresGames) {
        expect(hop.length).toBeGreaterThan(0);
        for (const gid of hop) expect(known.has(gid), `${info.gameId} requires unknown game ${gid}`).toBe(true);
      }
    }
  });

  it('the Switch line is HOME-native and the legacy line is not', () => {
    for (const id of ['lgpe', 'swsh', 'bdsp', 'pla', 'sv', 'za']) {
      expect(TRANSFER_BY_GAME[id]!.reach).toBe('native');
    }
    // Unreleased Gen 10 has no known HOME route yet.
    expect(TRANSFER_BY_GAME.ww!.reach).toBe('unknown');
    // Gen 3 needs a Gen 4 AND a Gen 5 game; Gen 4 needs a Gen 5 game.
    expect(TRANSFER_BY_GAME.e!.reach).toBe('chain');
    expect(TRANSFER_BY_GAME.e!.requiresGames).toEqual([['dp', 'pt', 'hgss'], ['bw', 'b2w2']]);
    expect(TRANSFER_BY_GAME.hgss!.requiresGames).toEqual([['bw', 'b2w2']]);
    // Gen 6/7 reach Bank directly; Gen 5 via Transporter — both 'bank', no intermediate games.
    expect(TRANSFER_BY_GAME.xy!.reach).toBe('bank');
    expect(TRANSFER_BY_GAME.bw!.reach).toBe('bank');
  });

  it('transferFor falls back to unknown (never a guess) for unmapped ids', () => {
    const info = transferFor('colosseum');
    expect(info.reach).toBe('unknown');
    expect(info.possible).toBe(true); // unknown is not "impossible"
  });
});
