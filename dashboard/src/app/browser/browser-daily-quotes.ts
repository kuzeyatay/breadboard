export interface BrowserDailyQuote {
  quote: string;
  author: string;
}

/** A long local rotation keeps the new-tab page useful while offline. */
export const BROWSER_DAILY_QUOTES: readonly BrowserDailyQuote[] = [
  { quote: "Great things are done by a series of small things brought together.", author: "Vincent van Gogh" },
  { quote: "Act as if what you do makes a difference. It does.", author: "William James" },
  { quote: "Nothing will work unless you do.", author: "Maya Angelou" },
  { quote: "With the new day comes new strength and new thoughts.", author: "Eleanor Roosevelt" },
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { quote: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { quote: "The only way out is through.", author: "Robert Frost" },
  { quote: "No act of kindness, no matter how small, is ever wasted.", author: "Aesop" },
  { quote: "If there is no struggle, there is no progress.", author: "Frederick Douglass" },
  { quote: "Light tomorrow with today.", author: "Elizabeth Barrett Browning" },
  { quote: "The power of imagination makes us infinite.", author: "John Muir" },
  { quote: "Make each day your masterpiece.", author: "John Wooden" },
  { quote: "The best way out is always through.", author: "Robert Frost" },
  { quote: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  { quote: "Turn your wounds into wisdom.", author: "Oprah Winfrey" },
  { quote: "It is never too late to be what you might have been.", author: "George Eliot" },
  { quote: "You must do the thing you think you cannot do.", author: "Eleanor Roosevelt" },
  { quote: "Wherever you go, go with all your heart.", author: "Confucius" },
  { quote: "Happiness depends upon ourselves.", author: "Aristotle" },
  { quote: "What we think, we become.", author: "Buddha" },
  { quote: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
  { quote: "Well begun is half done.", author: "Aristotle" },
  { quote: "Fortune favors the bold.", author: "Virgil" },
  { quote: "While there is life, there is hope.", author: "Cicero" },
  { quote: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
  { quote: "The sun is new each day.", author: "Heraclitus" },
  { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { quote: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { quote: "It is not enough to be busy. The question is: what are we busy about?", author: "Henry David Thoreau" },
  { quote: "The creation of a thousand forests is in one acorn.", author: "Ralph Waldo Emerson" },
  { quote: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson" },
  { quote: "Forever is composed of nows.", author: "Emily Dickinson" },
  { quote: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
  { quote: "There is no charm equal to tenderness of heart.", author: "Jane Austen" },
  { quote: "To love and be loved is to feel the sun from both sides.", author: "David Viscott" },
  { quote: "The most wasted of days is one without laughter.", author: "E. E. Cummings" },
  { quote: "Life shrinks or expands in proportion to one's courage.", author: "Anaïs Nin" },
  { quote: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { quote: "Once you choose hope, anything is possible.", author: "Christopher Reeve" },
  { quote: "Dreams are the touchstones of our character.", author: "Henry David Thoreau" },
  { quote: "The future belongs to those who prepare for it today.", author: "Malcolm X" },
  { quote: "The most effective way to do it, is to do it.", author: "Amelia Earhart" },
  { quote: "A champion is defined not by wins but by how they can recover when they fall.", author: "Serena Williams" },
  { quote: "You are never too old to set another goal or to dream a new dream.", author: "C. S. Lewis" },
  { quote: "The beginning is always today.", author: "Mary Shelley" },
  { quote: "Nothing is impossible to a willing heart.", author: "John Heywood" },
  { quote: "One today is worth two tomorrows.", author: "Benjamin Franklin" },
  { quote: "Every noble work is at first impossible.", author: "Thomas Carlyle" },
  { quote: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { quote: "What you do speaks so loudly that I cannot hear what you say.", author: "Ralph Waldo Emerson" },
  { quote: "Patience and perseverance have a magical effect before which difficulties disappear.", author: "John Quincy Adams" },
  { quote: "It is our choices that show what we truly are, far more than our abilities.", author: "J. K. Rowling" },
  { quote: "We know what we are, but know not what we may be.", author: "William Shakespeare" },
  { quote: "There is nothing either good or bad, but thinking makes it so.", author: "William Shakespeare" },
  { quote: "To thine own self be true.", author: "William Shakespeare" },
  { quote: "Wisely, and slow. They stumble that run fast.", author: "William Shakespeare" },
  { quote: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { quote: "Inspiration exists, but it has to find you working.", author: "Pablo Picasso" },
  { quote: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { quote: "The reward of a thing well done is having done it.", author: "Ralph Waldo Emerson" },
  { quote: "If opportunity doesn't knock, build a door.", author: "Milton Berle" },
  { quote: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { quote: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { quote: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
] as const;

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
  const rotation = candidates.length ? candidates : BROWSER_DAILY_QUOTES;
  const index = stableHash(`${browserQuoteDateKey(date)}:${ownerKey}`) % rotation.length;
  return rotation[index]!;
}
