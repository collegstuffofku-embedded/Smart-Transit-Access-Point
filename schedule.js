'use strict';

/* ==========================================================
   STAP schedule page logic
   ----------------------------------------------------------
   Leave apiUrl empty to run on demo data, or open:
       schedule.html?api=http://192.168.1.10:3000/api/schedule

   The server should return JSON shaped like this
   (scheduledAt / expectedAt are ISO date-time strings):
   {
     "stop": "Dehgam Bus Stop",
     "buses": [
       { "busNo": "GJ18Z00899", "from": "Ahmedabad", "to": "Gandhinagar",
         "scheduledAt": "2026-11-13T19:30:00+05:30",
         "expectedAt":  "2026-11-13T19:34:00+05:30",
         "seatsAvailable": 24, "seatsTotal": 45 }
     ]
   }
   ========================================================== */

const params = new URLSearchParams(location.search);

const CONFIG = {
  stopName: 'Dehgam Bus Stop',
  apiUrl: params.get('api') || '',
  pollMs: 10000,
  approachingMin: 3,       // expected within this many minutes -> Approaching
  delayedMin: 2            // expected at least this many minutes late -> Delayed
};
const DEMO = !CONFIG.apiUrl;

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ms, sec) => new Date(ms).toLocaleTimeString('en-IN', {
  hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}), hour12: true
}).toUpperCase();

let buses = [];
let lastUpdate = Date.now();
let openBus = null;          // busNo of the card currently open

/* ---------- data ---------- */
function normalise(payload) {
  if (payload.stop) $('stopName').textContent = payload.stop;
  return (payload.buses || []).map((b) => ({
    busNo: b.busNo,
    from: b.from,
    to: b.to,
    scheduledAt: new Date(b.scheduledAt).getTime(),
    expectedAt: new Date(b.expectedAt || b.scheduledAt).getTime(),
    seatsAvailable: Number(b.seatsAvailable),
    seatsTotal: Number(b.seatsTotal)
  })).filter((b) => b.busNo && isFinite(b.scheduledAt));
}

