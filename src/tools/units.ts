/**
 * Unit conversion, because nothing else here can do it.
 *
 * `What is 32 fahrenheit in celsius` reaches no skill on purpose — searching for
 * it verbatim answers nothing — and the calculator refuses it, correctly, since
 * a conversion is not arithmetic. So the model was left to do it in its head,
 * which is the one thing this app has measured it doing badly and confidently.
 *
 * The table is deliberately finite. Every unit here is one somebody asks about
 * in a sentence; anything whose conversion depends on a second quantity is left
 * out rather than guessed at, which is why grams to cups fails and fuel
 * consumption is absent altogether.
 */

export type Dimension = 'length' | 'mass' | 'temperature' | 'volume' | 'speed' | 'area' | 'data' | 'time'

interface Unit {
  dimension: Dimension
  /** How the result names it, which is not always how the user wrote it. */
  label: string
  /** Multiplier onto the dimension's base unit. Temperature carries none. */
  factor: number
}

/**
 * The base of each dimension is the SI unit where there is one: metre, kilogram,
 * litre, metre per second, square metre, byte, second. Temperature is converted
 * through degrees Celsius by hand, since a scale with an offset has no factor.
 */
const UNITS: Record<string, Unit> = {
  // Length, base metre.
  mm: { dimension: 'length', label: 'mm', factor: 0.001 },
  cm: { dimension: 'length', label: 'cm', factor: 0.01 },
  dm: { dimension: 'length', label: 'dm', factor: 0.1 },
  m: { dimension: 'length', label: 'm', factor: 1 },
  km: { dimension: 'length', label: 'km', factor: 1000 },
  inch: { dimension: 'length', label: 'in', factor: 0.0254 },
  ft: { dimension: 'length', label: 'ft', factor: 0.3048 },
  yd: { dimension: 'length', label: 'yd', factor: 0.9144 },
  mi: { dimension: 'length', label: 'mi', factor: 1609.344 },
  nmi: { dimension: 'length', label: 'nmi', factor: 1852 },

  // Mass, base kilogram. A stone is 14 pounds and is still how a British
  // question states a body weight.
  mg: { dimension: 'mass', label: 'mg', factor: 0.000001 },
  g: { dimension: 'mass', label: 'g', factor: 0.001 },
  kg: { dimension: 'mass', label: 'kg', factor: 1 },
  t: { dimension: 'mass', label: 't', factor: 1000 },
  oz: { dimension: 'mass', label: 'oz', factor: 0.028349523125 },
  lb: { dimension: 'mass', label: 'lb', factor: 0.45359237 },
  st: { dimension: 'mass', label: 'st', factor: 6.35029318 },

  // Temperature. `factor` is unused and set to 1 so the type stays one shape.
  celsius: { dimension: 'temperature', label: '°C', factor: 1 },
  fahrenheit: { dimension: 'temperature', label: '°F', factor: 1 },
  kelvin: { dimension: 'temperature', label: 'K', factor: 1 },

  // Volume, base litre. The US gallon and its subdivisions, because the
  // questions that use them are written in American recipes and forecasts; the
  // imperial gallon differs by a fifth and would be a wrong answer, so it is
  // named separately rather than merged.
  ml: { dimension: 'volume', label: 'ml', factor: 0.001 },
  cl: { dimension: 'volume', label: 'cl', factor: 0.01 },
  l: { dimension: 'volume', label: 'l', factor: 1 },
  m3: { dimension: 'volume', label: 'm³', factor: 1000 },
  floz: { dimension: 'volume', label: 'fl oz', factor: 0.0295735295625 },
  cup: { dimension: 'volume', label: 'cup', factor: 0.2365882365 },
  pt: { dimension: 'volume', label: 'pt', factor: 0.473176473 },
  qt: { dimension: 'volume', label: 'qt', factor: 0.946352946 },
  gal: { dimension: 'volume', label: 'gal', factor: 3.785411784 },
  impgal: { dimension: 'volume', label: 'imp gal', factor: 4.54609 },
  tbsp: { dimension: 'volume', label: 'tbsp', factor: 0.01478676478125 },
  tsp: { dimension: 'volume', label: 'tsp', factor: 0.00492892159375 },

  // Speed, base metre per second.
  mps: { dimension: 'speed', label: 'm/s', factor: 1 },
  kmh: { dimension: 'speed', label: 'km/h', factor: 1 / 3.6 },
  mph: { dimension: 'speed', label: 'mph', factor: 0.44704 },
  kn: { dimension: 'speed', label: 'kn', factor: 0.514444444444 },

  // Area, base square metre.
  cm2: { dimension: 'area', label: 'cm²', factor: 0.0001 },
  m2: { dimension: 'area', label: 'm²', factor: 1 },
  km2: { dimension: 'area', label: 'km²', factor: 1000000 },
  ha: { dimension: 'area', label: 'ha', factor: 10000 },
  acre: { dimension: 'area', label: 'acre', factor: 4046.8564224 },
  sqft: { dimension: 'area', label: 'sq ft', factor: 0.09290304 },
  sqmi: { dimension: 'area', label: 'sq mi', factor: 2589988.110336 },

  // Data, base byte. Decimal and binary both, because a disk is sold in one and
  // reported in the other, and that gap is exactly what gets asked about. Bits
  // are left out: `Mb` and `MB` differ by a factor of eight and by one letter's
  // case, which the model's own output cannot be trusted to preserve.
  byte: { dimension: 'data', label: 'bytes', factor: 1 },
  kb: { dimension: 'data', label: 'kB', factor: 1000 },
  mb: { dimension: 'data', label: 'MB', factor: 1000000 },
  gb: { dimension: 'data', label: 'GB', factor: 1000000000 },
  tb: { dimension: 'data', label: 'TB', factor: 1000000000000 },
  kib: { dimension: 'data', label: 'KiB', factor: 1024 },
  mib: { dimension: 'data', label: 'MiB', factor: 1048576 },
  gib: { dimension: 'data', label: 'GiB', factor: 1073741824 },
  tib: { dimension: 'data', label: 'TiB', factor: 1099511627776 },

  // Duration, base second. It stops at a week: a month is not a fixed length
  // and a year is only one to four decimal places, so both would be answers
  // that look exact and are not.
  ms: { dimension: 'time', label: 'ms', factor: 0.001 },
  s: { dimension: 'time', label: 's', factor: 1 },
  min: { dimension: 'time', label: 'min', factor: 60 },
  h: { dimension: 'time', label: 'h', factor: 3600 },
  d: { dimension: 'time', label: 'd', factor: 86400 },
  week: { dimension: 'time', label: 'weeks', factor: 604800 },
}

