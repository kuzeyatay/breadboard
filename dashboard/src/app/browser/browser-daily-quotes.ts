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
  /** Provenance for maintaining attributions; never fetched by the widget. */
  source?: string;
}

/** Inspirational quotations, kept local so the widget also works offline.
 * Keep a broad mix of cultures, professions and life experiences. Unknown authors
 * stay anonymous rather than acquiring a famous but unsupported attribution.
 */
const INSPIRATIONAL_BROWSER_QUOTES: readonly BrowserDailyQuote[] = [
  { quote: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela", mood: "uplifting", source: "https://www.nelsonmandela.org/nm100-education" },
  { quote: "Our words can change the world.", author: "Malala Yousafzai", mood: "uplifting", source: "https://malala.org/news-and-voices/malala-un-speech" },
  { quote: "All flourishing is mutual.", author: "Robin Wall Kimmerer", mood: "uplifting", source: "https://milkweed.org/membership" },
  { quote: "Like what you do; then you will do your best.", author: "Katherine Johnson", mood: "uplifting", source: "https://science.nasa.gov/people/katherine-johnson/" },
  { quote: "Pressure is a privilege.", author: "Billie Jean King", mood: "uplifting", source: "https://www.billiejeanking.com/tennis/" },
  { quote: "I will be a hummingbird; I will do the best I can.", author: "Wangari Maathai", mood: "uplifting", source: "https://www.greenbeltmovement.org/be-a-hummingbird/" },
  { quote: "Alone we can do so little; together we can do so much.", author: "Helen Keller", mood: "uplifting", source: "https://afb.org/about-afb/history/helen-keller/quotes/helen-keller-quotes-progress" },
  { quote: "Never be limited by other people’s limited imaginations.", author: "Mae Jemison", mood: "uplifting", source: "https://www.vanderbiltmuseum.org/wp-content/uploads/2020/09/Mae-Jemison-PDF-Printable-Worksheet.pdf" },
  { quote: "We must have perseverance and above all confidence in ourselves.", author: "Marie Curie", mood: "uplifting", source: "Ève Curie, Madame Curie: A Biography (1937), part 2, p. 116" },
  { quote: "But we do language. That may be the measure of our lives.", author: "Toni Morrison", mood: "uplifting", source: "https://www.nobelprize.org/prizes/literature/1993/morrison/lecture/" },
  { quote: "Every scientist dreams of doing something that can help the world.", author: "Tu Youyou", mood: "uplifting", source: "https://www.nobelprize.org/stories/women-who-changed-science/tu-youyou/" },
  { quote: "Whatever inspiration is, it’s born from a continuous “I don’t know.”", author: "Wisława Szymborska", mood: "uplifting", source: "https://www.nobelprize.org/prizes/literature/1996/szymborska/lecture/" },
  { quote: "No mud, no lotus.", author: "Thich Nhat Hanh", mood: "uplifting", source: "https://plumvillage.org/books/no-mud-no-lotus" },
  { quote: "My life is my message.", author: "Mahatma Gandhi", mood: "uplifting", source: "https://gandhiheritageportal.org/stamps-on-mahatma-gandhi" },
  { quote: "Peace at home, peace in the world.", author: "Mustafa Kemal Atatürk", mood: "uplifting", source: "https://www.mfa.gov.tr/turkish-foreign-policy-during-ataturks-era.en.mfa" },
  { quote: "The secret of our success is that we never, never give up.", author: "Wilma Mankiller", mood: "uplifting", source: "https://www.ihs.gov/sites/nursing/themes/responsive2017/display_objects/documents/2022DNSaccomplishments.pdf" },
  { quote: "What you do makes a difference. And you have to decide what difference you want to make.", author: "Jane Goodall", mood: "uplifting", source: "https://janegoodall.org/wp-content/uploads/2023-JGI-USA-Impact-Highlights-Final.pdf" },
  { quote: "The end of all education should surely be service to others.", author: "César Chávez", mood: "uplifting", source: "https://chavezfoundation.org/wp-content/uploads/2023/02/CCF-OurVoice_23.pdf" },
  { quote: "Every moment is an organizing opportunity, every person a potential activist, every minute a chance to change the world.", author: "Dolores Huerta", mood: "uplifting", source: "https://doloreshuerta.org/protect-our-communities/" },
  { quote: "Do your little bit of good where you are.", author: "Desmond Tutu", mood: "uplifting", source: "https://tutu.org.za/news/be-the-light-a-call-for-support" },
  { quote: "Success can only come to you by courageous devotion to the task lying in front of you.", author: "C. V. Raman", mood: "uplifting", source: "https://www.presidentofindia.gov.in/dr-apj-abdul-kalam/speeches/address-first-convocation-defence-institute-advanced-technology-diat" },
  { quote: "It is not important to be better than someone else, but to be better than yesterday.", author: "Jigoro Kano", mood: "uplifting", source: "https://www.ijf.org/news/show/5-things-to-look-out-for-during-the-antalya-grand-slam-2021" },
  { quote: "Once you choose hope, anything’s possible.", author: "Christopher Reeve", mood: "uplifting", source: "https://www.christopherreeve.org/" },
  { quote: "Let us globalise compassion.", author: "Kailash Satyarthi", mood: "uplifting", source: "Nobel Lecture, 10 December 2014" },
  { quote: "Knowledge is power. Information is liberating.", author: "Kofi Annan", mood: "uplifting", source: "https://2021-2025.state.gov/wp-content/uploads/2024/05/ACPD-May-2024-QM-Transcript-Final.pdf" },
  { quote: "Knowing what must be done does away with fear.", author: "Rosa Parks", mood: "uplifting", source: "https://memory.loc.gov/static/portals/families/documents/RememberingRosaParks.pdf" },
  { quote: "No great thing is created suddenly.", author: "Epictetus", mood: "uplifting", source: "Discourses, book I, chapter 15" },
  { quote: "Faith is the bird that feels the light and sings when the dawn is still dark.", author: "Rabindranath Tagore", mood: "uplifting", source: "Fireflies, poem 191" },
  { quote: "You must do the thing you think you cannot do.", author: "Eleanor Roosevelt", mood: "uplifting", source: "https://www.fdrlibrary.org/eleanor-roosevelt" },
  { quote: "If there is no struggle, there is no progress.", author: "Frederick Douglass", mood: "uplifting", source: "West India Emancipation speech, 3 August 1857" },
  { quote: "One today is worth two tomorrows.", author: "Benjamin Franklin", mood: "uplifting", source: "The Way to Wealth (1758)" },
  { quote: "Make each day your masterpiece.", author: "John Wooden", mood: "uplifting", source: "https://www.coachwooden.com/memory-wall" },
  { quote: "The best way out is always through.", author: "Robert Frost", mood: "uplifting", source: "A Servant to Servants, North of Boston (1914)" },
  { quote: "For great things do not just happen by impulse but are a succession of small things linked together.", author: "Vincent van Gogh", mood: "uplifting", source: "https://www.webexhibits.org/vangogh/letter/11/237.htm" },
  { quote: "Be a rainbow in someone else’s cloud.", author: "Maya Angelou", mood: "uplifting", source: "https://www.mayaangelou.com/dr-maya-angelou-be-a-rainbow-in-someone-elses-cloud-oprahs-master-class-own/" },
  { quote: "The beginning is always today.", author: "Mary Shelley", mood: "uplifting", source: "https://www.penguin.co.uk/discover/articles/best-new-year-beginning-quotes-authors-books-literature" },
  { quote: "Nothing is impossible to a willing heart.", author: "John Heywood", mood: "uplifting", source: "A Dialogue of Proverbs (1546)" },
  { quote: "Fortune favors the bold.", author: "Virgil", mood: "uplifting", source: "Aeneid, book X, line 284 (translation)" },
  { quote: "While there is life, there is hope.", author: "Cicero", mood: "uplifting", source: "Letters to Atticus, IX.10 (translation)" },
  { quote: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca", mood: "uplifting", source: "Moral Letters to Lucilius, letter 101 (translation)" },
  { quote: "The journey of a thousand miles begins with one step.", author: "Lao Tzu", mood: "uplifting", source: "Tao Te Ching, chapter 64 (translation)" },
  { quote: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche", mood: "uplifting", source: "Twilight of the Idols, Maxims and Arrows, 12 (translation)" },
  { quote: "Write it on your heart that every day is the best day in the year.", author: "Ralph Waldo Emerson", mood: "uplifting", source: "Works and Days, Society and Solitude (1870)" },
  { quote: "Forever is composed of nows.", author: "Emily Dickinson", mood: "uplifting", source: "Poem 624 (Johnson numbering)" },
  { quote: "There is no charm equal to tenderness of heart.", author: "Jane Austen", mood: "uplifting", source: "Emma, chapter 24 (1815)" },
  { quote: "To thine own self be true.", author: "William Shakespeare", mood: "uplifting", source: "Hamlet, act I, scene 3" },
  { quote: "Every noble work is at first impossible.", author: "Thomas Carlyle", mood: "uplifting", source: "Past and Present, book III, chapter 11 (1843)" },
  { quote: "Dreams are the touchstones of our characters.", author: "Henry David Thoreau", mood: "uplifting", source: "A Week on the Concord and Merrimack Rivers (1849)" },
  { quote: "Many things can wait. Children cannot.", author: "Gabriela Mistral", mood: "uplifting", source: "https://content.govdelivery.com/attachments/UKHOUNSLOW/2025/06/12/file_attachments/3291253/Booklet%20BabyRoom.pdf" },
  { quote: "One child, one teacher, one pen and one book can change the world.", author: "Malala Yousafzai", mood: "uplifting", source: "https://malala.org/news-and-voices/malala-un-speech" },
  { quote: "Do your best. But like it!", author: "Katherine Johnson", mood: "uplifting", source: "https://science.nasa.gov/people/katherine-johnson/" },
  { quote: "To understand is essential to progress.", author: "Helen Keller", mood: "uplifting", source: "https://afb.org/about-afb/history/helen-keller/quotes/helen-keller-quotes-progress" },
  { quote: "I will do the best I can.", author: "Wangari Maathai", mood: "uplifting", source: "https://www.greenbeltmovement.org/be-a-hummingbird/" },
  { quote: "One person can change the world.", author: "Rosa Parks", mood: "uplifting", source: "https://memory.loc.gov/static/portals/families/documents/RememberingRosaParks.pdf" },
  { quote: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson", mood: "uplifting", source: "Poem 254 (Johnson numbering)" },
  { quote: "We know what we are, but know not what we may be.", author: "William Shakespeare", mood: "uplifting", source: "Hamlet, act IV, scene 5" },
  { quote: "The creation of a thousand forests is in one acorn.", author: "Ralph Waldo Emerson", mood: "uplifting", source: "History, Essays: First Series (1841)" },
  { quote: "The secret of getting ahead is getting started.", author: "", mood: "uplifting", source: "https://quoteinvestigator.com/2018/02/03/start/ (anonymous; not Mark Twain)" },
  { quote: "It is never too late to be what you might have been.", author: "", mood: "uplifting", source: "https://quoteinvestigator.com/2013/11/24/never-too-late/ (unverified author; not George Eliot)" },
  { quote: "Better late than never.", author: "", mood: "uplifting", source: "Traditional English proverb" },
];

// Mix the collection once so neighbouring days also cover different backgrounds.
export const BROWSER_DAILY_QUOTES: readonly BrowserDailyQuote[] = [...INSPIRATIONAL_BROWSER_QUOTES]
  .sort((a, b) => stableHash(a.quote) - stableHash(b.quote));

export function browserQuoteAuthor(entry: Pick<BrowserDailyQuote, "author">): string {
  return entry.author.trim() || "Unnamed";
}

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
  // Local calendar days keep the quote stable across tabs and daylight-saving changes.
  // Walk the whole collection before repeating instead of forcing a different mood.
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  const rotation = candidates.length ? candidates : BROWSER_DAILY_QUOTES;
  const index = ((day + stableHash(ownerKey)) % rotation.length + rotation.length) % rotation.length;
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