async function poll() {
  try {
    const res = await fetch(CONFIG.apiUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    buses = normalise(await res.json());
    lastUpdate = Date.now();
    render();
  } catch (err) {
    console.warn('STAP: could not reach server', err);
  }
}

/* demo data: times are relative to "now" so the page always looks live */
function seedDemo() {
  const now = Date.now();
  const m = (n) => n * 60000;
  const rows = [
    ['GJ18Z00899', 'Ahmedabad',   'Gandhinagar', -12, 0,  18],
    ['GJ01AB4521', 'Gandhinagar', 'Ahmedabad',     2, 0,  24],
    ['GJ18Y01234', 'Ahmedabad',   'Kalol',         9, 4,  31],
    ['GJ27T09876', 'Gandhinagar', 'Ahmedabad',    15, 0,   0],
    ['GJ18Z00412', 'Ahmedabad',   'Gandhinagar',  28, 0,  12],
    ['GJ01X07788', 'Kalol',       'Ahmedabad',    41, 6,  40],
    ['GJ18Z00931', 'Ahmedabad',   'Gandhinagar',  55, 0,  37],
    ['GJ18Y05510', 'Gandhinagar', 'Kalol',        72, 0,  44]
  ];
  buses = rows.map(([busNo, from, to, off, late, free]) => ({
    busNo, from, to,
    scheduledAt: now + m(off),
    expectedAt: now + m(off + late),
    seatsAvailable: free, seatsTotal: 45
  }));
}

/* ---------- status ---------- */
function statusOf(b, now) {
  const left = (b.expectedAt - now) / 60000;
  const delay = Math.round((b.expectedAt - b.scheduledAt) / 60000);
  if (left < -1)                       return ['departed', 'Departed'];
  if (left <= CONFIG.approachingMin)   return ['approaching', 'Approaching'];
  if (delay >= CONFIG.delayedMin)      return ['delayed', 'Delayed'];
  return ['ontime', 'On time'];
}

/* ---------- list ---------- */
function render() {
  const now = Date.now();
  buses.sort((a, b) => a.scheduledAt - b.scheduledAt);

  $('list').innerHTML = buses.length ? buses.map((b, i) => {
    const [cls, label] = statusOf(b, now);
    const delay = Math.round((b.expectedAt - b.scheduledAt) / 60000);
    return `<li><button class="item${cls === 'departed' ? ' past' : ''}" data-i="${i}">
      <span class="badge">${esc(b.busNo)}</span>
      <span class="status ${cls}">${label}</span>
      <span class="route">${esc(b.from)} &rarr; ${esc(b.to)}<small>Seats free: ${isFinite(b.seatsAvailable) ? b.seatsAvailable : '--'}</small></span>
      <span class="t"><b>${fmt(b.scheduledAt)}</b><small>${delay > 0 ? 'Expected ' + fmt(b.expectedAt) : 'Scheduled'}</small></span>
    </button></li>`;
  }).join('') : '<li class="empty">No buses are scheduled right now.</li>';

  $('now').textContent = fmt(now);
  $('updated').textContent = fmt(lastUpdate, true);

  if (openBus) fillCard(buses.find((b) => b.busNo === openBus));
}

/* ---------- detail card ---------- */
function fillCard(b) {
  if (!b) { closeCard(); return; }
  const now = Date.now();
  const [cls, label] = statusOf(b, now);
  const delay = Math.round((b.expectedAt - b.scheduledAt) / 60000);

  $('dBus').textContent = b.busNo;
  const st = $('dStatus');
  st.className = 'status ' + cls;
  st.textContent = label;

  $('dFrom').textContent = b.from;
  $('dTo').textContent = b.to;
  $('dSched').textContent = fmt(b.scheduledAt);
  $('dExp').textContent = fmt(b.expectedAt);

  const d = $('dDelay');
  if (delay > 0)      { d.className = 'late';  d.textContent = `${delay} min late`; }
  else if (delay < 0) { d.className = 'early'; d.textContent = `${-delay} min early`; }
  else                { d.className = 'ok';    d.textContent = 'Running on time'; }

  $('dSeats').textContent = isFinite(b.seatsAvailable) ? `${b.seatsAvailable} of ${b.seatsTotal}` : '--';
  $('dAt').textContent = $('stopName').textContent;

  const blocked = cls === 'departed' || b.seatsAvailable === 0;
  const btn = $('bookBtn');
  btn.disabled = blocked;
  if (blocked) $('bookNote').textContent = cls === 'departed' ? 'This bus has already left.' : 'No seats left on this bus.';
  else if ($('bookNote').dataset.bus !== b.busNo) $('bookNote').textContent = '';
}

let lastFocus = null;
function openCard(b) {
  openBus = b.busNo;
  lastFocus = document.activeElement;
  $('bookNote').dataset.bus = '';
  $('bookNote').textContent = '';
  fillCard(b);
  $('overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('closeBtn').focus();
}
function closeCard() {
  openBus = null;
  $('overlay').hidden = true;
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

$('list').addEventListener('click', (e) => {
  const btn = e.target.closest('.item');
  if (btn) openCard(buses[Number(btn.dataset.i)]);
});
$('closeBtn').addEventListener('click', closeCard);
$('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeCard(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openBus) closeCard(); });

/* Booking itself is the next step; for now the button only confirms the choice. */
$('bookBtn').addEventListener('click', () => {
  $('bookNote').dataset.bus = openBus;
  $('bookNote').textContent = 'Ticket booking opens here in the next step.';
});

/* ---------- start ---------- */
$('stopName').textContent = CONFIG.stopName;
$('demoTag').hidden = !DEMO;

if (DEMO) { seedDemo(); render(); setInterval(() => { lastUpdate = Date.now(); render(); }, 20000); }
else      { poll(); setInterval(poll, CONFIG.pollMs); setInterval(render, 20000); }
