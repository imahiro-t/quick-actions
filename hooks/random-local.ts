// The standalone local actions that make something at random: IDs (uuid,
// ulid, nanoid), secrets (password, passphrase, random-token), draws (dice,
// coin-flip, random-number, pick-one, shuffle), random-color, dummy text
// (lorem, dummy-ja) and break-idea. Their word lists live here, in the source;
// nothing is fetched.
//
// Synchronous and pure, as LocalAction asks: ECMAScript's built-ins alone. All
// randomness comes from `input.randomBytes` and the time from `input.now`;
// nothing here reads the system's randomness or clock itself, so a test
// fixes both. A choice among n is made by rejection (uniformInt), so it leans to no
// value.
//
// Each takes its argument as register.tsx parsed it (./args); one of another
// type or out of its range is answered with `{ error }`, never put back to the
// default.

import type { LocalInput, LocalOutput } from './actions'
import { base64Encode, toHex } from './codec'
import type { Lang } from './i18n'
import { INT_TEXT, invalid, isInt, textOf } from './local-args'
import { rgbToHsl } from './selection-local'

// ---------------------------------------------------------------------------
// Choices without a lean.

/** How many times uniformInt draws again before it settles for a remainder. */
export const UNIFORM_RETRIES = 64

/**
 * A whole number from 0 to n - 1 (n from 1 to 2^32), equally likely each: as
 * few bytes as cover n are read as one number, and one at or past the last
 * whole multiple of n is drawn again. After UNIFORM_RETRIES draws it takes the
 * last one's remainder instead, so bytes that are always rejected (a test's
 * constant ones) still end; with real randomness that is next to never reached.
 */
export function uniformInt(n: number, randomBytes: (n: number) => Uint8Array): number {
  if (!(n > 1)) return 0
  let k = 1
  while (256 ** k < n) k++
  const range = 256 ** k
  const limit = Math.floor(range / n) * n
  let v = 0
  for (let attempt = 0; attempt <= UNIFORM_RETRIES; attempt++) {
    const bytes = randomBytes(k)
    v = 0
    for (let i = 0; i < k; i++) v = v * 256 + (bytes[i] ?? 0)
    if (v < limit) return v % n
  }
  return v % n
}

/** `items` put in a random order (Fisher–Yates), in place. */
export function shuffleInPlace<T>(items: T[], randomBytes: (n: number) => Uint8Array): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = uniformInt(i + 1, randomBytes)
    const t = items[i]!
    items[i] = items[j]!
    items[j] = t
  }
  return items
}

/** One of `items` (not empty), at random. */
export const pickOne = <T>(items: readonly T[], randomBytes: (n: number) => Uint8Array): T => items[uniformInt(items.length, randomBytes)]!

/** Candidates written in a text: split at commas (`,` `、` `，`) and spaces (a full-width one too), the empty ones dropped. */
export const splitCandidates = (text: string): string[] => text.split(/[,、，\s　]+/).filter(s => s !== '')

/** The most candidates pick-one and shuffle take. */
export const CANDIDATES_MAX = 100

const ID_COUNT = 5

// ---------------------------------------------------------------------------
// IDs.

/** A UUID's 16 bytes written 8-4-4-4-12 in lowercase. */
export const formatUuid = (b: Uint8Array) =>
  `${toHex(b.subarray(0, 4))}-${toHex(b.subarray(4, 6))}-${toHex(b.subarray(6, 8))}-${toHex(b.subarray(8, 10))}-${toHex(b.subarray(10, 16))}`

/** 48 bits of a time in ms, the most significant byte first. */
function timeBytes(ms: number): number[] {
  let t = Math.max(0, Math.floor(ms)) % 2 ** 48
  const out = new Array<number>(6)
  for (let i = 5; i >= 0; i--) {
    out[i] = t % 256
    t = Math.floor(t / 256)
  }
  return out
}

/** One UUID: version 4 (random) or 7 (the time in ms, then random), variant 10. */
export function makeUuid(version: 'v4' | 'v7', now: number, randomBytes: (n: number) => Uint8Array): string {
  const b = Uint8Array.from(randomBytes(16))
  if (version === 'v7') timeBytes(now).forEach((v, i) => (b[i] = v))
  b[6] = (b[6]! & 0x0f) | (version === 'v7' ? 0x70 : 0x40)
  b[8] = (b[8]! & 0x3f) | 0x80
  return formatUuid(b)
}

