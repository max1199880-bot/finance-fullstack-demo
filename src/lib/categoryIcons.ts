// Category icon system for the expense/income section. Each category resolves
// to a line glyph + a stable colour. Categories are user-defined, so we map by
// (1) explicit emoji the user picked, then (2) the category name, else a
// neutral fallback. The visual treatment (solid disc / outline / soft chip) is
// chosen by the user via the icon theme — see lib/iconTheme.tsx.

export type CategoryIconKey =
  | 'groceries'
  | 'cafe'
  | 'restaurant'
  | 'coffee'
  | 'bar'
  | 'fastfood'
  | 'transport'
  | 'car'
  | 'taxi'
  | 'bus'
  | 'plane'
  | 'fuel'
  | 'bike'
  | 'home'
  | 'utilities'
  | 'connection'
  | 'hygiene'
  | 'furniture'
  | 'clothes'
  | 'cosmetics'
  | 'jewelry'
  | 'nails'
  | 'hair'
  | 'watch'
  | 'entertainment'
  | 'hobby'
  | 'game'
  | 'music'
  | 'book'
  | 'ticket'
  | 'gift'
  | 'pet'
  | 'charity'
  | 'kids'
  | 'health'
  | 'sport'
  | 'pharmacy'
  | 'tooth'
  | 'spa'
  | 'education'
  | 'stationery'
  | 'repair'
  | 'chemicals'
  | 'insurance'
  | 'salary'
  | 'briefcase'
  | 'deposit'
  | 'invest'
  | 'cashback'
  | 'tips'
  | 'sale'
  | 'bank'
  | 'card'
  | 'shopping'
  | 'loss'
  | 'other';

