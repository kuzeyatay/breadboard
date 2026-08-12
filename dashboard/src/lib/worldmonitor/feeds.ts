// Ported from the worldmonitor clone (github.com/koala73/worldmonitor, AGPL-3.0)
// at `worldmonitor/` in this repo. The upstream app is a Vite/Preact SPA with a
// Convex backend; Breadboard runs the same intelligence model natively in the
// dashboard, so the data tables travel and the runtime is rewritten.

export interface Feed {
  name: string;
  url: string;
}

export interface FeedPanel {
  label: string;
  feeds: Feed[];
}

/**
 * The curated catalog, carried over from upstream's `FULL_FEEDS` (English
 * sources only). Upstream routes every URL through its own RSS proxy because it
 * fetches from the browser; here the fetch happens in the Next server, so the
 * publisher URLs are used directly.
 *
 * Declaration order is editorial: the first feed in a panel is its primary
 * source, which is what the per-panel fetch budget spends itself on first.
 */
export const FEED_PANELS: Record<string, FeedPanel> = {
  politics: {
    label: "World",
    feeds: [
      { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      { name: "Guardian World", url: "https://www.theguardian.com/world/rss" },
      { name: "AP News", url: "https://news.google.com/rss/search?q=site:apnews.com&hl=en-US&gl=US&ceid=US:en" },
      { name: "Reuters World", url: "https://news.google.com/rss/search?q=site:reuters.com+world&hl=en-US&gl=US&ceid=US:en" },
      { name: "CNN World", url: "https://news.google.com/rss/search?q=site:cnn.com+world+news+when:1d&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  us: {
    label: "United States",
    feeds: [
      { name: "Reuters US", url: "https://news.google.com/rss/search?q=site:reuters.com+US&hl=en-US&gl=US&ceid=US:en" },
      { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml" },
      { name: "PBS NewsHour", url: "https://www.pbs.org/newshour/feeds/rss/headlines" },
      { name: "ABC News", url: "https://feeds.abcnews.com/abcnews/topstories" },
      { name: "CBS News", url: "https://www.cbsnews.com/latest/rss/main" },
      { name: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/news" },
      { name: "Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSUSnews" },
      { name: "Politico", url: "https://rss.politico.com/politics-news.xml" },
      { name: "The Hill", url: "https://thehill.com/news/feed" },
      { name: "Axios", url: "https://api.axios.com/feed/" },
      { name: "Fox News", url: "https://moxie.foxnews.com/google-publisher/us.xml" },
      { name: "CBC News", url: "https://www.cbc.ca/webfeed/rss/rss-world" },
      { name: "Globe and Mail", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/?outputType=xml" },
      { name: "Global News", url: "https://globalnews.ca/feed/" },
    ],
  },
  europe: {
    label: "Europe",
    feeds: [
      { name: "France 24", url: "https://www.france24.com/en/rss" },
      { name: "EuroNews", url: "https://www.euronews.com/rss?format=xml" },
      { name: "Le Monde", url: "https://www.lemonde.fr/en/rss/une.xml" },
      { name: "DW News", url: "https://rss.dw.com/xml/rss-en-all" },
      { name: "Yle News", url: "https://yle.fi/rss/news" },
      { name: "NRK", url: "https://www.nrk.no/nyheter/siste.rss" },
      { name: "Aftenposten", url: "https://www.aftenposten.no/rss" },
      { name: "DR Nyheder", url: "https://www.dr.dk/nyheder/service/feeds/allenyheder" },
      { name: "Arctic Today", url: "https://news.google.com/rss/search?q=site:arctictoday.com+when:14d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Daily Sabah", url: "https://www.dailysabah.com/rss/home-page" },
      { name: "TVN24", url: "https://tvn24.pl/swiat.xml" },
      { name: "Rzeczpospolita", url: "https://www.rp.pl/rss_main" },
      { name: "Balkan Insight", url: "https://balkaninsight.com/feed/" },
      { name: "ERR News", url: "https://news.err.ee/rss" },
      { name: "LRT English", url: "https://www.lrt.lt/en/news-in-english?rss" },
      { name: "LSM English", url: "https://eng.lsm.lv/rss/" },
      { name: "Meduza", url: "https://meduza.io/rss/en/all" },
      { name: "TASS", url: "https://news.google.com/rss/search?q=site:tass.com+OR+TASS+Russia+when:1d&hl=en-US&gl=US&ceid=US:en" },
      { name: "RT", url: "https://www.rt.com/rss/" },
      { name: "RT Russia", url: "https://www.rt.com/rss/russia/" },
      { name: "Kyiv Independent", url: "https://news.google.com/rss/search?q=site:kyivindependent.com+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Ukrinform", url: "https://news.google.com/rss/search?q=site:ukrinform.net+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Suspilne", url: "https://news.google.com/rss/search?q=site:suspilne.media+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Ukrainska Pravda EN", url: "https://news.google.com/rss/search?q=site:euromaidanpress.com+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "NV EN", url: "https://news.google.com/rss/search?q=site:english.nv.ua+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Hromadske EN", url: "https://news.google.com/rss/search?q=site:hromadske.ua+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Moscow Times", url: "https://www.themoscowtimes.com/rss/news" },
      { name: "Civil.ge", url: "https://civil.ge/feed/" },
      { name: "OC Media", url: "https://oc-media.org/feed/" },
      { name: "JAMnews", url: "https://jam-news.net/feed/" },
      { name: "Azertag", url: "https://news.google.com/rss/search?q=site:azertag.az+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Armenpress", url: "https://news.google.com/rss/search?q=site:armenpress.am+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Zerkalo", url: "https://news.google.com/rss/search?q=site:zerkalo.io+when:2d&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  middleeast: {
    label: "Middle East",
    feeds: [
      { name: "BBC Middle East", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml" },
      { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
      { name: "Al Arabiya", url: "https://news.google.com/rss/search?q=site:english.alarabiya.net+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Guardian ME", url: "https://www.theguardian.com/world/middleeast/rss" },
      { name: "BBC Persian", url: "https://feeds.bbci.co.uk/persian/rss.xml" },
      { name: "Iran International", url: "https://news.google.com/rss/search?q=site:iranintl.com+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Fars News", url: "https://news.google.com/rss/search?q=site:farsnews.ir+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "IRNA", url: "https://en.irna.ir/rss" },
      { name: "Mehr News", url: "https://en.mehrnews.com/rss" },
      { name: "Haaretz", url: "https://news.google.com/rss/search?q=site:haaretz.com+when:7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx" },
      { name: "Ynetnews", url: "https://www.ynetnews.com/Integration/StoryRss3089.xml" },
      { name: "Arab News", url: "https://news.google.com/rss/search?q=site:arabnews.com+when:7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "The National", url: "https://news.google.com/rss/search?q=site:thenationalnews.com+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Oman Observer", url: "https://www.omanobserver.om/rssFeed/1" },
      { name: "Asharq Business", url: "https://asharqbusiness.com/rss.xml" },
      { name: "Rudaw", url: "https://news.google.com/rss/search?q=site:rudaw.net+when:7d&hl=en&gl=US&ceid=US:en" },
    ],
  },
  asia: {
    label: "Asia",
    feeds: [
      { name: "Asia News", url: "https://news.google.com/rss/search?q=(China+OR+Japan+OR+Korea+OR+India+OR+ASEAN)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "BBC Asia", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
      { name: "The Diplomat", url: "https://thediplomat.com/feed/" },
      { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed/" },
      { name: "Reuters Asia", url: "https://news.google.com/rss/search?q=site:reuters.com+(China+OR+Japan+OR+Taiwan+OR+Korea)+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Xinhua", url: "https://news.google.com/rss/search?q=site:xinhuanet.com+OR+Xinhua+when:1d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Japan Today", url: "https://japantoday.com/feed/atom" },
      { name: "Nikkei Asia", url: "https://news.google.com/rss/search?q=site:asia.nikkei.com+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
      { name: "Indian Express", url: "https://indianexpress.com/section/india/feed/" },
      { name: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-top-stories" },
      { name: "India News Network", url: "https://news.google.com/rss/search?q=India+diplomacy+foreign+policy+news&hl=en&gl=US&ceid=US:en" },
      { name: "CNA", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml" },
      { name: "ABC News Australia", url: "https://www.abc.net.au/news/feed/2942460/rss.xml" },
      { name: "Guardian Australia", url: "https://www.theguardian.com/australia-news/rss" },
      { name: "Island Times (Palau)", url: "https://islandtimes.org/feed/" },
      { name: "Eurasianet", url: "https://eurasianet.org/rss" },
      { name: "RFE/RL Central Asia", url: "https://news.google.com/rss/search?q=site:rferl.org+Central+Asia+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "The Astana Times", url: "https://astanatimes.com/feed/" },
      { name: "The Times of Central Asia", url: "https://timesca.com/feed/" },
      { name: "Focus Taiwan", url: "https://news.google.com/rss/search?q=site%3Afocustaiwan.tw%20when%3A3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Taipei Times", url: "https://news.google.com/rss/search?q=site%3Ataipeitimes.com%20when%3A3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Taiwan News", url: "https://news.google.com/rss/search?q=site%3Ataiwannews.com.tw%20when%3A3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Dawn", url: "https://www.dawn.com/feeds/home/" },
      { name: "Geo News", url: "https://news.google.com/rss/search?q=site:geo.tv+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Jakarta Post", url: "https://news.google.com/rss/search?q=site%3Athejakartapost.com%20when%3A3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Rappler", url: "https://www.rappler.com/feed/" },
      { name: "The Star (Malaysia)", url: "https://news.google.com/rss/search?q=site%3Athestar.com.my%20when%3A3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Irrawaddy", url: "https://www.irrawaddy.com/feed/" },
    ],
  },
  africa: {
    label: "Africa",
    feeds: [
      { name: "Africa News", url: "https://news.google.com/rss/search?q=(Africa+OR+Nigeria+OR+Kenya+OR+\"South+Africa\"+OR+Ethiopia)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Sahel Crisis", url: "https://news.google.com/rss/search?q=(Sahel+OR+Mali+OR+Niger+OR+\"Burkina+Faso\"+OR+Wagner)+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "News24", url: "https://feeds.news24.com/articles/news24/TopStories/rss" },
      { name: "BBC Africa", url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml" },
      { name: "Africanews", url: "https://www.africanews.com/feed/rss" },
      { name: "Premium Times", url: "https://www.premiumtimesng.com/feed" },
      { name: "Vanguard Nigeria", url: "https://www.vanguardngr.com/feed/" },
      { name: "Channels TV", url: "https://www.channelstv.com/feed/" },
      { name: "Daily Trust", url: "https://dailytrust.com/feed/" },
      { name: "ThisDay", url: "https://www.thisdaylive.com/feed" },
      { name: "Radio Tamazuj", url: "https://www.radiotamazuj.org/en/feed" },
      { name: "The Reporter Ethiopia", url: "https://www.thereporterethiopia.com/feed/" },
      { name: "Ethiopia Insight", url: "https://www.ethiopia-insight.com/feed/" },
      { name: "Dabanga Sudan", url: "https://www.dabangasudan.org/en/feed" },
      { name: "Hiiraan Online", url: "https://news.google.com/rss/search?q=site%3Ahiiraan.com%20when%3A7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "MyJoyOnline", url: "https://www.myjoyonline.com/feed/" },
      { name: "Citi Newsroom", url: "https://news.google.com/rss/search?q=site%3Acitinewsroom.com%20when%3A7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "RFI Afrique", url: "https://www.rfi.fr/en/africa/rss" },
    ],
  },
  latam: {
    label: "Latin America",
    feeds: [
      { name: "Latin America", url: "https://news.google.com/rss/search?q=(Brazil+OR+Mexico+OR+Argentina+OR+Venezuela+OR+Colombia)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "BBC Latin America", url: "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml" },
      { name: "Reuters LatAm", url: "https://news.google.com/rss/search?q=site:reuters.com+(Brazil+OR+Mexico+OR+Argentina)+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Guardian Americas", url: "https://www.theguardian.com/world/americas/rss" },
      { name: "La Silla Vacía", url: "https://www.lasillavacia.com/rss" },
      { name: "Mexico News Daily", url: "https://mexiconewsdaily.com/feed/" },
      { name: "Mexico Security", url: "https://news.google.com/rss/search?q=(Mexico+cartel+OR+Mexico+violence+OR+Mexico+troops+OR+narco+Mexico)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "AP Mexico", url: "https://news.google.com/rss/search?q=site:apnews.com+Mexico+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "InSight Crime", url: "https://insightcrime.org/feed/" },
      { name: "France 24 LatAm", url: "https://www.france24.com/en/americas/rss" },
    ],
  },
  crisis: {
    label: "Crisis & Health",
    feeds: [
      { name: "CrisisWatch", url: "https://www.crisisgroup.org/rss" },
      { name: "IAEA", url: "https://www.iaea.org/feeds/topnews" },
      { name: "WHO", url: "https://www.who.int/rss-feeds/news-english.xml" },
      { name: "UNHCR", url: "https://news.google.com/rss/search?q=site:unhcr.org+OR+UNHCR+refugees+when:3d&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  gov: {
    label: "Official",
    feeds: [
      { name: "White House", url: "https://news.google.com/rss/search?q=site:whitehouse.gov&hl=en-US&gl=US&ceid=US:en" },
      { name: "State Dept", url: "https://news.google.com/rss/search?q=site:state.gov+OR+\"State+Department\"&hl=en-US&gl=US&ceid=US:en" },
      { name: "Pentagon", url: "https://news.google.com/rss/search?q=site:defense.gov+OR+Pentagon&hl=en-US&gl=US&ceid=US:en" },
      { name: "Treasury", url: "https://news.google.com/rss/search?q=site:treasury.gov+OR+\"Treasury+Department\"&hl=en-US&gl=US&ceid=US:en" },
      { name: "DOJ", url: "https://news.google.com/rss/search?q=site:justice.gov+OR+\"Justice+Department\"+DOJ&hl=en-US&gl=US&ceid=US:en" },
      { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
      { name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss" },
      { name: "CDC", url: "https://news.google.com/rss/search?q=site:cdc.gov+OR+CDC+health&hl=en-US&gl=US&ceid=US:en" },
      { name: "FEMA", url: "https://news.google.com/rss/search?q=site:fema.gov+OR+FEMA+emergency&hl=en-US&gl=US&ceid=US:en" },
      { name: "DHS", url: "https://news.google.com/rss/search?q=site:dhs.gov+OR+\"Homeland+Security\"&hl=en-US&gl=US&ceid=US:en" },
      { name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml" },
      { name: "CISA", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml" },
    ],
  },
  thinktanks: {
    label: "Analysis",
    feeds: [
      { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/" },
      { name: "Atlantic Council", url: "https://www.atlanticcouncil.org/feed/" },
      { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml" },
      { name: "CSIS", url: "https://news.google.com/rss/search?q=site:csis.org+when:7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "RAND", url: "https://www.rand.org/pubs/articles.xml" },
      { name: "Brookings", url: "https://news.google.com/rss/search?q=site:brookings.edu+when:7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Carnegie", url: "https://news.google.com/rss/search?q=site:carnegieendowment.org+when:7d&hl=en-US&gl=US&ceid=US:en" },
      { name: "War on the Rocks", url: "https://warontherocks.com/feed" },
      { name: "Responsible Statecraft", url: "https://responsiblestatecraft.org/feed/" },
      { name: "RUSI", url: "https://news.google.com/rss/search?q=site:rusi.org+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "FPRI", url: "https://www.fpri.org/feed/" },
      { name: "Jamestown", url: "https://jamestown.org/feed/" },
      { name: "ISW", url: "https://news.google.com/rss/search?q=site:understandingwar.org+when:2d&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  /**
   * Climate and weather. Not an upstream panel — upstream reads the
   * environment only as whatever the world desks happen to run — so this one is
   * assembled here: the climate desks that cover the slow story (Carbon Brief,
   * Climate Home, Yale, Grist, Copernicus), the wires for the day's news, and
   * the severe-weather watchers for the acute end. The first six are the
   * primaries, which is what a default-depth refresh spends its budget on.
   */
  climate: {
    label: "Climate & Weather",
    feeds: [
      { name: "Guardian Climate", url: "https://www.theguardian.com/environment/climate-crisis/rss" },
      { name: "Reuters Climate", url: "https://news.google.com/rss/search?q=site:reuters.com+(climate+OR+\"global+warming\"+OR+emissions)&hl=en-US&gl=US&ceid=US:en" },
      { name: "BBC Science & Environment", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
      { name: "Guardian Environment", url: "https://www.theguardian.com/environment/rss" },
      { name: "AP Climate", url: "https://news.google.com/rss/search?q=site:apnews.com+(climate+OR+wildfire+OR+heatwave+OR+flooding)&hl=en-US&gl=US&ceid=US:en" },
      { name: "Carbon Brief", url: "https://www.carbonbrief.org/feed" },
      { name: "Climate Home News", url: "https://www.climatechangenews.com/feed/" },
      { name: "Yale Climate Connections", url: "https://yaleclimateconnections.org/feed/" },
      { name: "Extreme Weather", url: "https://news.google.com/rss/search?q=(heatwave+OR+\"record+heat\"+OR+\"flash+flood\"+OR+cyclone+OR+typhoon+OR+wildfire)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Severe Weather Europe", url: "https://www.severe-weather.eu/feed/" },
      { name: "The Watchers", url: "https://watchers.news/feed/" },
      { name: "Grist", url: "https://grist.org/feed/" },
      { name: "Copernicus", url: "https://climate.copernicus.eu/rss.xml" },
      { name: "Phys.org Earth", url: "https://phys.org/rss-feed/earth-news/" },
      { name: "Mongabay", url: "https://news.mongabay.com/feed/" },
      { name: "UNEP", url: "https://www.unep.org/rss.xml" },
    ],
  },
  energy: {
    label: "Energy",
    feeds: [
      { name: "Oil & Gas", url: "https://news.google.com/rss/search?q=(oil+price+OR+OPEC+OR+\"natural+gas\"+OR+pipeline+OR+LNG)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Nuclear Energy", url: "https://news.google.com/rss/search?q=(\"nuclear+energy\"+OR+\"nuclear+power\"+OR+uranium+OR+IAEA)+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Reuters Energy", url: "https://news.google.com/rss/search?q=site:reuters.com+(oil+OR+gas+OR+energy+OR+OPEC)+when:3d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Mining & Resources", url: "https://news.google.com/rss/search?q=(lithium+OR+\"rare+earth\"+OR+cobalt+OR+mining)+when:3d&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  finance: {
    label: "Markets",
    feeds: [
      { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
      { name: "MarketWatch", url: "https://news.google.com/rss/search?q=site:marketwatch.com+markets+when:1d&hl=en-US&gl=US&ceid=US:en" },
      { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
      { name: "Financial Times", url: "https://www.ft.com/rss/home" },
      { name: "Reuters Business", url: "https://news.google.com/rss/search?q=site:reuters.com+business+markets&hl=en-US&gl=US&ceid=US:en" },
    ],
  },
  tech: {
    label: "Technology",
    feeds: [
      { name: "Hacker News", url: "https://hnrss.org/frontpage" },
      { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/technology-lab" },
      { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
      { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/" },
    ],
  },
  ai: {
    label: "AI",
    feeds: [
      { name: "AI News", url: "https://news.google.com/rss/search?q=(OpenAI+OR+Anthropic+OR+Google+AI+OR+\"large+language+model\"+OR+ChatGPT)+when:2d&hl=en-US&gl=US&ceid=US:en" },
      { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
      { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
      { name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
      { name: "ArXiv AI", url: "https://export.arxiv.org/rss/cs.AI" },
    ],
  },
};

export const PANEL_IDS = Object.keys(FEED_PANELS);

export function panelLabel(panelId: string): string {
  return FEED_PANELS[panelId]?.label ?? panelId;
}

export function allFeeds(): Array<Feed & { panel: string }> {
  return PANEL_IDS.flatMap((panel) =>
    FEED_PANELS[panel]!.feeds.map((feed) => ({ ...feed, panel })),
  );
}