/** Five UUIDs, a line each: v4 (random) by default, v7 (time and random). */
export const uuid = ({ arg, now, lang, randomBytes }: LocalInput): LocalOutput => {
  if (arg !== 'v4' && arg !== 'v7') return invalid(lang, { ja: 'v4 か v7', en: 'v4 or v7' })
  return { text: Array.from({ length: ID_COUNT }, () => makeUuid(arg, now, randomBytes)).join('\n') }
}

/** Crockford's Base32: no I, L, O or U. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** One ULID: 10 characters of the time in ms (48 bits), then 16 of 80 random bits. */
export function makeUlid(now: number, randomBytes: (n: number) => Uint8Array): string {
  let t = Math.max(0, Math.floor(now)) % 2 ** 48
  let time = ''
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time
    t = Math.floor(t / 32)
  }
  const bytes = randomBytes(10)
  let rand = ''
  // Five bytes (40 bits) at a time make eight characters: within a double's exact range.
  for (let g = 0; g < 2; g++) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * 256 + (bytes[g * 5 + i] ?? 0)
    let part = ''
    for (let i = 0; i < 8; i++) {
      part = CROCKFORD[v % 32]! + part
      v = Math.floor(v / 32)
    }
    rand += part
  }
  return time + rand
}

/** Five ULIDs, a line each. */
export const ulid = ({ now, randomBytes }: LocalInput): LocalOutput => ({
  text: Array.from({ length: ID_COUNT }, () => makeUlid(now, randomBytes)).join('\n'),
})

/** Nano ID's alphabet: 64 URL-safe characters, so `byte & 63` picks one without a lean. */
export const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/** Five random IDs of URL-safe characters, 21 long by default. */
export const nanoid = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 4, 64)) return invalid(lang, INT_TEXT(4, 64))
  const one = () => Array.from(randomBytes(arg), b => NANOID_ALPHABET[b & 63]!).join('')
  return { text: Array.from({ length: ID_COUNT }, one).join('\n') }
}

// ---------------------------------------------------------------------------
// Secrets.

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const DIGITS = '0123456789'
export const SYMBOLS = '!#$%&*+-=?@^_~'
export const PASSWORD_CHARS = UPPER + LOWER + DIGITS + SYMBOLS

/** Each kind of password character, and all of them, as arrays made once for pickOne. */
const PASSWORD_KINDS: readonly (readonly string[])[] = [UPPER, LOWER, DIGITS, SYMBOLS].map(set => [...set])
const PASSWORD_CHAR_LIST: readonly string[] = [...PASSWORD_CHARS]

const SECRET_COUNT = 3

/** Bits written with one decimal. */
const bits = (n: number) => n.toFixed(1)

/** One password of `length` (4 at least): one character of each kind, the rest of any, in a random order. */
export function makePassword(length: number, randomBytes: (n: number) => Uint8Array): string {
  const chars = PASSWORD_KINDS.map(kind => pickOne(kind, randomBytes))
  for (let i = chars.length; i < length; i++) chars.push(pickOne(PASSWORD_CHAR_LIST, randomBytes))
  return shuffleInPlace(chars, randomBytes).join('')
}

/** The estimated entropy of a password of `length`: length × log2 of the characters it is drawn from. */
export const passwordEntropy = (length: number) => length * Math.log2(PASSWORD_CHARS.length)

/** Three passwords with every kind of character, 20 long by default, and their estimated entropy. */
export const password = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 8, 128)) return invalid(lang, INT_TEXT(8, 128))
  const list = Array.from({ length: SECRET_COUNT }, () => makePassword(arg, randomBytes))
  const e = bits(passwordEntropy(arg))
  const n = PASSWORD_CHARS.length
  const note =
    lang === 'ja'
      ? `推定エントロピー: 約 ${e} ビット（${arg} 文字 × log2(${n})。各種 1 文字以上の制約は考慮しない概算）`
      : `Estimated entropy: about ${e} bits (${arg} characters × log2(${n}); a rough figure that ignores the one-of-each rule)`
  return { text: [...list, '', note].join('\n') }
}

