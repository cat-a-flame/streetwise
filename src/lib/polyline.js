// Google encoded polyline -> [[lat, lon], ...]
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lat / factor, lon / factor]);
  }
  return out;
}
