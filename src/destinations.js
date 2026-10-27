// Fixed places to reach from the inspected location. Coordinates are looked up once
// through Nominatim (first matching query wins) and cached in the browser; the
// resolved address is shown in the panel so a wrong match is easy to spot.
export const DESTINATIONS = [
  { id: 'bitrise', name: 'Bitrise Hungary', short: 'B', queries: ['Hamzsabégi út 37, 1114 Budapest'] },
  { id: 'dunakeszi-vasutallomas', name: 'Dunakeszi vasútállomás', short: 'V', queries: ['Dunakeszi vasútállomás', 'Dunakeszi vasútállomás, Dunakeszi'] },
  { id: 'babicz', name: 'Dr. Babicz Béla utca 2-6', short: 'D', queries: ['Dr. Babicz Béla utca 2-6, Dunakeszi', 'Dr. Babicz Béla utca 2-6'] },
];