/** The words a passphrase is made of: 1024 (10 bits each), lowercase, 3 to 8 letters, none twice. */
export const PASSPHRASE_WORDS: readonly string[] = [
  'able', 'acid', 'acorn', 'actor', 'admit', 'adult', 'advice', 'after', 'agent', 'agree', 'aim', 'air',
  'airport', 'aisle', 'album', 'alert', 'alien', 'allow', 'almond', 'alone', 'amber', 'amount', 'amuse', 'angle',
  'animal', 'ankle', 'answer', 'apart', 'apple', 'april', 'arch', 'arctic', 'arena', 'arm', 'arrow', 'art',
  'artist', 'aspect', 'atlas', 'atom', 'audio', 'august', 'aunt', 'avocado', 'awake', 'award', 'baby', 'bacon',
  'badge', 'bag', 'balance', 'ball', 'bamboo', 'band', 'bank', 'barn', 'base', 'basil', 'basket', 'bath', 'beam',
  'bean', 'bear', 'beast', 'beauty', 'bed', 'bell', 'belt', 'bench', 'bicycle', 'bike', 'bird', 'birth', 'blade',
  'blank', 'blanket', 'blend', 'bless', 'block', 'bloom', 'blossom', 'blue', 'blush', 'boat', 'body', 'boil',
  'bone', 'bonus', 'book', 'boot', 'border', 'borrow', 'bottle', 'bottom', 'bounce', 'bowl', 'boxer', 'brain',
  'branch', 'bread', 'break', 'breeze', 'bridge', 'brief', 'bright', 'bring', 'bronze', 'brook', 'broom',
  'brown', 'brush', 'bubble', 'budget', 'buffalo', 'build', 'bundle', 'bunny', 'burger', 'burst', 'bush',
  'butter', 'button', 'cabin', 'cable', 'cactus', 'cake', 'calm', 'camel', 'camp', 'canal', 'candle', 'candy',
  'canvas', 'canyon', 'cape', 'car', 'carbon', 'card', 'carpet', 'carrot', 'cart', 'case', 'castle', 'cat',
  'catch', 'cause', 'cave', 'cedar', 'celery', 'cell', 'cement', 'cereal', 'chain', 'chair', 'chalk', 'change',
  'chapter', 'charge', 'chase', 'cheap', 'check', 'cheese', 'chef', 'cherry', 'chess', 'chicken', 'chief',
  'child', 'chin', 'choice', 'chorus', 'cinema', 'circle', 'citizen', 'civil', 'claim', 'clap', 'class', 'clean',
  'clerk', 'clever', 'cliff', 'climb', 'clinic', 'close', 'cloth', 'cloud', 'clown', 'clue', 'coach', 'coal',
  'coat', 'cobalt', 'cocoa', 'code', 'coffee', 'coil', 'cold', 'collar', 'colony', 'color', 'comb', 'comet',
  'comic', 'copper', 'coral', 'corn', 'cotton', 'couch', 'cougar', 'count', 'couple', 'course', 'cousin',
  'coyote', 'crab', 'cradle', 'crane', 'crater', 'crayon', 'credit', 'creek', 'crew', 'cricket', 'crop', 'cross',
  'crowd', 'cruise', 'crumb', 'crystal', 'cup', 'curry', 'curtain', 'curve', 'custom', 'cycle', 'daisy', 'dark',
  'dash', 'data', 'dawn', 'day', 'deal', 'decade', 'deer', 'degree', 'delta', 'dense', 'depth', 'desert', 'desk',
  'detail', 'device', 'diary', 'diesel', 'digit', 'dish', 'distant', 'diver', 'dock', 'dog', 'dollar', 'dolphin',
  'donkey', 'door', 'double', 'dove', 'dozen', 'dragon', 'drama', 'dream', 'dress', 'drift', 'drink', 'drive',
  'drum', 'dune', 'dust', 'duty', 'eagle', 'early', 'earth', 'easel', 'easy', 'echo', 'eclipse', 'effort', 'egg',
  'eight', 'elder', 'eleven', 'elk', 'elm', 'emerald', 'empire', 'empty', 'energy', 'engine', 'enjoy', 'equal',
  'era', 'erase', 'essay', 'estate', 'ethics', 'even', 'event', 'exact', 'exit', 'extra', 'eye', 'fabric',
  'fact', 'factory', 'fade', 'falcon', 'family', 'fancy', 'farm', 'father', 'feast', 'feather', 'ferry',
  'festival', 'fiber', 'fig', 'figure', 'film', 'final', 'fire', 'firm', 'first', 'fitness', 'flag', 'flame',
  'flat', 'flavor', 'fleet', 'flight', 'flock', 'floor', 'flour', 'fluid', 'flute', 'foam', 'fog', 'folk',
  'food', 'forest', 'fork', 'fort', 'fossil', 'frame', 'fresh', 'friend', 'frost', 'fruit', 'fuel', 'future',
  'gadget', 'galaxy', 'gallery', 'garage', 'garden', 'garlic', 'gather', 'gauge', 'gear', 'gem', 'genius',
  'gentle', 'giant', 'gift', 'ginger', 'giraffe', 'glass', 'globe', 'glove', 'glue', 'goat', 'gold', 'good',
  'goose', 'gorilla', 'grape', 'graph', 'grass', 'gravel', 'great', 'green', 'grid', 'grocery', 'group', 'grove',
  'guess', 'guide', 'guitar', 'gym', 'hair', 'half', 'hall', 'hand', 'happy', 'harbor', 'harvest', 'hat', 'hawk',
  'head', 'health', 'heart', 'heat', 'hedge', 'height', 'helmet', 'hidden', 'high', 'hill', 'history', 'hobby',
  'hockey', 'hold', 'holiday', 'hollow', 'home', 'hood', 'hope', 'horizon', 'horse', 'hospital', 'host', 'hour',
  'house', 'hover', 'human', 'hurry', 'hut', 'ice', 'idea', 'igloo', 'image', 'inch', 'income', 'index',
  'indigo', 'ink', 'inner', 'input', 'inside', 'island', 'ivory', 'jacket', 'jaguar', 'jam', 'jazz', 'jeans',
  'jelly', 'jewel', 'join', 'joke', 'journey', 'juice', 'july', 'jump', 'junior', 'just', 'kangaroo', 'kayak',
  'kettle', 'key', 'kid', 'king', 'kingdom', 'kit', 'kite', 'kitten', 'kiwi', 'knife', 'knock', 'koala', 'lab',
  'ladder', 'lady', 'lake', 'lamp', 'land', 'lane', 'laptop', 'large', 'laser', 'later', 'laundry', 'lava',
  'lawn', 'leader', 'leaf', 'learn', 'lecture', 'left', 'legend', 'lens', 'leopard', 'lesson', 'letter',
  'liberty', 'library', 'license', 'lift', 'light', 'lilac', 'limb', 'lime', 'limit', 'lion', 'liquid', 'list',
  'little', 'llama', 'loan', 'lobster', 'lock', 'lodge', 'logic', 'loop', 'lotus', 'loud', 'lounge', 'loyal',
  'lucky', 'lumber', 'lunch', 'machine', 'magnet', 'major', 'mammal', 'mango', 'manual', 'maple', 'marble',
  'march', 'marine', 'market', 'marsh', 'mason', 'master', 'match', 'meadow', 'meat', 'medal', 'media', 'melon',
  'member', 'memory', 'menu', 'mercy', 'merit', 'metal', 'method', 'middle', 'milk', 'mill', 'mimic', 'mind',
  'mirror', 'mist', 'mixer', 'modern', 'moment', 'monkey', 'moon', 'moral', 'morning', 'mosaic', 'mother',
  'motion', 'motor', 'mouse', 'mouth', 'movie', 'mule', 'museum', 'music', 'myth', 'nail', 'name', 'napkin',
  'nation', 'nature', 'navy', 'neck', 'needle', 'neon', 'nerve', 'nest', 'net', 'network', 'never', 'news',
  'night', 'noise', 'noodle', 'normal', 'nose', 'note', 'novel', 'nurse', 'nut', 'oak', 'oasis', 'ocean',
  'october', 'odor', 'office', 'olive', 'omega', 'open', 'opera', 'orange', 'orbit', 'order', 'organ', 'orient',
  'ostrich', 'other', 'otter', 'oval', 'oven', 'owl', 'oxygen', 'oyster', 'paddle', 'page', 'palace', 'palm',
  'panda', 'paper', 'parade', 'parcel', 'park', 'parrot', 'party', 'patch', 'path', 'patrol', 'pattern', 'peace',
  'peach', 'peanut', 'pebble', 'pelican', 'pen', 'people', 'pepper', 'perfect', 'permit', 'pet', 'phone',
  'photo', 'picnic', 'picture', 'piece', 'pigeon', 'pilot', 'pine', 'pioneer', 'pipe', 'pitch', 'pizza',
  'planet', 'plant', 'plastic', 'play', 'plaza', 'pledge', 'plow', 'plum', 'pocket', 'poem', 'point', 'polar',
  'pole', 'pony', 'pool', 'popcorn', 'portal', 'possum', 'potato', 'powder', 'power', 'prairie', 'praise',
  'press', 'price', 'pride', 'print', 'prize', 'problem', 'profit', 'program', 'project', 'proof', 'public',
  'pudding', 'pulse', 'pupil', 'puppy', 'purple', 'pyramid', 'quail', 'quality', 'queen', 'quest', 'quick',
  'quiet', 'quiz', 'quote', 'rabbit', 'race', 'radar', 'radio', 'rain', 'rainbow', 'raise', 'rally', 'random',
  'range', 'rapid', 'razor', 'ready', 'real', 'rebel', 'recipe', 'record', 'region', 'relax', 'remote', 'rent',
  'report', 'rescue', 'result', 'reward', 'rhythm', 'rib', 'rice', 'rich', 'ride', 'ridge', 'ring', 'ripple',
  'risk', 'rival', 'river', 'road', 'robin', 'robot', 'rocket', 'roof', 'rookie', 'room', 'rope', 'rotate',
  'rough', 'round', 'royal', 'rubber', 'ruby', 'rule', 'runway', 'rural', 'safari', 'safe', 'sail', 'salad',
  'salon', 'salt', 'sample', 'satin', 'sauce', 'sausage', 'scarf', 'scene', 'school', 'science', 'scout',
  'screen', 'script', 'season', 'seat', 'second', 'seed', 'segment', 'select', 'sense', 'series', 'service',
  'session', 'seven', 'shadow', 'shark', 'shelf', 'shell', 'shield', 'shine', 'ship', 'shirt', 'shoe', 'shore',
  'short', 'shoulder', 'shrimp', 'sight', 'signal', 'silk', 'silver', 'simple', 'sister', 'six', 'skate',
  'sketch', 'skill', 'skin', 'skirt', 'slab', 'sleep', 'slice', 'slim', 'slogan', 'slot', 'slow', 'smart',
  'smile', 'smoke', 'snake', 'snow', 'soap', 'social', 'sock', 'soda', 'soft', 'solar', 'solid', 'song', 'soul',
  'sound', 'soup', 'south', 'space', 'spare', 'speak', 'speed', 'sphere', 'spice', 'spike', 'spin', 'spirit',
  'sponge', 'spoon', 'sport', 'spray', 'spring', 'spruce', 'squid', 'stable', 'stadium', 'staff', 'stairs',
  'stamp', 'stand', 'start', 'state', 'steak', 'steel', 'stem', 'step', 'stick', 'stool', 'storm', 'story',
  'straw', 'stream', 'street', 'strong', 'studio', 'style', 'suit', 'summer', 'summit', 'sun', 'super', 'supply',
  'surf', 'swamp', 'swan', 'sweet', 'swim', 'swing', 'symbol', 'system', 'table', 'tackle', 'tail', 'tank',
  'tape', 'target', 'taxi', 'tea', 'teach', 'tennis', 'tent', 'term', 'test', 'theme', 'theory', 'thunder',
  'tiger', 'timber', 'time', 'tissue', 'title', 'toast', 'toe', 'token', 'tomato', 'tongue', 'tooth', 'topic',
  'torch', 'tortoise', 'total', 'tower', 'toy', 'track', 'trade', 'traffic', 'train', 'travel', 'tray', 'tree',
  'trend', 'trial', 'trick', 'trip', 'trophy', 'trumpet', 'trust', 'truth', 'tube', 'tuna', 'tunnel', 'turkey',
  'tutor', 'twelve', 'twenty', 'type', 'umbrella', 'uncle', 'under', 'unit', 'universe', 'update', 'urban',
  'usage', 'useful', 'value', 'vanilla', 'vapor', 'vendor', 'venue', 'verb', 'vessel', 'video', 'view',
  'village', 'violet', 'violin', 'visa', 'visual', 'vital', 'vivid', 'vocal', 'volcano', 'volume', 'voyage',
  'waist', 'walk', 'wall', 'wander', 'warm', 'wash', 'water', 'wave', 'wealth', 'weather', 'wedding', 'west',
  'whale', 'wheel', 'whisper', 'white', 'width', 'wild', 'willow', 'wind', 'wing', 'winter', 'wire', 'wish',
  'wizard', 'wolf', 'wood', 'wool', 'word', 'world', 'wrist', 'writer', 'yacht', 'year', 'yellow', 'yoga',
  'youth', 'zebra', 'zero', 'zinc', 'zipper', 'zone',
]

