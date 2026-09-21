// The actions offered when you long-press (or right-click) a point on the map.
// The URL building is pure so it can be unit-tested.

export function clampLat(lat) {
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Leaflet reports longitudes outside [-180, 180] once you pan across the date
 * line. Values already in range are returned untouched: the modulo arithmetic
 * below perturbs them in the last decimal places.
 */
export function wrapLng(lng) {
  if (lng >= -180 && lng <= 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** "48.856600,2.352200" — the form every maps URL wants. */
export function coordPair(lat, lng, decimals = 6) {
  return `${clampLat(lat).toFixed(decimals)},${wrapLng(lng).toFixed(decimals)}`;
}

/** Friendlier form for showing on screen. */
export function formatCoords(lat, lng, decimals = 5) {
  return `${clampLat(lat).toFixed(decimals)}°, ${wrapLng(lng).toFixed(decimals)}°`;
}

/** Which native map app to offer alongside Google Maps. */
export function detectPlatform(ua = '', platform = '', maxTouchPoints = 0) {
  const s = `${ua} ${platform}`;
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Mac/i.test(s)) return maxTouchPoints > 1 ? 'ios' : 'mac'; // iPadOS 13+ claims to be a Mac
  if (/Android/i.test(s)) return 'android';
  return 'other';
}

/**
 * Links for one map point, best first. `external` marks the http(s) ones that
 * should open in a new tab; custom schemes have to navigate in place.
 */
export function navigationLinks(lat, lng, platform = 'other') {
  const q = coordPair(lat, lng);
  const links = [
    {
      id: 'walk',
      label: 'Walking directions',
      href: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`,
      external: true,
    },
    {
      id: 'gmaps',
      label: 'Open in Google Maps',
      href: `https://www.google.com/maps/search/?api=1&query=${q}`,
      external: true,
    },
  ];
  if (platform === 'ios' || platform === 'mac') {
    links.push({ id: 'apple', label: 'Open in Apple Maps', href: `https://maps.apple.com/?ll=${q}&q=Dropped+pin`, external: false });
  }
  if (platform === 'android') {
    links.push({ id: 'geo', label: 'Open in another map app', href: `geo:${q}?q=${q}`, external: false });
  }
  return links;
}