// Line glyphs (fill=none, stroke=currentColor). viewBox 0 0 24 24.
export const CATEGORY_GLYPHS: Record<CategoryIconKey, string> = {
  groceries: 'M3.5 4h2l2.2 9.5h9.6L19 7H7 M9 19a1.3 1.3 0 1 0 .01 0 M16 19a1.3 1.3 0 1 0 .01 0',
  cafe: 'M6 3v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3 M8 11v9 M16 3c-1.4 0-2.2 2-2.2 4.5S14.7 12 16 12v8',
  restaurant: 'M4 4v6.5a4 4 0 0 0 4 4V20 M8 4v3.5 M13 4c0 3 .8 4.5 2.4 4.5S18 6.8 18 4 M15.4 8.5V20',
  coffee: 'M5 8h11v3a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 11z M16 9h2a2 2 0 0 1 0 4h-2 M4 19h13',
  bar: 'M4 4h16l-7 8.5V19 M8.5 19h7 M6.5 7h11',
  fastfood: 'M4 11h16a8 8 0 0 0-16 0z M3.5 14h17 M5 17h14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z',
  transport:
    'M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M4 11h16 M7.5 19.5a1.3 1.3 0 1 0 .01 0 M16.5 19.5a1.3 1.3 0 1 0 .01 0 M7 19v-2 M17 19v-2',
  car: 'M5.5 13 7 8.2A2 2 0 0 1 8.9 7h6.2a2 2 0 0 1 1.9 1.2L18.5 13 M4 13h16v4h-2v-1H6v1H4z M7.5 16.5a1.2 1.2 0 1 0 .01 0 M16.5 16.5a1.2 1.2 0 1 0 .01 0',
  taxi: 'M9 3h6v2H9z M5 7h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z M4 11h16 M7.5 19.5a1.2 1.2 0 1 0 .01 0 M16.5 19.5a1.2 1.2 0 1 0 .01 0',
  bus: 'M5 4h14a1 1 0 0 1 1 1v10a2 2 0 0 1-1 1.7V19a1 1 0 0 1-2 0v-1H7v1a1 1 0 0 1-2 0v-2.3A2 2 0 0 1 4 15V5a1 1 0 0 1 1-1z M4 11h16 M7.5 15a1 1 0 1 0 .01 0 M16.5 15a1 1 0 1 0 .01 0',
  plane:
    'M12.5 3.5a1.4 1.4 0 0 1 2 2l-2.6 2.6 6.3 3.2-1.4 1.4-5-.9-2.8 2.8.4 3.3-1.2 1.2-1.7-3.4-3.4-1.7 1.2-1.2 3.3.4 2.8-2.8-.9-5z',
  fuel: 'M5 4h8a1 1 0 0 1 1 1v15h1v-6a1.5 1.5 0 0 1 1.5-1.5H18V8l-2-2 1-1 3 3v7a1.5 1.5 0 0 0 3 0v-6 M4 20h11 M7 5v5h6V5z',
  bike: 'M5.5 15a3.5 3.5 0 1 0 .01 0 M18.5 15a3.5 3.5 0 1 0 .01 0 M9 8h4l2 4h3.5 M13 8l-3.5 6.5 M8.5 8h2.5',
  home: 'M3.5 11 12 4l8.5 7 M5.5 9.5V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.5',
  utilities: 'M9 3v7 M15 3v7 M6 10h12v3a6 6 0 0 1-12 0z M12 19v2',
  connection:
    'M12 5c4 0 7.5 1.6 10 4.2l-2 2A11 11 0 0 0 12 8a11 11 0 0 0-8 3.2l-2-2A14 14 0 0 1 12 5z M12 12a4.5 4.5 0 0 1 3.2 1.3l-3.2 3.4-3.2-3.4A4.5 4.5 0 0 1 12 12z',
  hygiene: 'M9 3v7 M9 6h9a2 2 0 0 1 0 4H9 M6 10h6v4a3 3 0 0 1-6 0z M9 18v2',
  furniture:
    'M5 9V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a2 2 0 0 1 1 1.7V16a1 1 0 0 1-1 1v1 M4 18v-1a1 1 0 0 1-1-1v-5.3A2 2 0 0 1 4 9 M7 10h10',
  clothes: 'M9 4l3 2 3-2 5 3.2-2.5 3-1.5-1V20H8V9.2l-1.5 1L4 7.2z',
  cosmetics:
    'M9 3h4a1 1 0 0 1 1 1v4H8V4a1 1 0 0 1 1-1z M8 8h6v3H8z M8.5 11h5l-.6 8.5a1 1 0 0 1-1 .9h-1.8a1 1 0 0 1-1-.9z',
  jewelry: 'M8 4h8l3 4-7 12L5 8z M6 8h12 M9.5 8 12 18l2.5-10',
  nails: 'M12 3a2 2 0 0 1 2 2v9a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2z M10 7h4 M9 20h6',
  hair: 'M6 6a3 3 0 1 0 .01 0 M18 6a3 3 0 1 0 .01 0 M8.5 7.5 20 18 M15.5 7.5 4 18',
  watch: 'M8.5 6.5 8 3h8l-.5 3.5 M8.5 17.5 8 21h8l-.5-3.5 M12 8a4 4 0 1 0 .01 0',
  entertainment:
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 10a1 1 0 1 0 .01 0 M15.5 10a1 1 0 1 0 .01 0 M8.5 14.5s1.5 2 3.5 2 3.5-2 3.5-2',
  hobby:
    'M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-1.8 0-.5-.3-.9-.6-1.2-.3-.4-.6-.7-.6-1.2 0-.8.7-1.3 1.5-1.3H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z M7.5 11a1 1 0 1 0 .01 0 M11 7.5a1 1 0 1 0 .01 0 M15.5 8.5a1 1 0 1 0 .01 0',
  game: 'M8 8h8a4.5 4.5 0 0 1 4.5 4.5A3 3 0 0 1 15 14l-.6-.8H9.6L9 14a3 3 0 0 1-5.5-1.5A4.5 4.5 0 0 1 8 8z M6.5 10.5v2 M5.5 11.5h2 M15.5 11a.8.8 0 1 0 .01 0 M17 12.5a.8.8 0 1 0 .01 0',
  music:
    'M18 4v10.2a3 3 0 1 1-1.8-2.75V7.5l-7 1.5v6.7a3 3 0 1 1-1.8-2.75V6.5a1 1 0 0 1 .8-.98l8.2-1.8A1 1 0 0 1 18 4z',
  book: 'M5 4h10a1.5 1.5 0 0 1 1.5 1.5V20l-3-1.7L11 20V4H5z M16.5 5.5H18a1.5 1.5 0 0 1 1.5 1.5v11.7l-3-1.7',
  ticket:
    'M4 7h16a1 1 0 0 1 1 1v2.5a1.8 1.8 0 0 0 0 3.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a1.8 1.8 0 0 0 0-3.5V8a1 1 0 0 1 1-1z M13 8v2 M13 14v2',
  gift: 'M4 9.5h16v3.5H4z M5 13v6.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V13 M12 9.5V21 M12 9.5C11 6 9.5 5 8 5a2 2 0 0 0 0 4.5 M12 9.5C13 6 14.5 5 16 5a2 2 0 0 1 0 4.5',
  pet: 'M6 9.5a1.6 1.6 0 1 0 .01 0 M10 6.5a1.6 1.6 0 1 0 .01 0 M14 6.5a1.6 1.6 0 1 0 .01 0 M18 9.5a1.6 1.6 0 1 0 .01 0 M12 12c-2.2 0-4.2 1.7-4.6 3.9-.3 1.5.9 2.6 2.3 2.6.8 0 1.5-.4 2.3-.4s1.5.4 2.3.4c1.4 0 2.6-1.1 2.3-2.6C16.2 13.7 14.2 12 12 12z',
  charity: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z',
  kids: 'M12 3a2.2 2.2 0 1 0 .01 0 M8.5 20v-4l-2-1.5 1-4a3 3 0 0 1 3-2h3a3 3 0 0 1 3 2l1 4-2 1.5v4',
  health: 'M3.5 12.5h3l2-5 3 8 2.5-6 1.5 3h5',
  sport: 'M4 9v6 M6 8v8 M18 8v8 M20 9v6 M6 12h12',
  pharmacy:
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M12 9v6 M9 12h6 M8 5V3.5h8V5',
  tooth:
    'M8 3.5c1.2 0 1.8.7 4 .7s2.8-.7 4-.7A3.5 3.5 0 0 1 19.5 7c0 2.2-.9 3.5-1.5 6.5-.4 2.3-.7 6-2 6-1.2 0-1.1-3.5-1.8-5.3-.3-.9-.6-1.2-1.7-1.2s-1.4.3-1.7 1.2c-.7 1.8-.6 5.3-1.8 5.3-1.3 0-1.6-3.7-2-6C4.4 10.5 3.5 9.2 3.5 7A3.5 3.5 0 0 1 8 3.5z',
  spa: 'M12 3c2 2.5 3 4.8 3 7a3 3 0 0 1-6 0c0-2.2 1-4.5 3-7z M4 13c3 0 5 1 7 3-3 0-5-1-7-3z M20 13c-2 2-4 3-7 3 2-2 4-3 7-3z',
  education: 'M12 4 2.5 8.5 12 13l9.5-4.5zM6 11v4.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V11 M21.5 8.5v5.5',
  stationery: 'M17 3l4 4L9 19l-5 1 1-5z M14 6l4 4',
  repair:
    'M14.5 4a4.5 4.5 0 0 0-4 6.5L4 17l3 3 6.5-6.5A4.5 4.5 0 0 0 20 9l-2.5 2.5-2-2L18 7a4.5 4.5 0 0 0-3.5-3z',
  chemicals: 'M8 3h5v4l3.5 8.5a2 2 0 0 1-1.9 2.7H6.4a2 2 0 0 1-1.9-2.7L8 7z M8 12h5 M10 3v4',
  insurance: 'M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z M9 12l2 2 4-4',
  salary: 'M12 4a2 2 0 1 0 .01 0 M4 20c0-3 3.5-5 8-5s8 2 8 5 M8 20v-2 M16 20v-2',
  briefcase:
    'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7 M4 8h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M3 13h18',
  deposit: 'M4 8 12 4l8 4 M4 8v2h16V8 M6 11v6 M10 11v6 M14 11v6 M18 11v6 M3 19h18 M18 4l3-1-1 3',
  invest: 'M4 17 9 12l3 3 8-8 M15 7h5v5',
  cashback: 'M20 8a8 8 0 1 0 1.5 7 M20 4v4h-4',
  tips: 'M12 8a4 4 0 1 0 .01 0 M12 11v2 M10.5 11.5c0 .8.7 1.2 1.5 1.2s1.5-.4 1.5-1.2-.7-1-1.5-1-1.5-.4-1.5-1 .7-1 1.5-1 1.5.4 1.5 1',
  sale: 'M4 4h7l9 9-7 7-9-9z M8 8a1 1 0 1 0 .01 0',
  bank: 'M4 10 12 4l8 6 M5 10h14 M7 11v6 M11 11v6 M15 11v6 M4 19h16',
  card: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M2 10h20 M6 14h4',
  shopping: 'M6 8V6a6 6 0 0 1 12 0v2 M4.5 8h15l-1 11.5a1 1 0 0 1-1 .9h-11a1 1 0 0 1-1-.9z M9 8v2 M15 8v2',
  loss: 'M4 7l6 6 3-3 7 7 M14 17h6v-6',
  other: 'M6 12a1.4 1.4 0 1 0 .01 0 M12 12a1.4 1.4 0 1 0 .01 0 M18 12a1.4 1.4 0 1 0 .01 0',
};

