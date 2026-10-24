import {simLabel, fromMinor} from './market.js';
const esc = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sparkline(values, color='var(--accent)', width=110, height=32) {
  if (!values.length) return '';
  const min=Math.min(...values), max=Math.max(...values), spread=max-min || 1;
  const points=values.map((v,i)=>`${i/(values.length-1||1)*width},${height-3-(v-min)/spread*(height-6)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
export function candleChart(candles, currency, type='candle') {
  const W=800,H=330,L=12,R=84,T=22,B=62,plotW=W-L-R,plotH=H-T-B;
  const low=Math.min(...candles.map(c=>c.low)), high=Math.max(...candles.map(c=>c.high));
  const padding=(high-low)*0.12 || high*0.01, min=low-padding, max=high+padding;
  const y=v=>T+(max-v)/(max-min)*plotH, dx=plotW/candles.length;
  const fmt=v=>currency==='USD'?'$'+v.toFixed(2):Math.round(v).toLocaleString('ko-KR');
  let content='';
  for(let i=0;i<=4;i++) {const v=max-(max-min)*i/4, yy=y(v);content+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 5"/><text x="${W-R+12}" y="${yy+4}" class="axis-label">${fmt(v)}</text>`;}
  const maxVolume=Math.max(...candles.map(c=>c.volume));
  candles.forEach((c,i)=>{
    const x=L+(i+0.5)*dx, color=c.close>=c.open?'var(--up)':'var(--down)';
    const title=`${simLabel(c.at)} · 시 ${fmt(c.open)} / 고 ${fmt(c.high)} / 저 ${fmt(c.low)} / 종 ${fmt(c.close)} · 생성 거래량 ${c.volume.toLocaleString()}`;
    content+=`<g><title>${esc(title)}</title><rect x="${x-dx*.35}" y="${H-31-c.volume/maxVolume*22}" width="${dx*.7}" height="${c.volume/maxVolume*22}" fill="${color}" opacity=".23"/>`;
    if(type==='candle')content+=`<line x1="${x}" x2="${x}" y1="${y(c.high)}" y2="${y(c.low)}" stroke="${color}"/><rect x="${x-dx*.32}" y="${Math.min(y(c.open),y(c.close))}" width="${Math.max(1,dx*.64)}" height="${Math.max(1.4,Math.abs(y(c.open)-y(c.close)))}" fill="${color}"/>`;
    content+='</g>';
  });
  if(type==='line') {
    const d=candles.map((c,i)=>`${i?'L':'M'}${L+(i+.5)*dx},${y(c.close)}`).join(' ');
    content+=`<defs><linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d7ed62" stop-opacity=".2"/><stop offset="1" stop-color="#d7ed62" stop-opacity="0"/></linearGradient></defs><path d="${d} L${L+(candles.length-.5)*dx},${H-B} L${L+dx*.5},${H-B} Z" fill="url(#price-fill)"/><path d="${d}" stroke="var(--accent)" stroke-width="2" fill="none"/>`;
  }
  const last=candles.at(-1); content+=`<line x1="${L}" x2="${W-R}" y1="${y(last.close)}" y2="${y(last.close)}" stroke="var(--accent)" opacity=".5" stroke-dasharray="4 4"/>`;
  [0,Math.floor(candles.length/2),candles.length-1].forEach((i,j)=>{content+=`<text x="${j===2?W-R:L+i*dx}" y="${H-6}" text-anchor="${j===2?'end':'start'}" class="axis-label">${esc(simLabel(candles[i].at))}</text>`;});
  return `<svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="가상 종목의 ${type==='candle'?'시가·고가·저가·종가 캔들':'종가 선'} 차트, 최근 가격 ${fmt(last.close)}">${content}</svg>`;
}
export function equityChart(points, initialCapital) {
  const data=points.length>1?points:[{value:initialCapital},{value:points[0]?.value || initialCapital}];
  const W=800,H=190,baseline=initialCapital,min=Math.min(baseline,...data.map(d=>d.value))*.998,max=Math.max(baseline,...data.map(d=>d.value))*1.002;
  const y=v=>15+(max-v)/(max-min||1)*145;
  const d=data.map((p,i)=>`${i?'L':'M'}${i/(data.length-1)*W},${y(p.value)}`).join(' ');
  return `<svg class="equity-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="저장된 내 자산 변화"><line x1="0" x2="${W}" y1="${y(baseline)}" y2="${y(baseline)}" stroke="var(--muted)" stroke-dasharray="4 5" opacity=".5"/><path d="${d} L800,180 L0,180 Z" fill="var(--accent)" opacity=".06"/><path d="${d}" stroke="var(--accent)" stroke-width="2.3" fill="none"/><text x="3" y="185" class="axis-label">프로필 시작</text><text x="797" y="185" text-anchor="end" class="axis-label">최근 기록</text></svg>`;
}
