// Category vocabulary, and its translation into OpenStreetMap tags.
//
// The agent picks from a fixed list of words; the service turns each into the
// real OSM selectors an Overpass query needs. Keeping the translation here is
// what stops a model from inventing a tag — an unknown category is rejected
// with the list of the ones that exist rather than guessed at.

export interface CategoryDefinition {
  /** The word the agent and the UI use. */
  id: string;
  label: string;
  /** Overpass tag selectors, e.g. `["amenity"="restaurant"]`. ORed together. */
  selectors: string[];
}

export const POI_CATEGORIES: readonly CategoryDefinition[] = [
  { id: "restaurant", label: "Restaurants", selectors: ['["amenity"="restaurant"]'] },
  { id: "cafe", label: "Cafés", selectors: ['["amenity"="cafe"]'] },
  { id: "bar", label: "Bars", selectors: ['["amenity"="bar"]', '["amenity"="pub"]'] },
  { id: "fast_food", label: "Fast food", selectors: ['["amenity"="fast_food"]'] },
  { id: "bakery", label: "Bakeries", selectors: ['["shop"="bakery"]'] },
  { id: "hospital", label: "Hospitals", selectors: ['["amenity"="hospital"]', '["amenity"="clinic"]'] },
  { id: "pharmacy", label: "Pharmacies", selectors: ['["amenity"="pharmacy"]'] },
  { id: "doctor", label: "Doctors", selectors: ['["amenity"="doctors"]'] },
  { id: "dentist", label: "Dentists", selectors: ['["amenity"="dentist"]'] },
  { id: "supermarket", label: "Supermarkets", selectors: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  { id: "bowling", label: "Bowling", selectors: ['["leisure"="bowling_alley"]', '["sport"="10pin"]'] },
  { id: "cinema", label: "Cinemas", selectors: ['["amenity"="cinema"]'] },
  { id: "theatre", label: "Theatres", selectors: ['["amenity"="theatre"]'] },
  { id: "museum", label: "Museums", selectors: ['["tourism"="museum"]'] },
  { id: "gallery", label: "Galleries", selectors: ['["tourism"="gallery"]'] },
  { id: "park", label: "Parks", selectors: ['["leisure"="park"]', '["leisure"="garden"]'] },
  { id: "playground", label: "Playgrounds", selectors: ['["leisure"="playground"]'] },
  { id: "gym", label: "Gyms", selectors: ['["leisure"="fitness_centre"]', '["amenity"="gym"]'] },
  { id: "hotel", label: "Hotels", selectors: ['["tourism"="hotel"]', '["tourism"="hostel"]', '["tourism"="guest_house"]'] },
  { id: "fuel", label: "Fuel stations", selectors: ['["amenity"="fuel"]'] },
  { id: "charging_station", label: "EV charging", selectors: ['["amenity"="charging_station"]'] },
  { id: "parking", label: "Parking", selectors: ['["amenity"="parking"]'] },
  { id: "atm", label: "ATMs", selectors: ['["amenity"="atm"]'] },
  { id: "bank", label: "Banks", selectors: ['["amenity"="bank"]'] },
  { id: "post_office", label: "Post offices", selectors: ['["amenity"="post_office"]'] },
  { id: "police", label: "Police", selectors: ['["amenity"="police"]'] },
  { id: "school", label: "Schools", selectors: ['["amenity"="school"]'] },
  { id: "university", label: "Universities", selectors: ['["amenity"="university"]', '["amenity"="college"]'] },
  { id: "library", label: "Libraries", selectors: ['["amenity"="library"]'] },
  { id: "place_of_worship", label: "Places of worship", selectors: ['["amenity"="place_of_worship"]'] },
  { id: "toilets", label: "Toilets", selectors: ['["amenity"="toilets"]'] },
  { id: "bus_stop", label: "Bus stops", selectors: ['["highway"="bus_stop"]'] },
  { id: "train_station", label: "Train stations", selectors: ['["railway"="station"]', '["railway"="halt"]'] },
  { id: "subway_station", label: "Metro stations", selectors: ['["station"="subway"]'] },
  { id: "airport", label: "Airports", selectors: ['["aeroway"="aerodrome"]'] },
  { id: "shop", label: "Shops", selectors: ['["shop"]'] },
  { id: "viewpoint", label: "Viewpoints", selectors: ['["tourism"="viewpoint"]'] },
  { id: "attraction", label: "Attractions", selectors: ['["tourism"="attraction"]', '["tourism"="theme_park"]'] },
];

const BY_ID = new Map(POI_CATEGORIES.map((category) => [category.id, category]));

export const POI_CATEGORY_IDS: readonly string[] = POI_CATEGORIES.map(
  (category) => category.id,
);

export function findCategory(value: unknown): CategoryDefinition | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return BY_ID.get(key) ?? null;
}

/**
 * The OSM key/value a POI carries, folded back to one of our category words so
 * a returned record and a requested category speak the same vocabulary. Returns
 * the raw `key=value` when nothing matches, which is honest rather than tidy.
 */
export function categoryForTags(tags: Record<string, string>): string | undefined {
  for (const category of POI_CATEGORIES) {
    for (const selector of category.selectors) {
      const match = /^\["([^"]+)"(?:="([^"]+)")?\]$/.exec(selector);
      if (!match) continue;
      const [, key, value] = match;
      if (value === undefined) {
        if (tags[key]) return category.id;
      } else if (tags[key] === value) {
        return category.id;
      }
    }
  }
  for (const key of ["amenity", "shop", "leisure", "tourism", "railway", "aeroway", "office"]) {
    if (tags[key]) return `${key}=${tags[key]}`;
  }
  return undefined;
}