/**
 * Every spelling the model or the user might arrive with, mapped to a unit id.
 *
 * German is in here for the same reason the skills have German triggers: the app
 * answers in the language it was asked in, and a 0.8B model passes the word the
 * user wrote straight through as the argument.
 */
const ALIASES: Record<string, string> = {
  // Length
  millimeter: 'mm',
  millimetre: 'mm',
  millimeters: 'mm',
  zentimeter: 'cm',
  centimeter: 'cm',
  centimetre: 'cm',
  centimeters: 'cm',
  centimetres: 'cm',
  dezimeter: 'dm',
  meter: 'm',
  metre: 'm',
  meters: 'm',
  metres: 'm',
  kilometer: 'km',
  kilometre: 'km',
  kilometers: 'km',
  kilometres: 'km',
  kilometern: 'km',
  in: 'inch',
  '"': 'inch',
  zoll: 'inch',
  inches: 'inch',
  foot: 'ft',
  feet: 'ft',
  fuss: 'ft',
  fuß: 'ft',
  "'": 'ft',
  yard: 'yd',
  yards: 'yd',
  mile: 'mi',
  miles: 'mi',
  meile: 'mi',
  meilen: 'mi',
  'nautical mile': 'nmi',
  'nautical miles': 'nmi',
  seemeile: 'nmi',

  // Mass
  milligram: 'mg',
  milligramm: 'mg',
  gram: 'g',
  gramm: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  kilo: 'kg',
  kilogram: 'kg',
  kilogramm: 'kg',
  kilograms: 'kg',
  kilogrammes: 'kg',
  tonne: 't',
  tonnes: 't',
  tonnen: 't',
  ton: 't',
  ounce: 'oz',
  ounces: 'oz',
  unze: 'oz',
  unzen: 'oz',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  pfund: 'lb',
  stone: 'st',
  stones: 'st',

  // Temperature
  c: 'celsius',
  '°c': 'celsius',
  celcius: 'celsius',
  grad: 'celsius',
  'grad celsius': 'celsius',
  f: 'fahrenheit',
  '°f': 'fahrenheit',
  'grad fahrenheit': 'fahrenheit',
  k: 'kelvin',

  // Volume
  milliliter: 'ml',
  millilitre: 'ml',
  centiliter: 'cl',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  litres: 'l',
  'cubic meter': 'm3',
  'cubic metre': 'm3',
  kubikmeter: 'm3',
  'fluid ounce': 'floz',
  'fluid ounces': 'floz',
  'fl oz': 'floz',
  cups: 'cup',
  tasse: 'cup',
  tassen: 'cup',
  pint: 'pt',
  pints: 'pt',
  quart: 'qt',
  quarts: 'qt',
  gallon: 'gal',
  gallons: 'gal',
  gallone: 'gal',
  gallonen: 'gal',
  'imperial gallon': 'impgal',
  'imperial gallons': 'impgal',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  esslöffel: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  teelöffel: 'tsp',

  // Speed
  'm/s': 'mps',
  'meters per second': 'mps',
  'km/h': 'kmh',
  kph: 'kmh',
  'kilometers per hour': 'kmh',
  'kilometer pro stunde': 'kmh',
  stundenkilometer: 'kmh',
  'miles per hour': 'mph',
  'meilen pro stunde': 'mph',
  knot: 'kn',
  knots: 'kn',
  knoten: 'kn',

  // Area
  cm2: 'cm2',
  'cm²': 'cm2',
  'm²': 'm2',
  'square meter': 'm2',
  'square metre': 'm2',
  'square meters': 'm2',
  quadratmeter: 'm2',
  'km²': 'km2',
  'square kilometer': 'km2',
  quadratkilometer: 'km2',
  hectare: 'ha',
  hectares: 'ha',
  hektar: 'ha',
  acres: 'acre',
  'square foot': 'sqft',
  'square feet': 'sqft',
  'sq ft': 'sqft',
  ft2: 'sqft',
  'square mile': 'sqmi',
  'square miles': 'sqmi',
  quadratmeilen: 'sqmi',

  // Data
  b: 'byte',
  bytes: 'byte',
  kilobyte: 'kb',
  kilobytes: 'kb',
  megabyte: 'mb',
  megabytes: 'mb',
  gigabyte: 'gb',
  gigabytes: 'gb',
  terabyte: 'tb',
  terabytes: 'tb',
  kibibyte: 'kib',
  mebibyte: 'mib',
  gibibyte: 'gib',

  // Duration
  millisecond: 'ms',
  milliseconds: 'ms',
  millisekunden: 'ms',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  sekunde: 's',
  sekunden: 's',
  mins: 'min',
  minute: 'min',
  minutes: 'min',
  minuten: 'min',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  stunde: 'h',
  stunden: 'h',
  day: 'd',
  days: 'd',
  tag: 'd',
  tage: 'd',
  weeks: 'week',
  woche: 'week',
  wochen: 'week',
}

