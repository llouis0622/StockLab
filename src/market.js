// Stateless, reproducible synthetic prices. All values and companies are fictional.
export const DAY_MS = 30 * 60 * 1000;
export const TICK_MS = 5000;
export const EPOCH = Date.UTC(2026, 9, 24);
export const HISTORY = 120;
export const SECTORS = [
  ['반도체', 'Semiconductors', '#b8a4ff'], ['소프트웨어', 'Software', '#8bb5ff'],
  ['바이오', 'Biotech', '#71d8bc'], ['에너지', 'Energy', '#d4e77d'],
  ['모빌리티', 'Mobility', '#ffb880'], ['금융', 'Finance', '#95aaf0'],
  ['소비재', 'Consumer', '#f4a7c4'], ['미디어', 'Media', '#ba9bf4'],
  ['산업재', 'Industrials', '#a2b5bf'], ['통신', 'Telecom', '#80cad4']
];

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); return (h ^ h >>> 16) >>> 0;
}
export const uniform = (key) => (hash(key) + 0.5) / 4294967296;
const normal = (key) => Math.sqrt(-2 * Math.log(uniform(key + ':a'))) * Math.cos(2 * Math.PI * uniform(key + ':b'));
const noise = (key, time, period) => {
  const p = time / period, n = Math.floor(p), u = p - n, blend = u * u * (3 - 2 * u);
  return normal(key + ':' + n) * (1 - blend) + normal(key + ':' + (n + 1)) * blend;
};

