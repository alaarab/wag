declare module 'virtual:wag-decks' {
  import type { Deck } from 'wag';
  const decks: Record<string, () => Promise<{ default: Deck }>>;
  export default decks;
}
