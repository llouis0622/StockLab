import test from 'node:test';
import assert from 'node:assert/strict';
import {STOCKS,STOCK_MAP,DAY_MS,TICK_MS,EPOCH,HISTORY,priceAt,quote,candles,simTime,toMinor,fxRate,marketNews} from '../src/market.js';
import {newAccount,placeOrder,processOrders,cancelOrder,exchange,portfolio,availableCash,availableShares,feeFor,validateAccount} from '../src/trading.js';
const NOW=EPOCH+DAY_MS*8+DAY_MS*.3;

test('300 fictional companies have unique IDs/names, 150 per market',()=>{
  assert.equal(STOCKS.length,300);assert.equal(new Set(STOCKS.map(s=>s.id)).size,300);assert.equal(new Set(STOCKS.map(s=>s.name)).size,300);
  assert.equal(STOCKS.filter(s=>s.market==='KR').length,150);assert.equal(STOCKS.filter(s=>s.market==='US').length,150);
});
test('prices are reproducible, strictly positive, and have currency precision',()=>{
  for(const s of STOCKS){for(const offset of [-120,0,1,30,365]){const at=NOW+DAY_MS*offset,a=priceAt(s,at);assert.equal(a,priceAt(s.id,at));assert.ok(Number.isFinite(a)&&a>0);assert.equal(toMinor(a,s.currency),Math.round(a*(s.currency==='USD'?100:1)));}}
  const changes=STOCKS.map(s=>quote(s,NOW).change);assert.ok(changes.some(c=>c<0));assert.ok(changes.some(c=>c>0));
  assert.ok(new Set(changes.map(c=>c.toFixed(2))).size>50);
});
test('candles contain valid OHLC samples with no future timestamp',()=>{
  for(const range of ['1D','1W','1M','3M'])for(const s of [STOCKS[0],STOCKS[150]])for(const c of candles(s,range,NOW)){assert.ok(c.at<=NOW);assert.ok(c.low<=c.open&&c.low<=c.close);assert.ok(c.high>=c.open&&c.high>=c.close);assert.ok(c.volume>0);}
  assert.ok(marketNews(NOW).every(e=>e.at<=NOW));
});
test('new accounts start with exactly 10 million KRW and no fabricated performance',()=>{
  const a=newAccount('tester',NOW);assert.equal(a.cash.KRW,10000000);assert.equal(a.cash.USD,0);assert.equal(a.trades.length,0);assert.equal(portfolio(a,NOW).total,10000000);assert.equal(portfolio(a,NOW).profit,0);
});
test('market buy and sell account for fees and maintain cash/cost invariants',()=>{
  const original=newAccount('tester',NOW),p=toMinor(priceAt('KR001',NOW),'KRW');
  let {account:a,order}=placeOrder(original,{stockId:'KR001',side:'buy',type:'market',qty:10},NOW);
  assert.equal(order.status,'filled');assert.equal(a.holdings.KR001.qty,10);assert.equal(a.cash.KRW,10000000-p*10-feeFor(p*10));assert.equal(original.cash.KRW,10000000);
  a=placeOrder(a,{stockId:'KR001',side:'sell',type:'market',qty:4},NOW).account;assert.equal(a.holdings.KR001.qty,6);
  a=placeOrder(a,{stockId:'KR001',side:'sell',type:'market',qty:6},NOW).account;assert.equal(a.holdings.KR001,undefined);
  assert.equal(a.trades.filter(t=>t.side==='sell').reduce((n,t)=>n+t.realized,0),a.cash.KRW-10000000);validateAccount(a);
});
test('overspending, overselling, negative/fractional/NaN orders are rejected atomically',()=>{
  const a=newAccount('tester',NOW),before=JSON.stringify(a);
  for(const qty of [0,-1,1.5,NaN,Infinity,1e12])assert.throws(()=>placeOrder(a,{stockId:'KR001',side:'buy',type:'market',qty},NOW));
  assert.throws(()=>placeOrder(a,{stockId:'KR001',side:'buy',type:'market',qty:1000000},NOW),/금액/);
  assert.throws(()=>placeOrder(a,{stockId:'KR001',side:'sell',type:'market',qty:1},NOW),/수량/);
  assert.throws(()=>placeOrder(a,{stockId:'US001',side:'buy',type:'market',qty:1},NOW),/달러/);
  assert.equal(JSON.stringify(a),before);
});
test('limit buy reserves cash; cancel releases it without changing total cash',()=>{
  const {account:a,order}=placeOrder(newAccount('tester',NOW),{stockId:'KR001',side:'buy',type:'limit',qty:100,limitPrice:100},NOW);
  assert.equal(order.status,'pending');assert.equal(a.cash.KRW,10000000);assert.equal(availableCash(a,'KRW'),10000000-10000-feeFor(10000));
  assert.throws(()=>exchange(a,'toUSD',10000000,NOW),/금액/);
  const b=cancelOrder(a,order.id);assert.equal(availableCash(b,'KRW'),10000000);assert.equal(a.orders[0].status,'pending');assert.throws(()=>cancelOrder(b,order.id));
});
test('pending limit sell reserves shares and prevents double selling',()=>{
  let a=placeOrder(newAccount('tester',NOW),{stockId:'KR001',side:'buy',type:'market',qty:5},NOW).account;
  const result=placeOrder(a,{stockId:'KR001',side:'sell',type:'limit',qty:4,limitPrice:1000000},NOW);a=result.account;
  assert.equal(availableShares(a,'KR001'),1);assert.throws(()=>placeOrder(a,{stockId:'KR001',side:'sell',type:'market',qty:2},NOW));
  a=cancelOrder(a,result.order.id);assert.equal(availableShares(a,'KR001'),5);
});
test('offline limit orders fill at first qualifying tick, never twice or in the future',()=>{
  const stock=STOCKS.find(s=>s.market==='KR'&&priceAt(s,NOW+TICK_MS*8)<priceAt(s,NOW)-1);assert.ok(stock);
  const limit=priceAt(stock,NOW+TICK_MS*8);
  const result=placeOrder(newAccount('tester',NOW),{stockId:stock.id,side:'buy',type:'limit',qty:2,limitPrice:limit},NOW);
  assert.equal(result.order.status,'pending');assert.equal(processOrders(result.account,NOW).account.trades.length,0);
  let expected=NOW+TICK_MS;while(priceAt(stock,expected)>limit)expected+=TICK_MS;
  const processed=processOrders(result.account,NOW+TICK_MS*10);assert.equal(processed.account.orders[0].filledAt,expected);assert.equal(processed.account.trades.length,1);
  assert.ok(processed.account.orders[0].fillPriceMinor<=toMinor(limit,'KRW'));
  const again=processOrders(processed.account,NOW+DAY_MS);assert.equal(again.account.trades.length,1);validateAccount(again.account);
});
test('limit orders expire at simulated day end and do not use later prices',()=>{
  const result=placeOrder(newAccount('tester',NOW),{stockId:'KR001',side:'buy',type:'limit',qty:1,limitPrice:1},NOW);
  const b=processOrders(result.account,NOW+DAY_MS*500).account;assert.equal(b.orders[0].status,'expired');assert.equal(b.trades.length,0);assert.equal(availableCash(b,'KRW'),10000000);
});
test('FX preserves minor units; round trip incurs spread and respects cash reservations',()=>{
  const a=exchange(newAccount('tester',NOW),'toUSD',1000000,NOW);assert.equal(a.cash.KRW,9000000);assert.ok(Number.isSafeInteger(a.cash.USD));
  assert.equal(a.cash.USD,Math.floor(1000000/(fxRate(NOW)*1.001)*100));
  const b=exchange(a,'toKRW',a.cash.USD/100,NOW);assert.equal(b.cash.USD,0);assert.ok(b.cash.KRW<10000000);assert.ok(b.cash.KRW>9990000);
  for(const amount of [-1,0,Infinity,NaN,100000001])assert.throws(()=>exchange(a,'toUSD',amount,NOW));
  let us=placeOrder(a,{stockId:'US001',side:'buy',type:'market',qty:1},NOW).account;validateAccount(us);assert.ok(us.holdings.US001);assert.equal(us.holdings.US001.cost,us.trades[0].gross+us.trades[0].fee);
});
test('invalid imported account state fails validation',()=>{
  const a=newAccount('tester',NOW);a.cash.KRW=-1;assert.throws(()=>validateAccount(a));
  const b=newAccount('tester',NOW);b.holdings.BAD={qty:3,cost:10};assert.throws(()=>validateAccount(b));
});
