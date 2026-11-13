'use strict';

/* ==========================================================
   STAP kiosk dashboard logic
   ----------------------------------------------------------
   DATA FLOW:  ESP32 (distance / speed) -> server <- mobile app
               Laptop browser polls the server and shows this page.

   Leave apiUrl empty to run on built-in demo data.
   Or pass it in the address bar:
       index.html?api=http://192.168.1.10:3000/api/buses

   The server should return JSON shaped like this
   (etaSeconds can be replaced by etaMin; "status" is optional):
   {
     "stop": "Dehgam Bus Stop",
     "buses": [
       { "busNo": "GJ18Z00899", "destination": "Gandhinagar",
         "etaSeconds": 120, "seatsAvailable": 24, "seatsTotal": 45 }
     ]
   }
   The server must allow CORS if it runs on a different origin.
   ========================================================== */

const params = new URLSearchParams(location.search);

const CONFIG = {
  stopName: 'Dehgam Bus Stop',
  apiUrl: params.get('api') || '',        // empty = demo mode
  pollMs: 3000,                           // how often to ask the server
  staleMs: 15000,                         // no reply for this long = "Connection lost"
  maxRows: 5,                             // at most 5 buses on screen
  approachingMin: 3,                      // <= this many minutes -> Approaching
  scheduledMin: 15,                       // >  this many minutes -> Scheduled
  departedGraceMs: 15000,                 // keep a bus this long after ETA hits zero
  scheduleUrl: params.get('schedule') || new URL('schedule.html', location.href).href
};

const DEMO = !CONFIG.apiUrl;

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = (d, seconds) => d.toLocaleTimeString('en-IN', {
  hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true
}).toUpperCase();

/* ---------- state ---------- */
let buses = [];            // [{busNo, destination, etaAt(ms), seatsAvailable, seatsTotal, status}]
let lastOk = Date.now();
let lastUpdate = Date.now();
let lastRowsHtml = '';

/* ---------- data in ---------- */
function normalise(payload) {
  if (payload.stop) $('stopName').textContent = payload.stop;
  const now = Date.now();
  return (payload.buses || []).map((b) => {
    const sec = b.etaSeconds != null ? Number(b.etaSeconds) : Number(b.etaMin) * 60;
    return {
      busNo: b.busNo,
      destination: b.destination,
      etaAt: now + (isFinite(sec) ? sec : 0) * 1000,
      seatsAvailable: Number(b.seatsAvailable),
      seatsTotal: Number(b.seatsTotal),
      status: b.status ? String(b.status).toLowerCase() : ''
    };
  });
}

async function poll() {
  try {
    const res = await fetch(CONFIG.apiUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    buses = normalise(await res.json());
    lastOk = lastUpdate = Date.now();
  } catch (err) {
    console.warn('STAP: could not reach server', err);
  }
}

/* ---------- demo feed ---------- */
const DEMO_POOL = [
  ['GJ18Z00899', 'Gandhinagar'], ['GJ01AB4521', 'Ahmedabad'], ['GJ18Y01234', 'Kalol'],
  ['GJ27T09876', 'Ahmedabad'],   ['GJ18Z00412', 'Gandhinagar'], ['GJ01X07788', 'Kalol']
];
let demoIdx = 0;

function demoBus(etaAt) {
  const [busNo, destination] = DEMO_POOL[demoIdx++ % DEMO_POOL.length];
  const total = 45;
  return { busNo, destination, etaAt, seatsTotal: total,
           seatsAvailable: Math.floor(8 + Math.random() * 34), status: '' };
}
function seedDemo() {
  const now = Date.now();
  buses = [2, 7, 13, 20].map((m) => demoBus(now + m * 60000));
  buses[0].seatsAvailable = 24;
}
function topUpDemo(now) {
  while (buses.length < 6) {
    const last = buses.length ? buses[buses.length - 1].etaAt : now;
    buses.push(demoBus(last + (6 + Math.floor(Math.random() * 7)) * 60000));
  }
}

/* ---------- rendering ---------- */
function statusOf(b, min) {
  if (b.status === 'delayed') return ['delayed', 'Delayed'];
  if (min <= CONFIG.approachingMin) return ['approaching', 'Approaching'];
  if (min > CONFIG.scheduledMin)    return ['scheduled', 'Scheduled'];
  return ['ontime', 'On time'];
}
function etaLabel(sec) {
  if (sec < 60) return '&lt; 1 min';
  const min = Math.ceil(sec / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function renderBuses(now) {
  buses = buses.filter((b) => b.etaAt - now > -CONFIG.departedGraceMs)
               .sort((a, b) => a.etaAt - b.etaAt);
  const rows = buses.slice(0, CONFIG.maxRows);

  const html = rows.length ? rows.map((b, i) => {
    const sec = Math.max(0, Math.round((b.etaAt - now) / 1000));
    const [cls, label] = statusOf(b, Math.ceil(sec / 60));
    return `<div class="row row-grid">
      <span><span class="badge${i === 0 ? ' next' : ''}">${esc(b.busNo)}</span></span>
      <span class="dest">${esc(b.destination)}</span>
      <span class="eta">${etaLabel(sec)}</span>
      <span class="st"><span class="status ${cls}">${label}</span></span>
    </div>`;
  }).join('') : '<div class="empty">No buses expected right now</div>';

  if (html !== lastRowsHtml) { $('rows').innerHTML = html; lastRowsHtml = html; }

  // Seat card follows the next bus
  const next = rows[0];
  const seats = document.querySelectorAll('#busSeats .seat');
  if (next && isFinite(next.seatsAvailable) && next.seatsTotal > 0) {
    $('seatFree').textContent = next.seatsAvailable;
    $('seatTotal').textContent = next.seatsTotal;
    $('nextBus').textContent = next.busNo;
    const free = Math.round((next.seatsAvailable / next.seatsTotal) * seats.length);
    seats.forEach((s, i) => s.classList.toggle('free', i < free));
  } else {
    $('seatFree').textContent = '--';
    $('seatTotal').textContent = '--';
    $('nextBus').textContent = '--';
    seats.forEach((s) => s.classList.remove('free'));
  }
}

function renderChrome(now) {
  $('clock').textContent = fmtTime(new Date(now));
  $('updated').textContent = fmtTime(new Date(lastUpdate), true);

  const online = DEMO || (now - lastOk) < CONFIG.staleMs;
  $('sysPill').classList.toggle('offline', !online);
  $('sysText').textContent = online ? 'System online' : 'Connection lost';
}

function tick() {
  const now = Date.now();
  if (DEMO) { topUpDemo(now); lastUpdate = now - (now % 1000); }
  renderBuses(now);
  renderChrome(now);
}

/* ---------- QR ---------- */
function initQR() {
  const box = $('qr');
  if (window.QRCode) {
    new QRCode(box, {
      text: CONFIG.scheduleUrl, width: 220, height: 220,
      colorDark: '#1d2a4a', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    box.textContent = 'QR needs qrcode.min.js';
  }
}

/* ---------- scale the 1366x768 stage to any screen ---------- */
function fit() {
  const s = Math.min(window.innerWidth / 1366, window.innerHeight / 768);
  $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}

/* ---------- start ---------- */
if (params.has('skipintro')) $('stage').classList.add('no-intro');
$('stopName').textContent = CONFIG.stopName;
$('demoTag').hidden = !DEMO;

window.addEventListener('resize', fit);
fit();
initQR();

if (DEMO) seedDemo(); else poll();
tick();
setInterval(tick, 1000);
if (!DEMO) setInterval(poll, CONFIG.pollMs);