const krPrefixes = ['새온', '루미', '한결', '다온', '누리', '이든', '라온', '해솔', '가온', '온유', '시온', '하람', '아람', '마루', '별하'];
const enPrefixes = ['Aster', 'Lumina', 'Vela', 'Northstar', 'Cedar', 'Orbit', 'Kestrel', 'Solace', 'Atlas', 'Ember', 'Halo', 'Meridian', 'Juniper', 'Vanta', 'Zephyr'];
const krEnds = ['반도체', '소프트', '바이오', '에너지', '모빌리티', '파이낸스', '라이프', '미디어', '인더스트리', '텔레콤'];
const enEnds = ['Silicon', 'Systems', 'Bioscience', 'Energy', 'Motors', 'Capital', 'Living', 'Media', 'Industries', 'Networks'];
export const STOCKS = ['KR', 'US'].flatMap(market => Array.from({length: 150}, (_, i) => {
  const sector = i % 10, group = Math.floor(i / 10), id = `${market}${String(i + 1).padStart(3, '0')}`;
  const basePrice = market === 'KR' ? Math.round((8000 + uniform(id) * 212000) / 100) * 100 : Math.round((15 + uniform(id) * 385) * 100) / 100;
  return Object.freeze({id, market, sector, currency: market === 'KR' ? 'KRW' : 'USD',
    name: market === 'KR' ? krPrefixes[group] + krEnds[sector] : enPrefixes[group] + ' ' + enEnds[sector],
    shortName: market === 'KR' ? krPrefixes[group] : enPrefixes[group],
    basePrice, beta: 0.5 + uniform(id + 'beta') * 1.1, volatility: 0.6 + uniform(id + 'vol') * 1.1,
    pe: Math.round(8 + uniform(id + 'pe') * 40), cap: Math.round(2 + uniform(id + 'cap') * 98),
    color: SECTORS[sector][2], risk: uniform(id + 'vol') > 0.65 ? '높음' : uniform(id + 'vol') > 0.25 ? '보통' : '낮음'});
}));
export const STOCK_MAP = new Map(STOCKS.map(s => [s.id, s]));
export function simTime(now = Date.now()) { return HISTORY + (now - EPOCH) / DAY_MS; }
export function tickTime(now = Date.now()) { return Math.floor(now / TICK_MS) * TICK_MS; }
export function simDay(now = Date.now()) { return Math.floor(simTime(now)) - HISTORY + 1; }
export function simLabel(now) {
  const t = simTime(now), mins = Math.floor((t - Math.floor(t)) * 1440);
  return `D${Math.floor(t) - HISTORY + 1} · ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export function eventFor(day, market = 'KR') {
  const key = `event:${market}:${day}`, sector = Math.floor(uniform(key + 'sector') * 10);
  const positive = uniform(key + 'sign') > 0.46;
  const magnitude = (0.018 + uniform(key + 'size') * 0.045) * (positive ? 1 : -1);
  const start = day + 0.18 + uniform(key + 'start') * 0.65;
  return {id: key, market, sector, magnitude, start, positive,
    title: `${SECTORS[sector][0]} 업종, ${positive ? ['신규 수요 확대', '기술 혁신 기대', '실적 전망 상향'][day % 3 < 0 ? 0 : day % 3] : ['원가 부담 증가', '수요 둔화 우려', '공급망 차질'][day % 3 < 0 ? 0 : day % 3]}`,
    detail: positive ? '관련 기업에 대한 기대가 높아지며 업종 전반에 매수 심리가 유입됩니다.' : '업종에 대한 우려가 커지며 관련 기업의 가격 변동성이 높아집니다.'};
}
export function marketNews(now = Date.now()) {
  const t = simTime(now), day = Math.floor(t), events = [];
  for (let d = day; d >= day - 4; d--) for (const m of ['KR', 'US']) {
    const event = eventFor(d, m); if (event.start <= t) events.push({...event, at: EPOCH + (event.start - HISTORY) * DAY_MS});
  }
  return events.sort((a,b) => b.start - a.start).slice(0, 4);
}

function rawPrice(stock, t) {
  // Correlated market and sector factors, changing volatility, idiosyncratic
  // multiscale noise, and decaying event shocks. Not an exchange price model.
  const regime = 0.8 + 0.4 * Math.max(0, noise('regime:' + stock.market, t, 9));
  const broad = 0.065 * noise('macro:' + stock.market, t, 16) + 0.03 * noise('market:' + stock.market, t, 2.2);
  const sector = 0.048 * noise('sector:' + stock.market + stock.sector, t, 6) + 0.018 * noise('industry:' + stock.sector, t, 0.7);
  const own = 0.065 * noise(stock.id + 'long', t, 30) + 0.032 * noise(stock.id + 'mid', t, 2.5)
    + 0.013 * noise(stock.id + 'short', t, 0.22) + 0.0045 * noise(stock.id + 'micro', t, 0.017);
  let shock = 0;
  for (let d = Math.floor(t); d >= Math.floor(t) - 5; d--) {
    const e = eventFor(d, stock.market), age = t - e.start;
    if (age >= 0) shock += e.magnitude * (e.sector === stock.sector ? 1 : 0.08) * Math.exp(-age / 2);
  }
  return stock.basePrice * Math.exp(broad * stock.beta + sector + own * stock.volatility * regime + shock);
}
export function priceAt(stockOrId, now = Date.now()) {
  const stock = typeof stockOrId === 'string' ? STOCK_MAP.get(stockOrId) : stockOrId;
  if (!stock || !Number.isFinite(now)) throw new Error('유효하지 않은 종목 또는 시간입니다.');
  const v = rawPrice(stock, simTime(tickTime(now))), scale = stock.currency === 'USD' ? 100 : 1;
  return Math.max(1 / scale, Math.round(v * scale) / scale);
}
export const toMinor = (amount, currency) => Math.round(amount * (currency === 'USD' ? 100 : 1));
export const fromMinor = (amount, currency) => amount / (currency === 'USD' ? 100 : 1);
export function quote(stock, now = Date.now()) {
  const price = priceAt(stock, now), t = simTime(now);
  const openAt = EPOCH + (Math.floor(t) - HISTORY) * DAY_MS;
  const open = priceAt(stock, openAt);
  return {price, open, change: (price / open - 1) * 100, at: tickTime(now)};
}
export function fxRate(now = Date.now()) {
  const t = simTime(tickTime(now));
  return Math.round(1380 * Math.exp(0.03 * noise('fx-long', t, 30) + 0.006 * noise('fx-short', t, 1.8)) * 100) / 100;
}
export function candles(stock, range = '1D', now = Date.now()) {
  const span = ({'1D':1, '1W':7, '1M':30, '3M':90})[range] || 1, count = range === '3M' ? 90 : 60;
  const end = tickTime(now), step = span * DAY_MS / count;
  return Array.from({length: count}, (_, i) => {
    const at = end - (count - 1 - i) * step;
    const samples = Array.from({length:5}, (_, j) => priceAt(stock, at - step + step * j / 4));
    return {at, open:samples[0], close:samples[4], high:Math.max(...samples), low:Math.min(...samples),
      volume:Math.round((500 + uniform(stock.id + ':' + Math.floor(at / step)) * 16000) * (1 + Math.abs(samples[4] / samples[0] - 1) * 80))};
  });
}
export function marketIndex(market, now = Date.now()) {
  const stocks = STOCKS.filter(s => s.market === market);
  return stocks.reduce((sum, s) => sum + priceAt(s, now) / s.basePrice, 0) / stocks.length * 1000;
}
