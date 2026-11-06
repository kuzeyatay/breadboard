import { EXTRA_BROWSER_QUOTES } from "./browser-extra-quotes.ts";

export const QUOTE_MOODS = ["uplifting", "funny", "thoughtful", "curious", "everyday", "calm"] as const;
export type QuoteMood = typeof QUOTE_MOODS[number];
export const QUOTE_MOOD_LABELS: Record<QuoteMood, string> = {
  uplifting: "Uplifting", funny: "Funny", thoughtful: "Thoughtful", curious: "Curious", everyday: "Everyday", calm: "Calm",
};

export interface BrowserDailyQuote {
  quote: string;
  author: string;
  mood: QuoteMood;
  original?: boolean;
}

/** A long local rotation keeps the new-tab page useful while offline. */
const CLASSIC_BROWSER_QUOTES: readonly BrowserDailyQuote[] = [
  { quote: "Great things are done by a series of small things brought together.", author: "Vincent van Gogh", mood: "uplifting" },
  { quote: "Act as if what you do makes a difference. It does.", author: "William James", mood: "uplifting" },
  { quote: "Nothing will work unless you do.", author: "Maya Angelou", mood: "uplifting" },
  { quote: "With the new day comes new strength and new thoughts.", author: "Eleanor Roosevelt", mood: "uplifting" },
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain", mood: "uplifting" },
  { quote: "Energy and persistence conquer all things.", author: "Benjamin Franklin", mood: "uplifting" },
  { quote: "The only way out is through.", author: "Robert Frost", mood: "uplifting" },
  { quote: "No act of kindness, no matter how small, is ever wasted.", author: "Aesop", mood: "uplifting" },
  { quote: "If there is no struggle, there is no progress.", author: "Frederick Douglass", mood: "uplifting" },
  { quote: "Light tomorrow with today.", author: "Elizabeth Barrett Browning", mood: "uplifting" },
  { quote: "The power of imagination makes us infinite.", author: "John Muir", mood: "uplifting" },
  { quote: "Make each day your masterpiece.", author: "John Wooden", mood: "uplifting" },
  { quote: "The best way out is always through.", author: "Robert Frost", mood: "uplifting" },
  { quote: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt", mood: "uplifting" },
  { quote: "Turn your wounds into wisdom.", author: "Oprah Winfrey", mood: "uplifting" },
  { quote: "It is never too late to be what you might have been.", author: "George Eliot", mood: "uplifting" },
  { quote: "You must do the thing you think you cannot do.", author: "Eleanor Roosevelt", mood: "uplifting" },
  { quote: "Wherever you go, go with all your heart.", author: "Confucius", mood: "uplifting" },
  { quote: "Happiness depends upon ourselves.", author: "Aristotle", mood: "thoughtful" },
  { quote: "What we think, we become.", author: "Buddha", mood: "thoughtful" },
  { quote: "The journey of a thousand miles begins with one step.", author: "Lao Tzu", mood: "uplifting" },
  { quote: "Well begun is half done.", author: "Aristotle", mood: "uplifting" },
  { quote: "Fortune favors the bold.", author: "Virgil", mood: "uplifting" },
  { quote: "While there is life, there is hope.", author: "Cicero", mood: "uplifting" },
  { quote: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca", mood: "uplifting" },
  { quote: "The sun is new each day.", author: "Heraclitus", mood: "thoughtful" },
  { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche", mood: "thoughtful" },
  { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry", mood: "uplifting" },
  { quote: "It is not enough to be busy. The question is: what are we busy about?", author: "Henry David Thoreau", mood: "thoughtful" },
  { quote: "The creation of a thousand forests is in one acorn.", author: "Ralph Waldo Emerson", mood: "thoughtful" },
  { quote: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson", mood: "uplifting" },
  { quote: "Forever is composed of nows.", author: "Emily Dickinson", mood: "thoughtful" },
  { quote: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson", mood: "uplifting" },
  { quote: "There is no charm equal to tenderness of heart.", author: "Jane Austen", mood: "thoughtful" },
  { quote: "To love and be loved is to feel the sun from both sides.", author: "David Viscott", mood: "thoughtful" },
  { quote: "The most wasted of days is one without laughter.", author: "E. E. Cummings", mood: "thoughtful" },
  { quote: "Life shrinks or expands in proportion to one's courage.", author: "Anaïs Nin", mood: "uplifting" },
  { quote: "In the middle of difficulty lies opportunity.", author: "Albert Einstein", mood: "uplifting" },
  { quote: "Once you choose hope, anything is possible.", author: "Christopher Reeve", mood: "uplifting" },
  { quote: "Dreams are the touchstones of our character.", author: "Henry David Thoreau", mood: "thoughtful" },
  { quote: "The future belongs to those who prepare for it today.", author: "Malcolm X", mood: "uplifting" },
  { quote: "The most effective way to do it, is to do it.", author: "Amelia Earhart", mood: "uplifting" },
  { quote: "A champion is defined not by wins but by how they can recover when they fall.", author: "Serena Williams", mood: "uplifting" },
  { quote: "You are never too old to set another goal or to dream a new dream.", author: "C. S. Lewis", mood: "uplifting" },
  { quote: "The beginning is always today.", author: "Mary Shelley", mood: "uplifting" },
  { quote: "Nothing is impossible to a willing heart.", author: "John Heywood", mood: "uplifting" },
  { quote: "One today is worth two tomorrows.", author: "Benjamin Franklin", mood: "uplifting" },
  { quote: "Every noble work is at first impossible.", author: "Thomas Carlyle", mood: "uplifting" },
  { quote: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius", mood: "uplifting" },
  { quote: "What you do speaks so loudly that I cannot hear what you say.", author: "Ralph Waldo Emerson", mood: "thoughtful" },
  { quote: "Patience and perseverance have a magical effect before which difficulties disappear.", author: "John Quincy Adams", mood: "uplifting" },
  { quote: "It is our choices that show what we truly are, far more than our abilities.", author: "J. K. Rowling", mood: "thoughtful" },
  { quote: "We know what we are, but know not what we may be.", author: "William Shakespeare", mood: "thoughtful" },
  { quote: "There is nothing either good or bad, but thinking makes it so.", author: "William Shakespeare", mood: "thoughtful" },
  { quote: "To thine own self be true.", author: "William Shakespeare", mood: "thoughtful" },
  { quote: "Wisely, and slow. They stumble that run fast.", author: "William Shakespeare", mood: "calm" },
  { quote: "Action is the foundational key to all success.", author: "Pablo Picasso", mood: "uplifting" },
  { quote: "Inspiration exists, but it has to find you working.", author: "Pablo Picasso", mood: "uplifting" },
  { quote: "Quality is not an act, it is a habit.", author: "Aristotle", mood: "uplifting" },
  { quote: "The reward of a thing well done is having done it.", author: "Ralph Waldo Emerson", mood: "calm" },
  { quote: "If opportunity doesn't knock, build a door.", author: "Milton Berle", mood: "uplifting" },
  { quote: "A person who never made a mistake never tried anything new.", author: "Albert Einstein", mood: "uplifting" },
  { quote: "The way to get started is to quit talking and begin doing.", author: "Walt Disney", mood: "uplifting" },
  { quote: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier", mood: "uplifting" },
] as const;

// Interleave the gallery so its first screen shows the collection's range.
const pool = [...CLASSIC_BROWSER_QUOTES, ...EXTRA_BROWSER_QUOTES];
const buckets = QUOTE_MOODS.map(mood => pool.filter(quote => quote.mood === mood));
export const BROWSER_DAILY_QUOTES: readonly BrowserDailyQuote[] = Array.from(
  {length: Math.max(...buckets.map(bucket => bucket.length))},
  (_, index) => buckets.flatMap(bucket => bucket[index] ? [bucket[index]!] : []),
).flat();

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function browserQuoteDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function browserDailyQuote(
  date: Date,
  ownerKey: string,
  maximumQuoteLength = Number.POSITIVE_INFINITY,
): BrowserDailyQuote {
  const candidates = Number.isFinite(maximumQuoteLength)
    ? BROWSER_DAILY_QUOTES.filter((entry) => entry.quote.length <= maximumQuoteLength)
    : BROWSER_DAILY_QUOTES;
  // Rotate through all six moods, shared by the full and compact widget.
  // UTC arithmetic over the local date keeps daylight-saving changes from skipping a mood.
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  const mood = QUOTE_MOODS[((day + stableHash(ownerKey)) % QUOTE_MOODS.length + QUOTE_MOODS.length) % QUOTE_MOODS.length];
  const matchingMood = candidates.filter(quote => quote.mood === mood);
  const rotation = matchingMood.length ? matchingMood : candidates.length ? candidates : BROWSER_DAILY_QUOTES;
  const index = stableHash(`${browserQuoteDateKey(date)}:${ownerKey}`) % rotation.length;
  return rotation[index]!;
}

/** Content-based IDs keep saved choices stable when the collection is reordered. */
export function browserQuoteId(entry: BrowserDailyQuote): string {
  return "quote-" + stableHash(entry.quote + "\n" + entry.author).toString(36);
}
const QUOTES_BY_ID = new Map(BROWSER_DAILY_QUOTES.map(entry => [browserQuoteId(entry), entry]));
export function browserQuoteForChoice(choice: string): BrowserDailyQuote | null {
  return QUOTES_BY_ID.get(choice) ?? null;
}
export function validBrowserQuoteChoice(value: unknown): value is string {
  return typeof value === "string" && (value === "daily" || QUOTES_BY_ID.has(value));
}