/** What a dimension is called when the failure has to name it. */
const DIMENSION_NAMES: Record<Dimension, string> = {
  length: 'a length',
  mass: 'a mass',
  temperature: 'a temperature',
  volume: 'a volume',
  speed: 'a speed',
  area: 'an area',
  data: 'an amount of data',
  time: 'a duration',
}

function resolve(raw: string): { id: string; unit: Unit } | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    // `°C`, `° C` and `degrees C` all name the same scale.
    .replace(/degrees?\s+/g, '')
    .replace(/°\s*/g, '°')
    .replace(/\.$/, '')
  const id = cleaned in UNITS ? cleaned : (ALIASES[cleaned] ?? ALIASES[cleaned.replace(/^°/, '')])
  const unit = id ? UNITS[id] : undefined
  return id && unit ? { id, unit } : null
}

/** Through degrees Celsius, since a scale with an offset has no factor. */
function toCelsius(value: number, from: string): number {
  if (from === 'fahrenheit') return ((value - 32) * 5) / 9
  if (from === 'kelvin') return value - 273.15
  return value
}

function fromCelsius(value: number, to: string): number {
  if (to === 'fahrenheit') return (value * 9) / 5 + 32
  if (to === 'kelvin') return value + 273.15
  return value
}

/**
 * Six significant digits, trailing zeros dropped.
 *
 * Enough that a conversion is not silently rounded into a different answer, few
 * enough that `8.04672 km` does not arrive as `8.046719999999999`.
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Result is not a finite number')
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1e15)) {
    return value.toExponential(4).replace(/e\+?/, 'e')
  }
  return String(Number(value.toPrecision(6)))
}

export interface ConversionRequest {
  value: number
  from: string
  to: string
}

/**
 * Reads a conversion out of whatever the model passed.
 *
 * The schema asks for three arguments and the exemplars show three, but a 0.8B
 * model also writes the whole phrase into one of them — `value: "5 miles to
 * km"`, or `from: "5 miles"`. Refusing that spends the round on a rejection
 * instead of an answer, and the phrase says exactly what was meant.
 */