// Vivid colour per icon (works on solid disc, outline, and soft chip).
export const CATEGORY_COLORS: Record<CategoryIconKey, string> = {
  groceries: '#16A34A',
  cafe: '#EF4444',
  restaurant: '#EF4444',
  coffee: '#B45309',
  bar: '#7C3AED',
  fastfood: '#F97316',
  transport: '#0EA5E9',
  car: '#6366F1',
  taxi: '#EAB308',
  bus: '#0891B2',
  plane: '#3B82F6',
  fuel: '#EF4444',
  bike: '#22C55E',
  home: '#3B82F6',
  utilities: '#2563EB',
  connection: '#06B6D4',
  hygiene: '#0EA5E9',
  furniture: '#8B5CF6',
  clothes: '#8B5CF6',
  cosmetics: '#EC4899',
  jewelry: '#D946EF',
  nails: '#FB7185',
  hair: '#A78BFA',
  watch: '#0D9488',
  entertainment: '#8B5CF6',
  hobby: '#F97316',
  game: '#7C3AED',
  music: '#DB2777',
  book: '#0EA5E9',
  ticket: '#F59E0B',
  gift: '#EC4899',
  pet: '#F59E0B',
  charity: '#F43F5E',
  kids: '#FB923C',
  health: '#20B7A6',
  sport: '#F97316',
  pharmacy: '#DC2626',
  tooth: '#38BDF8',
  spa: '#14B8A6',
  education: '#22C55E',
  stationery: '#F59E0B',
  repair: '#A855F7',
  chemicals: '#14B8A6',
  insurance: '#10B981',
  salary: '#22C55E',
  briefcase: '#8B5CF6',
  deposit: '#3B82F6',
  invest: '#10B981',
  cashback: '#06B6D4',
  tips: '#F59E0B',
  sale: '#EC4899',
  bank: '#6366F1',
  card: '#4F46E5',
  shopping: '#EC4899',
  loss: '#DC2626',
  other: '#64748B',
};

