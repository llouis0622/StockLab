import {STOCK_MAP, DAY_MS, EPOCH, HISTORY, TICK_MS, priceAt, quote, fxRate, toMinor, fromMinor, simTime, tickTime} from './market.js';
export const FEE_RATE = 0.0005;
export const FX_SPREAD = 0.001;
const uid = () => globalThis.crypto.randomUUID();
export const feeFor = (amount) => Math.ceil(amount * FEE_RATE);
const clone = value => structuredClone(value);
export function newAccount(username, now = Date.now()) {
  return {schema:1, username, createdAt:now, initialCapital:10000000, cash:{KRW:10000000,USD:0}, holdings:{}, orders:[], trades:[], exchanges:[],
    watchlist:['KR001','KR002','KR003','US001','US002'], journal:{}, lessons:[], equity:[], lastSeen:now};
}
export function reservedCash(account, currency, exceptId) {
  return account.orders.filter(o => o.status === 'pending' && o.side === 'buy' && o.currency === currency && o.id !== exceptId)
    .reduce((sum,o) => sum + o.limitMinor * o.qty + feeFor(o.limitMinor * o.qty), 0);
}
export const availableCash = (a,c,exceptId) => a.cash[c] - reservedCash(a,c,exceptId);
export function availableShares(a, stockId, exceptId) {
  return (a.holdings[stockId]?.qty || 0) - a.orders.filter(o => o.status === 'pending' && o.side === 'sell' && o.stockId === stockId && o.id !== exceptId).reduce((n,o) => n + o.qty, 0);
}
function validateOrder(a, input, now) {
  const stock = STOCK_MAP.get(input.stockId);
  if (!stock || !['buy','sell'].includes(input.side) || !['market','limit'].includes(input.type)) throw new Error('주문 정보를 확인해주세요.');
  if (!Number.isSafeInteger(input.qty) || input.qty < 1 || input.qty > 1000000) throw new Error('수량은 1주 이상의 정수로 입력해주세요.');
  const current = toMinor(priceAt(stock, now),stock.currency);
  const price = input.type === 'limit' ? toMinor(Number(input.limitPrice), stock.currency) : current;
  if (!Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(price * input.qty)) throw new Error('주문 가격을 확인해주세요.');
  if (input.side === 'buy' && price * input.qty + feeFor(price * input.qty) > availableCash(a,stock.currency)) throw new Error(stock.currency === 'USD' ? '달러 주문 가능 금액이 부족합니다. 먼저 환전해주세요.' : '원화 주문 가능 금액이 부족합니다.');
  if (input.side === 'sell' && input.qty > availableShares(a,stock.id)) throw new Error('매도 가능한 보유 수량이 부족합니다.');
  return {stock, price, current};
}
function fill(a, o, priceMinor, at) {
  const gross = priceMinor * o.qty, fee = feeFor(gross), stockId = o.stockId;
  let realized = 0;
  if (o.side === 'buy') {
    if (gross + fee > availableCash(a,o.currency,o.id)) return false;
    const h = a.holdings[stockId] || {qty:0,cost:0};
    h.qty += o.qty; h.cost += gross + fee; a.holdings[stockId] = h; a.cash[o.currency] -= gross + fee;
  } else {
    const h = a.holdings[stockId]; if (!h || availableShares(a,stockId,o.id) < o.qty) return false;
    const soldCost = o.qty === h.qty ? h.cost : Math.round(h.cost * o.qty / h.qty);
    realized = gross - fee - soldCost; h.qty -= o.qty; h.cost -= soldCost;
    if (!h.qty) delete a.holdings[stockId]; a.cash[o.currency] += gross - fee;
  }
  o.status = 'filled'; o.filledAt = at; o.fillPriceMinor = priceMinor;
  a.trades.push({id:o.id,stockId,side:o.side,qty:o.qty,currency:o.currency,priceMinor,gross,fee,realized,at,note:o.note || ''});
  return true;
}
export function placeOrder(account, input, now = Date.now()) {
  const a = processOrders(account,now).account;
  if (input.type === 'limit' && a.orders.filter(o => o.status === 'pending').length >= 30) throw new Error('대기 주문은 최대 30개까지 등록할 수 있습니다.');
  const {stock, price, current} = validateOrder(a,input,now);
  const end = EPOCH + (Math.floor(simTime(now)) + 1 - HISTORY) * DAY_MS;
  const o = {id:uid(),stockId:stock.id,currency:stock.currency,side:input.side,type:input.type,qty:input.qty,limitMinor:price,
    status:'pending',createdAt:now,expiresAt:end,checkedAt:tickTime(now),note:String(input.note || '').slice(0,500)};
  a.orders.push(o);
  if (o.type === 'market' || (o.side === 'buy' ? current <= price : current >= price)) {
    if (!fill(a,o,current,now)) throw new Error('주문 가능 금액 또는 수량이 변경됐습니다. 다시 확인해주세요.');
  }
  snapshot(a,now); return {account:a,order:o};
}
export function processOrders(account, now = Date.now()) {
  const a = clone(account); let changed = false;
  const pending = a.orders.filter(o=>o.status==='pending').sort((x,y)=>x.createdAt-y.createdAt);
  if (!pending.length) return {account:a,changed:false};
  const first = Math.min(...pending.map(o=>o.checkedAt+TICK_MS));
  const last = Math.min(tickTime(now),Math.max(...pending.map(o=>o.expiresAt)));
  // DAY orders expire within 30 real minutes, so replay is bounded to 360 ticks.
  for (let at = first; at <= last; at += TICK_MS) {
    for (const o of pending) {
      if (o.status !== 'pending' || at <= o.checkedAt || at < o.createdAt) continue;
      if (at >= o.expiresAt) { o.status = 'expired'; changed = true; continue; }
      const p = toMinor(priceAt(o.stockId,at),o.currency);
      if (o.side === 'buy' ? p <= o.limitMinor : p >= o.limitMinor) {
        if (!fill(a,o,p,at)) o.status = 'rejected'; changed = true;
      }
      o.checkedAt = at;
    }
  }
  for (const o of pending) {
    if (o.status === 'pending' && now >= o.expiresAt) {o.status='expired';changed=true;}
  }
  if (changed) snapshot(a,now);
  return {account:a,changed};
}
export function cancelOrder(account, id) {
  const a = clone(account), o = a.orders.find(o=>o.id===id && o.status==='pending');
  if (!o) throw new Error('이미 처리된 주문입니다.'); o.status='cancelled'; return a;
}
export function exchange(account, direction, amount, now = Date.now()) {
  const a = clone(account), rate = fxRate(now), currency = direction === 'toUSD' ? 'KRW' : 'USD';
  if (!['toUSD','toKRW'].includes(direction)) throw new Error('환전 방향을 확인해주세요.');
  const debit = toMinor(Number(amount),currency);
  if (!Number.isSafeInteger(debit) || debit <= 0 || debit > availableCash(a,currency)) throw new Error('환전 가능한 금액을 확인해주세요.');
  const credit = direction === 'toUSD' ? Math.floor(debit / (rate * (1 + FX_SPREAD)) * 100) : Math.floor(debit / 100 * rate * (1 - FX_SPREAD));
  if (credit < 1) throw new Error('환전 금액이 너무 적습니다.');
  a.cash[currency] -= debit; a.cash[direction==='toUSD'?'USD':'KRW'] += credit;
  a.exchanges.push({id:uid(),direction,debit,credit,rate,at:now}); snapshot(a,now); return a;
}
export function portfolio(a, now = Date.now()) {
  const fx = fxRate(now), krw = (v,c) => c === 'USD' ? v / 100 * fx : v;
  const holdings = Object.entries(a.holdings).map(([id,h])=>{
    const stock = STOCK_MAP.get(id), price = toMinor(priceAt(stock,now),stock.currency), value = h.qty * price;
    return {...h,stock,price,value,profit:value-h.cost,percent:(value/h.cost-1)*100,krw:krw(value,stock.currency)};
  });
  const cash = a.cash.KRW + a.cash.USD/100*fx, assets = holdings.reduce((s,h)=>s+h.krw,0);
  const total = cash + assets;
  return {holdings,cash,assets,total,profit:total-a.initialCapital,percent:(total/a.initialCapital-1)*100,
    unrealized:holdings.reduce((s,h)=>s+krw(h.profit,h.stock.currency),0),
    realized:a.trades.reduce((s,t)=>s+krw(t.realized,t.currency),0),fx};
}
export function snapshot(a, now = Date.now()) {
  const value = Math.round(portfolio(a,now).total), last = a.equity.at(-1);
  if (last && now - last.at < 10000) {last.at=now;last.value=value;} else a.equity.push({at:now,value});
  if (a.equity.length>1000) a.equity = a.equity.filter((_,i)=>i%2===0);
  a.lastSeen=now;
}
export function validateAccount(a) {
  if (!a || a.schema!==1 || !/^[a-z0-9_]{3,20}$/.test(a.username) || a.initialCapital!==10000000 || !a.cash || !a.holdings) throw new Error('지원하지 않는 프로필 데이터입니다.');
  for (const currency of ['KRW','USD']) if (!Number.isSafeInteger(a.cash[currency]) || a.cash[currency]<0) throw new Error('잔고 데이터가 올바르지 않습니다.');
  for (const [id,h] of Object.entries(a.holdings)) if (!STOCK_MAP.has(id) || !Number.isSafeInteger(h.qty) || h.qty<1 || !Number.isSafeInteger(h.cost) || h.cost<0) throw new Error('보유 종목 데이터가 올바르지 않습니다.');
  for (const key of ['orders','trades','exchanges','watchlist','lessons','equity']) if (!Array.isArray(a[key]) || a[key].length>100000) throw new Error('프로필 형식을 확인해주세요.');
  if (!a.journal || typeof a.journal!=='object') throw new Error('매매일지 형식을 확인해주세요.');
  for (const o of a.orders) if (!STOCK_MAP.has(o.stockId) || !['pending','filled','cancelled','expired','rejected'].includes(o.status) || !['buy','sell'].includes(o.side) || !['market','limit'].includes(o.type) || !Number.isSafeInteger(o.qty) || o.qty<=0 || !Number.isSafeInteger(o.limitMinor) || o.limitMinor<=0 || !Number.isFinite(o.createdAt) || !Number.isFinite(o.checkedAt) || !Number.isFinite(o.expiresAt) || o.expiresAt-o.createdAt>DAY_MS+1 || o.expiresAt<o.createdAt || o.checkedAt<o.createdAt-TICK_MS) throw new Error('주문 데이터가 올바르지 않습니다.');
  for (const t of a.trades) if (!STOCK_MAP.has(t.stockId) || !Number.isSafeInteger(t.qty) || t.qty<=0 || !Number.isSafeInteger(t.priceMinor) || t.priceMinor<=0 || !Number.isFinite(t.at)) throw new Error('거래 내역이 올바르지 않습니다.');
  if (a.watchlist.some(id=>!STOCK_MAP.has(id))) throw new Error('관심 종목 데이터가 올바르지 않습니다.');
  for (const c of ['KRW','USD']) if (availableCash(a,c)<0) throw new Error('예약 금액이 잔고를 초과합니다.');
  for (const id of new Set(a.orders.filter(o=>o.status==='pending'&&o.side==='sell').map(o=>o.stockId))) if (availableShares(a,id)<0) throw new Error('예약 수량이 보유 수량을 초과합니다.');
  return a;
}