export function readConversionRequest(args: Record<string, unknown>): ConversionRequest {
  const raw = (key: string): string => String(args[key] ?? '').trim()
  const parts = [raw('value'), raw('from'), raw('to')].filter(Boolean).join(' ')
  const explicitFrom = raw('from')
  const explicitTo = raw('to')

  // A number in `value` and units either side of it, wherever they arrived.
  const phrase =
    /(-?\d+(?:[.,]\d+)?)\s*([^\d]*?)\s*(?:\b(?:in|to|nach|as|into|umrechnen)\b|=|→)\s*(.+)$/i.exec(parts)

  if (phrase?.[1] && phrase[3]) {
    const from = (phrase[2] ?? '').trim()
    return {
      value: Number(phrase[1].replace(',', '.')),
      from: from || explicitFrom,
      to: phrase[3].trim(),
    }
  }

  const NUMBER = /-?\d+(?:[.,]\d+)?/
  const value = raw('value')
  const number = NUMBER.exec(value || parts)
  if (!number) throw new Error('value must be a number, for example 32')

  return {
    value: Number(number[0].replace(',', '.')),
    // `from` may carry the number it came with — `from: "5 miles"` — or be
    // missing entirely because the unit went into `value`.
    from: explicitFrom.replace(NUMBER, '').trim() || value.replace(NUMBER, '').trim(),
    to: explicitTo,
  }
}

/**
 * Converts, or says plainly why it will not.
 *
 * A refusal is fed back into the model's context as the whole result of a spent
 * round, so each one names what went wrong in terms the next attempt can act
 * on. Guessing would be worse: grams to cups depends on what is in the cup, and
 * an answer that looks exact and is not is the failure this tool exists to stop.
 */
export function convertQuantity(args: Record<string, unknown>): string {
  const request = readConversionRequest(args)
  if (!Number.isFinite(request.value)) throw new Error('value must be a number, for example 32')

  const from = resolve(request.from)
  const to = resolve(request.to)
  if (!from) throw new Error(`Unknown unit "${request.from || '(none)'}"`)
  if (!to) throw new Error(`Unknown unit "${request.to || '(none)'}"`)

  if (from.unit.dimension !== to.unit.dimension) {
    throw new Error(
      `${from.unit.label} is ${DIMENSION_NAMES[from.unit.dimension]} and ${to.unit.label} is ${DIMENSION_NAMES[to.unit.dimension]}, so one cannot be converted into the other.`,
    )
  }

  const converted =
    from.unit.dimension === 'temperature'
      ? fromCelsius(toCelsius(request.value, from.id), to.id)
      : (request.value * from.unit.factor) / to.unit.factor

  return `${formatQuantity(request.value)} ${from.unit.label} = ${formatQuantity(converted)} ${to.unit.label}`
}