// Emoji → icon key (covers EmojiPicker's curated set + name-map defaults).
const EMOJI_MAP: Record<string, CategoryIconKey> = {
  '🛒': 'groceries',
  '🍞': 'groceries',
  '🥗': 'groceries',
  '🥦': 'groceries',
  '🍽': 'restaurant',
  '🍽️': 'restaurant',
  '🍱': 'restaurant',
  '🍣': 'restaurant',
  '🍜': 'restaurant',
  '🍕': 'fastfood',
  '🍔': 'fastfood',
  '🍿': 'fastfood',
  '☕️': 'coffee',
  '☕': 'coffee',
  '🍺': 'bar',
  '🍷': 'bar',
  '🚗': 'car',
  '🚕': 'taxi',
  '🚌': 'bus',
  '🚇': 'bus',
  '✈️': 'plane',
  '⛽️': 'fuel',
  '⛽': 'fuel',
  '🅿️': 'transport',
  '🚲': 'bike',
  '🛴': 'bike',
  '🚤': 'transport',
  '🏠': 'home',
  '💡': 'utilities',
  '🚿': 'hygiene',
  '📱': 'connection',
  '💻': 'connection',
  '📺': 'entertainment',
  '🛋': 'furniture',
  '🪑': 'furniture',
  '🧺': 'hygiene',
  '🧹': 'chemicals',
  '🎬': 'entertainment',
  '🎮': 'game',
  '🎵': 'music',
  '🎤': 'music',
  '🎫': 'ticket',
  '🎲': 'game',
  '📚': 'book',
  '🎨': 'hobby',
  '🎯': 'hobby',
  '🛍': 'shopping',
  '👕': 'clothes',
  '👟': 'clothes',
  '👜': 'clothes',
  '💎': 'jewelry',
  '🎁': 'gift',
  '👶': 'kids',
  '🐶': 'pet',
  '🐱': 'pet',
  '💊': 'pharmacy',
  '🏋️': 'sport',
  '🏋': 'sport',
  '🏥': 'pharmacy',
  '🦷': 'tooth',
  '⚕️': 'health',
  '💆': 'spa',
  '🧘': 'spa',
  '⚽️': 'sport',
  '🏃': 'sport',
  '🚴': 'bike',
  '💰': 'salary',
  '💳': 'card',
  '💵': 'salary',
  '🏦': 'bank',
  '📈': 'invest',
  '📊': 'invest',
  '💼': 'briefcase',
  '🎓': 'education',
  '🌹': 'cosmetics',
  '✨': 'other',
  '🎉': 'entertainment',
  '🔧': 'repair',
  '✂️': 'hair',
  '📦': 'other',
  '🌿': 'charity',
  '🔥': 'other',
  '⭐️': 'other',
  '🔻': 'loss',
  '📉': 'loss',
  '💸': 'salary',
  '🧾': 'other',
  '🍎': 'groceries',
  '🥤': 'coffee',
  '🎂': 'cafe',
  '🌮': 'fastfood',
};

