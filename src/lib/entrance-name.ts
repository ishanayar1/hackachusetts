// Readable names for MBTA station doors (GTFS location_type 2 stop names).
// Raw names look like "1 | Boston Common (Elevator)", "Columbia Rd", "101 Arch St, Summer St",
// "Sydney St (North)", "Elevator, Boylston St" or the synthetic "Kent Street (street level)".
// cleanEntranceName turns them into "Boston Common elevator entrance", "Columbia Rd entrance",
// "101 Arch St / Summer St entrance", "Sydney St north entrance", "Boylston St elevator entrance"
// and "Street-level entrance".

/** Words that describe how the door is reached or which side it is on; they go just before "entrance". */
const MODIFIER_WORDS: Record<string, string> = {
  elevator: 'elevator',
  elevators: 'elevator',
  escalator: 'escalator',
  escalators: 'escalator',
  ramp: 'ramp',
  ramps: 'ramp',
  stairs: 'stairs',
  stair: 'stairs',
  stairway: 'stairs',
  lobby: 'lobby',
  north: 'north',
  south: 'south',
  east: 'east',
  west: 'west',
  northside: 'north side',
  southside: 'south side',
  eastside: 'east side',
  westside: 'west side',
  northbound: 'northbound',
  southbound: 'southbound',
  eastbound: 'eastbound',
  westbound: 'westbound',
  inbound: 'inbound',
  outbound: 'outbound',
};
/** Access words that may appear as a list item ("Elevator, Boylston St") or a trailing word ("Ocean Ave North Elevator"). */
const ACCESS_ITEM = /^(elevators?|escalators?|ramps?|stairs)$/i;
const TRAILING_ACCESS = /^(.*\S)\s+(elevators?|escalators?|ramps?|stairs)$/i;

const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The MBTA door number from a raw name ("4 | Tremont St" -> "4"), or null. Used to tell same-named doors apart. */
export function doorNumber(raw: string | null | undefined): string | null {
  const m = (raw ?? '').trim().match(/^(\d+)\s*\|/);
  return m ? m[1] : null;
}

/** "street level", or only modifier words ("Westbound ramp", "East stairs"): the normalized phrase, else null. */
function modifierPhrase(q: string): string | null {
  const t = q.trim().toLowerCase();
  if (t === 'street level' || t === 'street-level') return 'street-level';
  const words = t.split(/\s+/).filter(Boolean);
  if (!words.length || !words.every((w) => w in MODIFIER_WORDS)) return null;
  return words.map((w) => MODIFIER_WORDS[w]).join(' ');
}

/**
 * A readable door name: the street or landmark, then how it is reached, then "entrance" (or "exit").
 * The "N | " door number prefix is dropped, comma lists become "A / B", access words in parentheses or
 * in the list move before "entrance", and other parentheses stay as a trailing note.
 */
export function cleanEntranceName(raw: string | null | undefined, stationName?: string, kind: 'entrance' | 'exit' = 'entrance'): string {
  let s = (raw ?? '').replace(/\s+/g, ' ').trim().replace(/^\d+\s*\|\s*/, '');
  if (!s) return stationName ? `${stationName} ${kind}` : capFirst(kind);
  // Already clean (ends with entrance/exit): leave it alone.
  if (/\b(entrance|exit)$/i.test(s)) return s;

  const mods: string[] = [];
  const notes: string[] = [];
  for (let m = s.match(/\s*\(([^()]*)\)\s*$/); m && m.index !== undefined; m = s.match(/\s*\(([^()]*)\)\s*$/)) {
    const q = m[1].trim();
    s = s.slice(0, m.index).trim();
    if (!q) continue;
    const mod = modifierPhrase(q);
    if (mod) mods.unshift(mod);
    else notes.unshift(q);
  }

  let items = s.split(',').map((x) => x.trim()).filter(Boolean);
  const accessMods: string[] = [];
  items = items.flatMap((item) => {
    if (ACCESS_ITEM.test(item)) {
      accessMods.push(MODIFIER_WORDS[item.toLowerCase()] ?? item.toLowerCase());
      return [];
    }
    const t = item.match(TRAILING_ACCESS);
    if (t) {
      accessMods.push(MODIFIER_WORDS[t[2].toLowerCase()] ?? t[2].toLowerCase());
      return [t[1]];
    }
    // A side qualifier inside the list: "Massachusetts Ave (West), Buses" -> "Massachusetts Ave west / Buses".
    const p = item.match(/^(.*\S)\s*\(([^()]*)\)$/);
    const pm = p && modifierPhrase(p[2]);
    if (p && pm) return [`${p[1]} ${pm}`];
    return [item.replace(/^(drop-off\/pick-up|pick-up\/drop-off)$/i, 'pick-up and drop-off')];
  });
  for (const m of accessMods) if (!mods.includes(m)) mods.push(m);

  if (items.length === 1 && /^street$/i.test(items[0])) {
    items = [];
    if (!mods.includes('street-level')) mods.unshift('street-level');
  } else {
    items = items.map((i) => (/^street$/i.test(i) ? 'Street level' : i));
  }
  if (items.length === 1 && /^buses$/i.test(items[0])) items = ['Bus'];
  // The synthetic street-level door of a surface stop is named after the station itself.
  if (stationName && mods.includes('street-level') && items.join(', ').toLowerCase() === stationName.trim().toLowerCase()) items = [];

  const base = items.map(capFirst).join(' / ');
  let out = [base, ...mods].filter(Boolean).join(' ');
  out = out ? `${capFirst(out)} ${kind}` : stationName ? `${stationName} ${kind}` : capFirst(kind);
  if (notes.length) out += ` (${notes.join(', ')})`;
  return out;
}