/** The estimated entropy of a passphrase of `words` words: words × log2 of the list's length. */
export const passphraseEntropy = (words: number) => words * Math.log2(PASSPHRASE_WORDS.length)

/** Three passphrases of words from the built-in list joined by hyphens, 5 words by default, and their estimated entropy. */
export const passphrase = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 3, 10)) return invalid(lang, INT_TEXT(3, 10))
  const one = () => Array.from({ length: arg }, () => pickOne(PASSPHRASE_WORDS, randomBytes)).join('-')
  const list = Array.from({ length: SECRET_COUNT }, one)
  const e = bits(passphraseEntropy(arg))
  const n = PASSPHRASE_WORDS.length
  const note =
    lang === 'ja'
      ? `推定エントロピー: ${e} ビット（${arg} 語 × log2(${n})。組み込みの ${n} 語から選択）`
      : `Estimated entropy: ${e} bits (${arg} words × log2(${n}); drawn from the ${n} built-in words)`
  return { text: [...list, '', note].join('\n') }
}

/** Bytes as Base64URL: `-` and `_` for `+` and `/`, no padding. */
export const base64UrlEncode = (bytes: Uint8Array) => base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Random bytes, 32 by default, in hexadecimal and in Base64URL. */
export const randomToken = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 8, 256)) return invalid(lang, INT_TEXT(8, 256))
  const bytes = randomBytes(arg)
  return {
    text: [
      lang === 'ja' ? `${arg} バイトの乱数` : `${arg} random bytes`,
      '',
      lang === 'ja' ? '16 進:' : 'Hexadecimal:',
      toHex(bytes),
      '',
      'Base64URL:',
      base64UrlEncode(bytes),
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Draws.

export const DICE_LIMITS = { count: [1, 100], sides: [2, 1000], bonus: [0, 10000] } as const

const DICE_TEXT: Texts = {
  ja: 'NdM か NdM+K（例: 2d6+1。N は 1〜100、M は 2〜1000、K は 0〜10000）',
  en: 'NdM or NdM+K, e.g. 2d6+1 (N from 1 to 100, M from 2 to 1000, K from 0 to 10000)',
}

/** Dice written NdM or NdM+K, rolled: each die and the total. */
export const dice = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  const s = textOf(arg)
  const m = s === undefined ? null : /^(\d{1,3})d(\d{1,4})(?:\s*\+\s*(\d{1,5}))?$/i.exec(s)
  if (m === null) return invalid(lang, DICE_TEXT)
  const n = Number(m[1])
  const sides = Number(m[2])
  const bonus = m[3] === undefined ? 0 : Number(m[3])
  const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi
  if (!within(n, DICE_LIMITS.count) || !within(sides, DICE_LIMITS.sides) || !within(bonus, DICE_LIMITS.bonus)) return invalid(lang, DICE_TEXT)
  const rolls = Array.from({ length: n }, () => 1 + uniformInt(sides, randomBytes))
  const total = rolls.reduce((a, b) => a + b, 0) + bonus
  const name = `${n}d${sides}${m[3] === undefined ? '' : `+${bonus}`}`
  return {
    text: [
      `${name}: ${rolls.join(', ')}${m[3] === undefined ? '' : ` (+${bonus})`}`,
      lang === 'ja' ? `合計: ${total}` : `Total: ${total}`,
    ].join('\n'),
  }
}

/** A coin, flipped once. */
export const coinFlip = ({ lang, randomBytes }: LocalInput): LocalOutput => {
  const heads = ((randomBytes(1)[0] ?? 0) & 1) === 0
  return { text: lang === 'ja' ? (heads ? '表' : '裏') : heads ? 'Heads' : 'Tails' }
}

/** A whole number from 1 to N (100 by default), equally likely each. */
export const randomNumber = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 2, 1_000_000_000)) return invalid(lang, INT_TEXT(2, 1_000_000_000))
  const v = 1 + uniformInt(arg, randomBytes)
  return { text: [String(v), '', lang === 'ja' ? `（1〜${arg} から）` : `(from 1 to ${arg})`].join('\n') }
}

