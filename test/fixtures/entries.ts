import type { Entry } from '../../src/types.js';

/** Small deterministic catalogue shared by the store contract suite and the e2e harness. */
export const CONTRACT_ENTRIES: Entry[] = [
  {
    entryKey: '0006-default-male', dex: 6, name: 'Charizard', formSlug: 'default', formLabel: null,
    gender: 'male', types: ['fire', 'flying'], generation: 1,
    spriteUrl: 'https://sprites.example/6.png', isCosmetic: false,
  },
  {
    entryKey: '0006-mega_x-male', dex: 6, name: 'Charizard', formSlug: 'mega_x', formLabel: 'Mega Charizard X',
    gender: 'male', types: ['fire', 'dragon'], generation: 1,
    spriteUrl: 'https://sprites.example/10034.png', isCosmetic: false,
  },
  {
    entryKey: '0150-default-genderless', dex: 150, name: 'Mewtwo', formSlug: 'default', formLabel: null,
    gender: 'genderless', types: ['psychic'], generation: 1,
    spriteUrl: 'https://sprites.example/150.png', isCosmetic: false,
  },
  {
    entryKey: '0666-fancy-female', dex: 666, name: 'Vivillon', formSlug: 'fancy', formLabel: 'Fancy Vivillon',
    gender: 'female', types: ['bug', 'flying'], generation: 6,
    spriteUrl: 'https://sprites.example/666-fancy.png', isCosmetic: true,
  },
];
