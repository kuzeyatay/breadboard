// Shared data for PaintPomodoro. Artworks are public-domain masterpieces served
// as direct upload.wikimedia.org image URLs (verified reachable) so a painting
// always renders — no external API call at request time, no redirects.

export interface Artwork {
  id: string;
  title: string;
  artist: string;
  date: string;
  department: string;
  medium: string;
  culture: string;
  dimensions: string;
  imageUrl: string;
  sourceUrl: string;
  credit: string;
}

export const PUBLIC_DOMAIN_ARTWORKS: Artwork[] = [
  {
    id: "starry-night",
    title: "The Starry Night",
    artist: "Vincent van Gogh",
    date: "1889",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "Dutch",
    dimensions: "73.7 cm × 92.1 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    credit: "The Museum of Modern Art",
  },
  {
    id: "great-wave",
    title: "Under the Wave off Kanagawa (The Great Wave)",
    artist: "Katsushika Hokusai",
    date: "c. 1830–32",
    department: "Asian Art",
    medium: "Woodblock print (ink and color on paper)",
    culture: "Japanese",
    dimensions: "25.7 cm × 37.9 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/1280px-The_Great_Wave_off_Kanagawa.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:The_Great_Wave_off_Kanagawa.jpg",
    credit: "The Metropolitan Museum of Art",
  },
  {
    id: "pearl-earring",
    title: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    date: "c. 1665",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "Dutch",
    dimensions: "44.5 cm × 39 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/1665_Girl_with_a_Pearl_Earring.jpg/1280px-1665_Girl_with_a_Pearl_Earring.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg",
    credit: "Mauritshuis, The Hague",
  },
  {
    id: "water-lilies",
    title: "Water Lilies",
    artist: "Claude Monet",
    date: "1906",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "French",
    dimensions: "89.9 cm × 94.1 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg/1280px-Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg",
    credit: "Art Institute of Chicago",
  },
  {
    id: "birth-of-venus",
    title: "The Birth of Venus",
    artist: "Sandro Botticelli",
    date: "c. 1485",
    department: "European Paintings",
    medium: "Tempera on canvas",
    culture: "Italian (Florentine)",
    dimensions: "172.5 cm × 278.9 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg/1280px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg",
    credit: "Uffizi Gallery, Florence",
  },
  {
    id: "mona-lisa",
    title: "Mona Lisa",
    artist: "Leonardo da Vinci",
    date: "c. 1503–1519",
    department: "European Paintings",
    medium: "Oil on poplar panel",
    culture: "Italian",
    dimensions: "77 cm × 53 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/1280px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg",
    credit: "Musée du Louvre, Paris",
  },
  {
    id: "the-scream",
    title: "The Scream",
    artist: "Edvard Munch",
    date: "1893",
    department: "European Paintings",
    medium: "Oil, tempera and pastel on cardboard",
    culture: "Norwegian",
    dimensions: "91 cm × 73 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/1280px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Edvard_Munch,_1893,_The_Scream,_oil,_tempera_and_pastel_on_cardboard,_91_x_73_cm,_National_Gallery_of_Norway.jpg",
    credit: "National Gallery of Norway",
  },
  {
    id: "american-gothic",
    title: "American Gothic",
    artist: "Grant Wood",
    date: "1930",
    department: "American Paintings",
    medium: "Oil on beaverboard",
    culture: "American",
    dimensions: "78 cm × 65.3 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg/1280px-Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg",
    credit: "Art Institute of Chicago",
  },
  {
    id: "night-watch",
    title: "The Night Watch",
    artist: "Rembrandt van Rijn",
    date: "1642",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "Dutch",
    dimensions: "363 cm × 437 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/The_Nightwatch_by_Rembrandt_-_Rijksmuseum.jpg/1280px-The_Nightwatch_by_Rembrandt_-_Rijksmuseum.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:The_Nightwatch_by_Rembrandt_-_Rijksmuseum.jpg",
    credit: "Rijksmuseum, Amsterdam",
  },
  {
    id: "wanderer",
    title: "Wanderer above the Sea of Fog",
    artist: "Caspar David Friedrich",
    date: "c. 1818",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "German",
    dimensions: "94.8 cm × 74.8 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg/1280px-Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg",
    credit: "Hamburger Kunsthalle",
  },
  {
    id: "grande-jatte",
    title: "A Sunday on La Grande Jatte",
    artist: "Georges Seurat",
    date: "1884–1886",
    department: "European Paintings",
    medium: "Oil on canvas",
    culture: "French",
    dimensions: "207.5 cm × 308.1 cm",
    imageUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg/1280px-A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884.jpg",
    credit: "Art Institute of Chicago",
  },
];

export function randomArtwork(excludeId?: string): Artwork {
  const pool = excludeId
    ? PUBLIC_DOMAIN_ARTWORKS.filter((art) => art.id !== excludeId)
    : PUBLIC_DOMAIN_ARTWORKS;
  const list = pool.length > 0 ? pool : PUBLIC_DOMAIN_ARTWORKS;
  return list[Math.floor(Math.random() * list.length)];
}