/**
 * The candidates in the argument: `{ ok: true, list }` (an empty list for no
 * argument), or `{ ok: false, out }` with the `{ error }` to answer when it is
 * no text, or a text with no candidate in it (separators alone), one alone or
 * too many.
 */
function candidatesOf(arg: unknown, lang: Lang): { ok: true; list: string[] } | { ok: false; out: LocalOutput } {
  const s = textOf(arg)
  if (s === undefined) return { ok: false, out: invalid(lang, { ja: 'カンマ・読点・空白で区切った候補', en: 'candidates separated by commas or spaces' }) }
  const list = splitCandidates(s)
  if ((s !== '' && list.length === 0) || list.length === 1 || list.length > CANDIDATES_MAX) {
    return {
      ok: false,
      out: invalid(lang, {
        ja: `2〜${CANDIDATES_MAX} 個の候補（カンマ・読点・空白で区切る）`,
        en: `2 to ${CANDIDATES_MAX} candidates, separated by commas or spaces`,
      }),
    }
  }
  return { ok: true, list }
}

/** One of the candidates in the argument at random, or yes or no with none. */
export const pickOneAction = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  const c = candidatesOf(arg, lang)
  if (!c.ok) return c.out
  const list = c.list.length > 0 ? c.list : lang === 'ja' ? ['はい', 'いいえ'] : ['Yes', 'No']
  const chosen = pickOne(list, randomBytes)
  return { text: [chosen, '', lang === 'ja' ? `（${list.length} 個の候補から）` : `(out of ${list.length} candidates)`].join('\n') }
}

