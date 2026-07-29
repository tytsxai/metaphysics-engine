import tarotDeck from '../data/tarotData.js';

export const TAROT_SPREADS = {
  SingleCard: {
    count: 1,
    positions: [{ label: 'Insight', meaning: 'The core message to focus on right now.' }],
  },
  ThreeCard: {
    count: 3,
    positions: [
      { label: 'Past', meaning: 'What led to this moment.' },
      { label: 'Present', meaning: 'The current energy or situation.' },
      { label: 'Future', meaning: 'Likely direction if the path continues.' },
    ],
  },
  CelticCross: {
    count: 10,
    positions: [
      { label: 'Present', meaning: 'Your current situation or heart of the matter.' },
      { label: 'Challenge', meaning: 'The obstacle, tension, or crossing influence.' },
      { label: 'Past', meaning: 'Recent past events or influences fading.' },
      { label: 'Future', meaning: 'Near-future direction or next steps.' },
      { label: 'Above', meaning: 'Conscious goals, aspirations, or ideals.' },
      { label: 'Below', meaning: 'Subconscious roots, foundations, or hidden motives.' },
      { label: 'Advice', meaning: 'Guidance on how to respond or proceed.' },
      { label: 'External', meaning: 'Outside influences, people, or environment.' },
      { label: 'Hopes/Fears', meaning: 'Inner desires, anxieties, or expectations.' },
      { label: 'Outcome', meaning: 'Likely outcome if current course continues.' },
    ],
  },
};

export const getTarotSpreadConfig = (spreadType) => {
  if (!spreadType) return TAROT_SPREADS.SingleCard;
  return TAROT_SPREADS[spreadType] || TAROT_SPREADS.SingleCard;
};

const shuffleDeck = (deck, rng) => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
};

/**
 * 逆位概率。
 *
 * 洗牌时每张牌的朝向是独立的，正逆应当等概率 —— 此前硬编的 0.3 没有出处，
 * 只会让逆位系统性偏少。要按自家牌阵习惯调（有些实践确实压低逆位率），
 * 传 reversalRate 覆盖，不要再改这个默认值。
 */
const DEFAULT_REVERSAL_RATE = 0.5;

export const drawTarot = ({
  spreadType = 'SingleCard',
  rng = Math.random,
  reversalRate = DEFAULT_REVERSAL_RATE,
} = {}) => {
  const normalizedSpread = spreadType || 'SingleCard';
  const rate = Number.isFinite(reversalRate)
    ? Math.min(Math.max(reversalRate, 0), 1)
    : DEFAULT_REVERSAL_RATE;
  const spreadConfig = getTarotSpreadConfig(normalizedSpread);
  const positions = spreadConfig.positions || [];

  const shuffled = shuffleDeck(tarotDeck, rng);

  const drawCount = spreadConfig.count || 1;
  const drawnCards = shuffled.slice(0, drawCount).map((card, index) => ({
    ...card,
    position: index + 1,
    positionLabel: positions[index]?.label || spreadConfig.labels?.[index] || null,
    positionMeaning: positions[index]?.meaning || null,
    isReversed: rng() < rate,
  }));

  return {
    spreadType: normalizedSpread,
    reversalRate: rate,
    cards: drawnCards,
    spreadMeta: {
      positions: positions.map((position, index) => ({
        position: index + 1,
        label: position.label,
        meaning: position.meaning,
      })),
    },
  };
};
