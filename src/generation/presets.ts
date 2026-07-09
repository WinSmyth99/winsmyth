// Fallback presets — ported verbatim from v19. Used when the
// generation API is unreachable or fails; also the seed catalogue for
// the session-only demo.

import { SpecialSymbol, SymbolDef } from '../engine/types';

export interface PresetDef {
  match: RegExp;
  name: string;
  tagline: string;
  color: string;
  themeStyle: string;
  symbols: SymbolDef[];
  wildSymbol: SpecialSymbol;
  bonusSymbol: SpecialSymbol;
}

export const FALLBACK_PRESETS: PresetDef[] = [
  {
    match: /pirate|sea|ocean|fish|nautical|sail|ship|treasure|kraken|naval|marin/i,
    name: 'Pirate\'s Bounty', tagline: 'Plunder the seven seas', color: '#4a9eff', themeStyle: 'nautical',
    symbols: [
      {emoji:'🐟',name:'Fish',multiplier:5,tier:'low'},
      {emoji:'🦀',name:'Crab',multiplier:8,tier:'low'},
      {emoji:'⚓',name:'Anchor',multiplier:12,tier:'low'},
      {emoji:'🧭',name:'Compass',multiplier:20,tier:'mid'},
      {emoji:'🦜',name:'Parrot',multiplier:35,tier:'mid'},
      {emoji:'☠️',name:'Skull',multiplier:60,tier:'mid'},
      {emoji:'💰',name:'Treasure',multiplier:120,tier:'premium'},
      {emoji:'🏴‍☠️',name:'Jolly Roger',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'⚔️',name:'Cutlass Wild'}, bonusSymbol:{emoji:'🗺️',name:'Treasure Map'},
  },
  {
    match: /egypt|pharaoh|pyramid|ankh|scarab|desert|sphinx|cleopatra|nile|sand|tomb|mummy/i,
    name: 'Pharaoh\'s Gold', tagline: 'Secrets of the ancient sands', color: '#e8b020', themeStyle: 'egyptian',
    symbols: [
      {emoji:'🪲',name:'Scarab',multiplier:5,tier:'low'},
      {emoji:'🐍',name:'Cobra',multiplier:8,tier:'low'},
      {emoji:'👁️',name:'Eye of Horus',multiplier:12,tier:'low'},
      {emoji:'🏺',name:'Urn',multiplier:20,tier:'mid'},
      {emoji:'🐪',name:'Camel',multiplier:35,tier:'mid'},
      {emoji:'🔺',name:'Pyramid',multiplier:60,tier:'mid'},
      {emoji:'👑',name:'Pharaoh',multiplier:120,tier:'premium'},
      {emoji:'☥',name:'Ankh',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'🌅',name:'Sun God Wild'}, bonusSymbol:{emoji:'📜',name:'Scroll Scatter'},
  },
  {
    match: /space|galaxy|cosmic|star|planet|alien|rocket|astronaut|sci-?fi|nebula|asteroid|orbit|mars|lunar|cosmos/i,
    name: 'Cosmic Fortune', tagline: 'Riches among the stars', color: '#a78bfa', themeStyle: 'space',
    symbols: [
      {emoji:'⭐',name:'Star',multiplier:5,tier:'low'},
      {emoji:'☄️',name:'Comet',multiplier:8,tier:'low'},
      {emoji:'🌙',name:'Moon',multiplier:12,tier:'low'},
      {emoji:'🛰️',name:'Satellite',multiplier:20,tier:'mid'},
      {emoji:'🪐',name:'Planet',multiplier:35,tier:'mid'},
      {emoji:'👽',name:'Alien',multiplier:60,tier:'mid'},
      {emoji:'🚀',name:'Rocket',multiplier:120,tier:'premium'},
      {emoji:'🛸',name:'UFO',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'💫',name:'Supernova Wild'}, bonusSymbol:{emoji:'🌌',name:'Galaxy Scatter'},
  },
  {
    match: /wizard|magic|mystic|fantasy|spell|potion|sorcer|witch|enchant|arcane|rune|crystal|fairy|elf/i,
    name: 'Arcane Riches', tagline: 'Spells of fortune await', color: '#c878ff', themeStyle: 'wizard',
    symbols: [
      {emoji:'🍄',name:'Toadstool',multiplier:5,tier:'low'},
      {emoji:'🕯️',name:'Candle',multiplier:8,tier:'low'},
      {emoji:'📕',name:'Spellbook',multiplier:12,tier:'low'},
      {emoji:'🧪',name:'Potion',multiplier:20,tier:'mid'},
      {emoji:'🦉',name:'Owl',multiplier:35,tier:'mid'},
      {emoji:'🔮',name:'Crystal Ball',multiplier:60,tier:'mid'},
      {emoji:'🧙',name:'Wizard',multiplier:120,tier:'premium'},
      {emoji:'🐉',name:'Dragon',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'✨',name:'Spark Wild'}, bonusSymbol:{emoji:'⭐',name:'Star Scatter'},
  },
  {
    match: /food|pizza|italian|kitchen|cook|chef|taco|mexic|fiesta|burger|sushi|restaurant|cuisine|dinner/i,
    name: 'Feast Frenzy', tagline: 'A buffet of big wins', color: '#fb923c', themeStyle: 'vegas',
    symbols: [
      {emoji:'🍅',name:'Tomato',multiplier:5,tier:'low'},
      {emoji:'🧀',name:'Cheese',multiplier:8,tier:'low'},
      {emoji:'🌶️',name:'Pepper',multiplier:12,tier:'low'},
      {emoji:'🍝',name:'Pasta',multiplier:20,tier:'mid'},
      {emoji:'🍕',name:'Pizza',multiplier:35,tier:'mid'},
      {emoji:'🍔',name:'Burger',multiplier:60,tier:'mid'},
      {emoji:'👨‍🍳',name:'Chef',multiplier:120,tier:'premium'},
      {emoji:'🔪',name:'Golden Knife',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'⭐',name:'Star Chef Wild'}, bonusSymbol:{emoji:'🔔',name:'Order Bell'},
  },
  {
    match: /safari|jungle|animal|lion|africa|wild|savanna|elephant|zebra|tiger|jungle/i,
    name: 'Savanna Spirits', tagline: 'Wild riches roam free', color: '#f59e0b', themeStyle: 'default',
    symbols: [
      {emoji:'🦓',name:'Zebra',multiplier:5,tier:'low'},
      {emoji:'🦒',name:'Giraffe',multiplier:8,tier:'low'},
      {emoji:'🐘',name:'Elephant',multiplier:12,tier:'low'},
      {emoji:'🦏',name:'Rhino',multiplier:20,tier:'mid'},
      {emoji:'🦛',name:'Hippo',multiplier:35,tier:'mid'},
      {emoji:'🐆',name:'Leopard',multiplier:60,tier:'mid'},
      {emoji:'🦁',name:'Lion',multiplier:120,tier:'premium'},
      {emoji:'🌅',name:'Golden Sun',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'🌳',name:'Baobab Wild'}, bonusSymbol:{emoji:'🥁',name:'Drum Scatter'},
  },
  {
    match: /dragon|china|chinese|jade|dynasty|asian|orient|lantern|emperor|imperial/i,
    name: 'Jade Dynasty', tagline: 'Fortune of the emperors', color: '#ef4444', themeStyle: 'wizard',
    symbols: [
      {emoji:'🏮',name:'Lantern',multiplier:5,tier:'low'},
      {emoji:'🎋',name:'Bamboo',multiplier:8,tier:'low'},
      {emoji:'🀄',name:'Tile',multiplier:12,tier:'low'},
      {emoji:'🐠',name:'Koi',multiplier:20,tier:'mid'},
      {emoji:'🧧',name:'Red Envelope',multiplier:35,tier:'mid'},
      {emoji:'⛩️',name:'Temple',multiplier:60,tier:'mid'},
      {emoji:'🐉',name:'Jade Dragon',multiplier:120,tier:'premium'},
      {emoji:'💰',name:'Gold Ingot',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'☯️',name:'Yin Yang Wild'}, bonusSymbol:{emoji:'🪙',name:'Coin Scatter'},
  },
  {
    match: /luxury|diamond|monaco|vip|rich|gold|gem|jewel|platinum|champagne|high.?roller/i,
    name: 'Diamond Deluxe', tagline: 'Where high rollers play', color: '#22d3ee', themeStyle: 'vegas',
    symbols: [
      {emoji:'🍸',name:'Cocktail',multiplier:5,tier:'low'},
      {emoji:'🎩',name:'Top Hat',multiplier:8,tier:'low'},
      {emoji:'🃏',name:'Card',multiplier:12,tier:'low'},
      {emoji:'🥂',name:'Champagne',multiplier:20,tier:'mid'},
      {emoji:'⌚',name:'Watch',multiplier:35,tier:'mid'},
      {emoji:'💍',name:'Ring',multiplier:60,tier:'mid'},
      {emoji:'💎',name:'Diamond',multiplier:120,tier:'premium'},
      {emoji:'👑',name:'Crown',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'⭐',name:'VIP Wild'}, bonusSymbol:{emoji:'🎰',name:'Jackpot Scatter'},
  },
  {
    match: /rock|music|concert|guitar|band|festival|punk|metal|neon|disco|dance/i,
    name: 'Rock Legends', tagline: 'Turn it up to eleven', color: '#f472b6', themeStyle: 'default',
    symbols: [
      {emoji:'🎵',name:'Note',multiplier:5,tier:'low'},
      {emoji:'💿',name:'Vinyl',multiplier:8,tier:'low'},
      {emoji:'🥁',name:'Drums',multiplier:12,tier:'low'},
      {emoji:'🎤',name:'Mic',multiplier:20,tier:'mid'},
      {emoji:'🎸',name:'Guitar',multiplier:35,tier:'mid'},
      {emoji:'🎹',name:'Keys',multiplier:60,tier:'mid'},
      {emoji:'⭐',name:'Star',multiplier:120,tier:'premium'},
      {emoji:'🏆',name:'Golden Mic',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'⚡',name:'Amp Wild'}, bonusSymbol:{emoji:'🎫',name:'Ticket Scatter'},
  },
  {
    match: /viking|norse|fjord|thor|odin|raven|rune|valhalla|warrior|battle/i,
    name: 'Valhalla Rising', tagline: 'Glory of the north', color: '#60a5fa', themeStyle: 'default',
    symbols: [
      {emoji:'🪓',name:'Axe',multiplier:5,tier:'low'},
      {emoji:'🛡️',name:'Shield',multiplier:8,tier:'low'},
      {emoji:'⚔️',name:'Swords',multiplier:12,tier:'low'},
      {emoji:'🐺',name:'Wolf',multiplier:20,tier:'mid'},
      {emoji:'🦅',name:'Raven',multiplier:35,tier:'mid'},
      {emoji:'⛵',name:'Longship',multiplier:60,tier:'mid'},
      {emoji:'⚡',name:'Thor\'s Hammer',multiplier:120,tier:'premium'},
      {emoji:'👑',name:'Odin',multiplier:300,tier:'premium'},
    ],
    wildSymbol:{emoji:'🌟',name:'Rune Wild'}, bonusSymbol:{emoji:'🏔️',name:'Mountain Scatter'},
  },
];

export function fallbackFor(prompt: string): PresetDef {
  const hit = FALLBACK_PRESETS.find((p) => p.match.test(prompt));
  if (hit) return hit;
  const idx = [...prompt].reduce((a, ch) => a + ch.charCodeAt(0), 0) % FALLBACK_PRESETS.length;
  return FALLBACK_PRESETS[idx];
}
