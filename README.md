# Streetwise

Budapesti lakókörnyék-felmérő lakáskereséshez. Statikus Vite + vanilla JS app (Leaflet, OpenStreetMap), Netlify-ra telepíthető.

## Fejlesztés

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # elemzés- és segédfüggvény-tesztek
npm run build      # dist/
```

## Funkciók

- 23 kerület (OSM `admin_level=9`), címkézve, kattintható
- Keresés (Nominatim, Budapestre korlátozva, debounce + gyorsítótár, max. 1 kérés/s) és kattintás a térképen
- Környék-elemzés Overpass API-val: legközelebbi bolt, megállók vonalszámokkal, zöld pontszám, közvilágítás, kerületi bűnügyi alapadat
- Saját helyek: tetszik / nem tetszik / semleges + megjegyzés, utca, pont vagy rajzolt terület; localStorage + JSON export/import

## Adatok

- `public/data/district-safety.json`: kerületi bűnügyi alapadat, **1000 lakosra vetítve**. Jelenleg minden érték `null` (nincs kitöltve), töltsd ki a `crimePer1000` mezőket, az `year`, `source` és `cityAverage` mezőket.
- `public/data/districts.geojson` (opcionális): `npm run fetch:districts` letölti a kerülethatárokat, így az app nem kérdezi le őket induláskor az Overpassról. Ha nincs fájl, az app lekérdezi és IndexedDB-ben tárolja 30 napig.

## Hogyan számol

- **Gyaloglási táv**: légvonal × 1,3 (becslés), 80 m/perc.
- **Zöldfelület**: a 400 m-es kör 20 m-es rácspontjainak hány %-a esik OSM zöld poligonba (park, kert, gyep, erdő, ...).
- **Zöld pontszám** (0–10): 50% zöldfelület (30% felett teljes), 30% fák száma (150 felett teljes), 20% a legközelebbi park távolsága. Az `src/analysis.js` `SCORE` konstansaiban állítható.
- **Közvilágítás**: 300 m-en belüli utak hosszából a `lit=yes` aránya a `lit` címkével rendelkezők között, a címkézettség mellett kijelezve.
- **Gyorsítótár**: Overpass-válaszok IndexedDB-ben, ~100 m-es rácsra kerekítve, 7 napig; Nominatim-válaszok localStorage-ban.

Az OSM adatai hiányosak lehetnek (főleg fák és `lit` címkék), az eredmény tájékoztató jellegű.

## Netlify

Overpass is called through `netlify/functions/overpass.mjs` (`/api/overpass`). Serverless functions have a time limit (10 s on many plans), so the area lookup is split into four small queries and the relay gives up after 9 s (`OVERPASS_BUDGET_MS` env var). If you raise the function timeout in the Netlify UI, raise `OVERPASS_BUDGET_MS` too.