// Category name → icon key (default categories + common Russian names).
const NAME_MAP: Record<string, CategoryIconKey> = {
  продукты: 'groceries',
  'еда вне дома': 'restaurant',
  кафе: 'cafe',
  рестораны: 'restaurant',
  ресторан: 'restaurant',
  кофе: 'coffee',
  фастфуд: 'fastfood',
  бар: 'bar',
  транспорт: 'transport',
  авто: 'car',
  автомобиль: 'car',
  такси: 'taxi',
  путешествия: 'plane',
  топливо: 'fuel',
  бензин: 'fuel',
  велосипед: 'bike',
  дом: 'home',
  'дом/связь': 'home',
  коммуналка: 'utilities',
  ку: 'utilities',
  связь: 'connection',
  интернет: 'connection',
  гигиена: 'hygiene',
  мебель: 'furniture',
  одежда: 'clothes',
  'одежда/обувь': 'clothes',
  обувь: 'clothes',
  аксессуары: 'watch',
  косметика: 'cosmetics',
  украшения: 'jewelry',
  ювелирные: 'jewelry',
  ногти: 'nails',
  волосы: 'hair',
  парикмахер: 'hair',
  развлечения: 'entertainment',
  хобби: 'hobby',
  игры: 'game',
  музыка: 'music',
  книги: 'book',
  подписки: 'entertainment',
  подарки: 'gift',
  подарок: 'gift',
  питомцы: 'pet',
  'домашние животные': 'pet',
  благотворительность: 'charity',
  дети: 'kids',
  здоровье: 'health',
  'мед/спорт': 'sport',
  спорт: 'sport',
  аптека: 'pharmacy',
  зубы: 'tooth',
  стоматология: 'tooth',
  красота: 'spa',
  образование: 'education',
  канцелярия: 'stationery',
  ремонт: 'repair',
  'ремонт/инструменты': 'repair',
  'ремонт вещей': 'repair',
  химия: 'chemicals',
  страховка: 'insurance',
  кредит: 'card',
  кредиты: 'card',
  девушки: 'cosmetics',
  другое: 'other',
  прочее: 'other',
  покупки: 'shopping',
  шопинг: 'shopping',
  убыток: 'loss',
  убытки: 'loss',
  потери: 'loss',
  'кафе и рестораны': 'cafe',
  коммунальные: 'utilities',
  жкх: 'utilities',
  'здоровье и спорт': 'health',
  путешествие: 'plane',
  отпуск: 'plane',
  парикмахерская: 'hair',
  маникюр: 'nails',
  кэшбек: 'cashback',
  зарплата: 'salary',
  подработка: 'briefcase',
  '% по вкладу': 'deposit',
  вклад: 'deposit',
  вложения: 'invest',
  инвестиции: 'invest',
  возвраты: 'cashback',
  кэшбэк: 'cashback',
  чаевые: 'tips',
  продажа: 'sale',
  больничный: 'pharmacy',
  нашла: 'salary',
  пожертвования: 'charity',
};

// Strip variation selectors (U+FE0F/FE0E), ZWJ, and skin-tone modifiers so an
// emoji like "🛍️" (with a hidden U+FE0F) matches the same key as "🛍".
function normalizeEmoji(e: string): string {
  return (
    e
      // Намеренно поштучно: вырезаем селекторы вариантов, склейку и рамку эмодзи по отдельности.
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\uFE00-\uFE0F\u200D\u20E3]/g, '')
      .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
      .trim()
  );
}