/** The candidates in the argument (1 to 10 with none) in a random order, numbered. */
export const shuffle = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  const c = candidatesOf(arg, lang)
  if (!c.ok) return c.out
  const list = c.list.length > 0 ? [...c.list] : Array.from({ length: 10 }, (_, i) => String(i + 1))
  const width = String(list.length).length
  return { text: shuffleInPlace(list, randomBytes).map((s, i) => `${String(i + 1).padStart(width, ' ')}. ${s}`).join('\n') }
}

/** Five random colours, each as HEX, RGB and HSL. */
export const randomColor = ({ randomBytes }: LocalInput): LocalOutput => {
  const bytes = randomBytes(3 * ID_COUNT)
  const lines: string[] = []
  for (let i = 0; i < ID_COUNT; i++) {
    const one = bytes.subarray(i * 3, i * 3 + 3)
    const rgb: [number, number, number] = [one[0] ?? 0, one[1] ?? 0, one[2] ?? 0]
    const [h, s, l] = rgbToHsl(rgb)
    lines.push(`#${toHex(one)}  rgb(${rgb.join(', ')})  hsl(${h}, ${s}%, ${l}%)`)
  }
  return { text: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Dummy text.

/** A whole number from lo to hi. */
const between = (lo: number, hi: number, randomBytes: (n: number) => Uint8Array) => lo + uniformInt(hi - lo + 1, randomBytes)

export const LOREM_FIRST = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'

export const LOREM_WORDS: readonly string[] = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor',
  'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis',
  'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute',
  'irure', 'in', 'reprehenderit', 'voluptate', 'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
  'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id',
  'est', 'laborum',
]

function loremSentence(randomBytes: (n: number) => Uint8Array): string {
  const words = Array.from({ length: between(6, 12, randomBytes) }, () => pickOne(LOREM_WORDS, randomBytes))
  const s = words.join(' ')
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`
}

/** Paragraphs of Lorem ipsum (3 by default), the first opening with its set sentence. */
export const lorem = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 1, 20)) return invalid(lang, INT_TEXT(1, 20))
  const paragraphs: string[] = []
  for (let p = 0; p < arg; p++) {
    const count = between(4, 7, randomBytes)
    const sentences = Array.from({ length: count }, () => loremSentence(randomBytes))
    if (p === 0) sentences[0] = LOREM_FIRST
    paragraphs.push(sentences.join(' '))
  }
  return { text: paragraphs.join('\n\n') }
}

export const DUMMY_JA_SUBJECTS: readonly string[] = [
  '青い窓辺の時計は', '小さな駅の掲示板は', '遠くの丘に立つ風車は', '古い図書館の階段は', '静かな港の灯台は',
  '曲がり角のパン屋は', '白い封筒の切手は', '夕暮れの商店街は', '木陰のベンチは', '三番目の引き出しは',
  '雨上がりの歩道は', '屋上の植木鉢は', '紙飛行機の翼は',
]
export const DUMMY_JA_MODIFIERS: readonly string[] = [
  'いつもより少しだけ', '誰にも気づかれずに', '月曜日の朝になると', 'ゆるやかな坂の途中で', '思い出したように',
  '午後三時を過ぎたころ', '季節の変わり目に', 'ほんのりと明るく', '昨日と同じ場所で', '静かな音を立てて',
  '風の向きに合わせて', '見本のとおりに',
]
export const DUMMY_JA_PREDICATES: readonly string[] = [
  '丸い影を落としている。', '新しい色に塗り替えられた。', '次の予定を待っている。', '遠くの景色を映していた。',
  'ゆっくりと回り続けた。', '小さな約束を思い出す。', '机の上に並べられている。', 'やわらかな光を集めていた。',
  '仮の名前で呼ばれている。', '短い手紙を受け取った。', '見出しの位置を確かめた。', '余白の広さを測っている。',
  '段落の終わりに置かれた。',
]

/** Paragraphs of meaningless Japanese (3 by default), sentences made of built-in parts, for checking a layout. */
export const dummyJa = ({ arg, lang, randomBytes }: LocalInput): LocalOutput => {
  if (!isInt(arg, 1, 20)) return invalid(lang, INT_TEXT(1, 20))
  const sentence = () =>
    pickOne(DUMMY_JA_SUBJECTS, randomBytes) + pickOne(DUMMY_JA_MODIFIERS, randomBytes) + pickOne(DUMMY_JA_PREDICATES, randomBytes)
  const paragraphs = Array.from({ length: arg }, () => Array.from({ length: between(3, 6, randomBytes) }, sentence).join(''))
  return { text: paragraphs.join('\n\n') }
}

// ---------------------------------------------------------------------------
// A break.

export const BREAK_IDEAS: readonly Texts[] = [
  { ja: '立ち上がって、両腕を頭の上で伸ばす（10 秒）。', en: 'Stand up and stretch both arms over your head (10 seconds).' },
  { ja: 'コップ 1 杯の水を飲む。', en: 'Drink a glass of water.' },
  { ja: '窓の外の遠くを 20 秒見る。', en: 'Look at something far away out of the window for 20 seconds.' },
  { ja: '肩を前後に 10 回ずつ回す。', en: 'Roll your shoulders ten times forwards and ten times back.' },
  { ja: '首をゆっくり左右に傾ける（各 10 秒）。', en: 'Slowly tilt your head to each side (10 seconds each).' },
  { ja: '深呼吸を 5 回する（4 秒吸って 6 秒吐く）。', en: 'Take five deep breaths (in for 4 seconds, out for 6).' },
  { ja: '部屋の中を 2 分歩く。', en: 'Walk around the room for two minutes.' },
  { ja: '目を閉じて 30 秒休める。', en: 'Close your eyes and rest them for 30 seconds.' },
  { ja: '手首と指をほぐす（握って開くを 10 回）。', en: 'Loosen your wrists and fingers (make a fist and open it ten times).' },
  { ja: '机の上を 1 分だけ片付ける。', en: 'Tidy your desk for one minute.' },
  { ja: '窓を開けて空気を入れ替える。', en: 'Open a window and let in some fresh air.' },
  { ja: 'かかとの上げ下げを 15 回する。', en: 'Raise and lower your heels fifteen times.' },
  { ja: '背筋を伸ばして座り直す。', en: 'Sit up straight and settle back into your chair.' },
  { ja: '温かい飲み物を淹れる。', en: 'Make yourself a warm drink.' },
  { ja: '好きな曲を 1 曲だけ聴く。', en: 'Listen to one song you like.' },
  { ja: '手を洗って顔に水をつける。', en: 'Wash your hands and splash some water on your face.' },
  { ja: '植物や外の景色を眺める。', en: 'Look at a plant or at the view outside.' },
  { ja: '階段を 1 往復する。', en: 'Walk up and down a flight of stairs once.' },
  { ja: '太ももの裏を伸ばす（前屈を 20 秒）。', en: 'Stretch the backs of your legs (bend forward for 20 seconds).' },
  { ja: '目を上下左右にゆっくり動かす。', en: 'Slowly move your eyes up, down, left and right.' },
  { ja: '今日うまくいったことを 1 つ思い浮かべる。', en: 'Think of one thing that went well today.' },
  { ja: '腰に手を当てて、軽く後ろに反らす。', en: 'Put your hands on your hips and lean back gently.' },
  { ja: 'ナッツや果物を少し食べる。', en: 'Eat a few nuts or a piece of fruit.' },
  { ja: '画面から離れて、窓辺で外の光を浴びる。', en: 'Step away from the screen and get some daylight by a window.' },
  { ja: '肩をすくめて 5 秒止め、すとんと落とす（3 回）。', en: 'Shrug your shoulders, hold for 5 seconds, then drop them (three times).' },
  { ja: '次にやることを紙に 1 行だけ書く。', en: 'Write down the next thing to do in one line on paper.' },
  { ja: '手のひらを温めて目を覆う（30 秒）。', en: 'Warm your palms and cup them over your eyes (30 seconds).' },
  { ja: '足首を左右に 10 回ずつ回す。', en: 'Circle each ankle ten times.' },
  { ja: '誰かに一言、声をかける。', en: 'Say a few words to someone.' },
  { ja: '胸を開くように、両手を後ろで組んで伸ばす。', en: 'Clasp your hands behind you and stretch to open your chest.' },
]

/** One short way to spend a break, from the built-in list. */
export const breakIdea = ({ lang, randomBytes }: LocalInput): LocalOutput => ({ text: pickOne(BREAK_IDEAS, randomBytes)[lang] })