// Emoji map with normalized keys, built once (handles both "☕️" and "☕").
const EMOJI_MAP_NORM: Record<string, CategoryIconKey> = (() => {
  const m: Record<string, CategoryIconKey> = {};
  for (const [k, v] of Object.entries(EMOJI_MAP)) m[normalizeEmoji(k)] = v;
  return m;
})();

// A category can pin a specific icon by storing "ic:<key>" in its emoji field
// (no DB migration needed). These helpers read that reference.
export const ICON_REF_PREFIX = 'ic:';
export function isIconRef(emoji?: string | null): boolean {
  return !!emoji && emoji.startsWith(ICON_REF_PREFIX) && emoji.slice(3) in CATEGORY_GLYPHS;
}
export function iconRefKey(emoji: string): CategoryIconKey {
  return emoji.slice(3) as CategoryIconKey;
}
export function makeIconRef(key: CategoryIconKey): string {
  return ICON_REF_PREFIX + key;
}

// Representative emoji per icon — shown when the user picked an icon but is
// viewing in the "emoji stickers" mode.
export const ICON_EMOJI: Record<CategoryIconKey, string> = {
  groceries: '🛒',
  cafe: '🍽',
  restaurant: '🍽',
  coffee: '☕️',
  bar: '🍺',
  fastfood: '🍔',
  transport: '🚌',
  car: '🚗',
  taxi: '🚕',
  bus: '🚌',
  plane: '✈️',
  fuel: '⛽️',
  bike: '🚲',
  home: '🏠',
  utilities: '💡',
  connection: '📱',
  hygiene: '🚿',
  furniture: '🛋',
  clothes: '👕',
  cosmetics: '💄',
  jewelry: '💎',
  nails: '💅',
  hair: '✂️',
  watch: '⌚️',
  entertainment: '🎬',
  hobby: '🎨',
  game: '🎮',
  music: '🎵',
  book: '📚',
  ticket: '🎫',
  gift: '🎁',
  pet: '🐶',
  charity: '❤️',
  kids: '👶',
  health: '❤️',
  sport: '🏋️',
  pharmacy: '💊',
  tooth: '🦷',
  spa: '💆',
  education: '🎓',
  stationery: '✏️',
  repair: '🔧',
  chemicals: '🧴',
  insurance: '🛡',
  salary: '💰',
  briefcase: '💼',
  deposit: '🏦',
  invest: '📈',
  cashback: '💸',
  tips: '🪙',
  sale: '🏷',
  bank: '🏦',
  card: '💳',
  shopping: '🛍',
  loss: '📉',
  other: '•',
};

/** Resolve a category to its icon key: pinned ref → emoji → name → fallback. */
export function categoryIconKey(name: string, emoji?: string | null): CategoryIconKey {
  if (isIconRef(emoji)) return iconRefKey(emoji as string);
  if (emoji) {
    const e = normalizeEmoji(emoji);
    if (EMOJI_MAP_NORM[e]) return EMOJI_MAP_NORM[e];
  }
  const key = name.trim().toLowerCase();
  if (NAME_MAP[key]) return NAME_MAP[key];
  return 'other';
}

/** Ordered list for the icon-picker grid, grouped for readability. */
export const CATEGORY_ICON_ORDER: CategoryIconKey[] = [
  'groceries',
  'cafe',
  'restaurant',
  'coffee',
  'bar',
  'fastfood',
  'transport',
  'car',
  'taxi',
  'bus',
  'plane',
  'fuel',
  'bike',
  'home',
  'utilities',
  'connection',
  'hygiene',
  'furniture',
  'clothes',
  'cosmetics',
  'jewelry',
  'nails',
  'hair',
  'watch',
  'entertainment',
  'hobby',
  'game',
  'music',
  'book',
  'ticket',
  'gift',
  'pet',
  'charity',
  'kids',
  'health',
  'sport',
  'pharmacy',
  'tooth',
  'spa',
  'education',
  'stationery',
  'repair',
  'chemicals',
  'insurance',
  'salary',
  'briefcase',
  'deposit',
  'invest',
  'cashback',
  'tips',
  'sale',
  'bank',
  'card',
  'other',
];
