(() => {
'use strict';
// Shared engine. Layout: ONE horizontal line; days follow each other left→right; one thing at a time (no overlaps).
// Below it: a contribution-style habit grid of what got done each day. Google Calendar events join the line (Google Identity Services).
// Everything is stored on the device (localStorage), so the app opens instantly and works offline.
const C = { pxh: 80, capH: 40, labelW: 104, cell: 12, daysBack: 56, daysAhead: 28 };
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Math.random().toString(36).slice(2, 10);
const today = addDays(new Date(), 0);
const TODAY = key(today);
const start = addDays(today, -C.daysBack);
const NDAYS = C.daysBack + C.daysAhead;
const dayW = 24 * C.pxh;
const capY = 58; // capsule top inside the track
const dayIdx = k => Math.round((parse(k) - start) / 864e5); // round() absorbs DST hour shifts
const xOf = t => dayIdx(t.date) * dayW + t.start / 60 * C.pxh;
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtT = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDur = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
const dayName = (d, o) => d.toLocaleDateString(undefined, o);
const endOf = t => t.start + Math.max(t.dur, 1);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* per-viewer convenience only */ } };

const ICONS = {
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M5 4 3 6M19 4l2 2"/>',
  gym: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  work: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  food: '<path d="M5 8h12v5a6 6 0 0 1-12 0z"/><path d="M17 10h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
const GICON = '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>';
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === 'gcal' ? GICON : ICONS[name] || ICONS.work}</svg>`;
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const DURS = [0, 15, 30, 45, 60, 90, 120];
const REMINDS = [-1, 0, 5, 10, 15, 30]; // minutes before start; -1 = off
const remindOf = t => t.remind ?? 5;
const remindLabel = r => r < 0 ? 'No reminder' : r === 0 ? 'Reminder when it starts' : `Reminder ${r} min before`;

// ---------- data ----------
const STORE = 'horizon-tasks-v1';
let tasks = load(STORE, []);
if (!Array.isArray(tasks)) tasks = [];
const save = () => store(STORE, tasks);

// Repeating tasks are real copies, one per day, so each day keeps its own done/checklist and the tracker needs no special case.
// ponytail: copies only exist up to the end of the visible range (4 weeks); fillSeries() tops them up every time the app opens.
const SERIES = 'horizon-series-v1';
let series = load(SERIES, []);
if (!Array.isArray(series)) series = [];
const RULES = { none: 'Once', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week' };
const RRULE = { daily: 'RRULE:FREQ=DAILY', weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'RRULE:FREQ=WEEKLY' };
const ruleHits = (rule, from, d) => d >= parse(from) && (rule === 'daily' || (rule === 'weekdays' && d.getDay() % 6 !== 0) || (rule === 'weekly' && d.getDay() === parse(from).getDay()));
const seriesOf = t => t && t.series && series.find(s => s.id === t.series);
const freshSteps = st => (st || []).map(x => ({ t: x.t, done: false }));
// Progress units: a task with a checklist counts each step; otherwise the task counts once.
const units = t => t.steps && t.steps.length ? [t.steps.filter(s => s.done).length, t.steps.length] : [t.done ? 1 : 0, 1];

// Google Calendar events (read-only here; "done" is remembered locally per event+day)
let gEvents = [], gAllDay = {};
const gdone = load('horizon-gdone', {});
const allTasks = () => tasks.concat(gEvents);
const findTask = id => allTasks().find(t => t.id === id);
// One timeline = one thing at a time: returns what overlaps `d` on its day, if anything.
const clash = (d, ignoreId) => allTasks().find(o => o.id !== ignoreId && o.date && o.date === d.date && o.start < endOf(d) && d.start < endOf(o));
function fillSeries(s) { // returns how many days were skipped because something else was already there
  let skipped = 0;
  for (let i = Math.max(0, dayIdx(s.from)); i < NDAYS; i++) {
    const d = addDays(start, i), k = key(d);
    if (!ruleHits(s.rule, s.from, d) || s.made.includes(k)) continue;
    s.made.push(k); // remembered, so a deleted day never comes back
    const t = Object.assign({}, s.tpl, { id: uid(), date: k, done: false, series: s.id, steps: freshSteps(s.tpl.steps) });
    const o = clash(t);
    if (o && !(o.gid && o.gid === t.gid)) { skipped++; continue; } // its own Google copy isn't a clash
    tasks.push(t);
  }
  return skipped;
}

// ---------- state ----------
let focus = C.daysBack, sel = null, editing = null, toastTimer;
const S = 1; // UI scale (the claude.ai preview drew the app inside a scaled phone frame)
const scroller = $('#scroller'), track = $('#track'), strip = $('#weekStrip'), form = $('#sheet');
const focusKey = () => key(addDays(start, focus));
const inRange = t => t.date && dayIdx(t.date) >= 0 && dayIdx(t.date) < NDAYS;

// ---------- timeline (one line) ----------
function renderTrack() {
  let h = '';
  for (let i = 0; i < NDAYS; i++) {
    const d = addDays(start, i), k = key(d), isToday = k === TODAY;
    const allDay = (gAllDay[k] || []).map(t => `<span class="allday" title="Google Calendar · all day">${esc(t)}</span>`).join('');
    h += `<div class="band${isToday ? ' is-today' : ''}" style="left:${i * dayW}px;width:${dayW}px">`
      + `<span class="night" style="left:0;width:${6 * C.pxh}px"></span><span class="night" style="left:${22 * C.pxh}px;width:${2 * C.pxh}px"></span>`
      + `<span class="band-label"><b>${dayName(d, { weekday: 'long' })}</b> ${dayName(d, { month: 'short', day: 'numeric' })}${isToday ? ' · Today' : ''}${allDay}</span>`;
    for (let hr = 1; hr < 24; hr++) h += `<span class="tick" style="left:${hr * C.pxh}px">${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}</span>`;
    h += '</div>';
  }
  h += `<div class="spine" style="top:${capY + C.capH / 2}px;width:${NDAYS * dayW}px"></div>`;
  const list = allTasks().filter(inRange).sort((a, b) => xOf(a) - xOf(b));
  list.forEach((t, j) => {
    const x = xOf(t), w = Math.max(C.capH, t.dur / 60 * C.pxh), next = list[j + 1];
    const lw = Math.max(w, Math.min(C.labelW, next ? xOf(next) - x - 8 : C.labelW)); // label never runs into the next task
    h += `<button type="button" class="task${t.done ? ' done' : ''}${t.id === sel ? ' sel' : ''}${t.gcal ? ' g' : ''}" data-id="${esc(t.id)}"`
      + ` style="left:${x}px;top:${capY}px;width:${lw}px;--c:var(--c${t.color})"`
      + ` aria-label="${esc(t.title)}, ${fmtT(t.start)}${t.done ? ', done' : ''}">`
      + `<span class="cap" style="width:${w}px">${t.done ? CHECK : svg(t.icon)}</span>`
      + `<span class="t-time">${fmtT(t.start)}${t.dur ? ' – ' + fmtT(t.start + t.dur) : ''}${t.steps && t.steps.length ? ` · ${units(t).join('/')}` : ''}</span>`
      + `<span class="t-title">${esc(t.title)}</span></button>`;
    if (next && next.date === t.date) {
      const gap = next.start - (t.start + t.dur), a = x + w, b = xOf(next);
      if (gap >= 60 && b - a > 76) h += `<span class="gap" style="left:${(a + b) / 2}px;top:${capY + C.capH / 2 - 10}px">${fmtDur(gap)} free</span>`;
    }
  });
  h += '<div id="now" class="now"><span></span></div>';
  track.innerHTML = h;
  track.style.width = NDAYS * dayW + 'px';
  tickNow();
}

function tickNow() {
  const m = nowMin(), n = $('#now');
  if (n) { n.style.left = C.daysBack * dayW + m / 60 * C.pxh + 'px'; n.firstChild.textContent = fmtT(m); }
  const clock = $('#clock'); if (clock) clock.textContent = fmtT(m).replace(/ [AP]M/, '');
}

// Continuous day strip: every day, no week breaks; swipe, drag or wheel it.
function renderStrip() {
  const all = allTasks();
  let h = '';
  for (let i = 0; i < NDAYS; i++) {
    const d = addDays(start, i), k = key(d);
    const dots = all.filter(t => t.date === k).slice(0, 4).map(t => `<i style="background:var(--c${t.color})"></i>`).join('');
    h += `<button type="button" class="wd${k === TODAY ? ' today' : ''}${d.getDate() === 1 ? ' m1' : ''}" data-idx="${i}"`
      + ` aria-label="${dayName(d, { weekday: 'long', month: 'long', day: 'numeric' })}">`
      + `<span class="wd-n">${d.getDate() === 1 ? dayName(d, { month: 'short' }) : dayName(d, { weekday: 'short' })}</span>`
      + `<span class="wd-d">${d.getDate()}</span><span class="wd-dots">${dots}</span></button>`;
  }
  strip.innerHTML = h;
  markFocus(true);
}
function markFocus(center) {
  strip.querySelectorAll('.wd').forEach(b => b.classList.toggle('on', +b.dataset.idx === focus));
  const b = strip.querySelector(`[data-idx="${focus}"]`);
  if (b) {
    const l = b.offsetLeft, r = l + b.offsetWidth, mid = l - strip.clientWidth / 2 + b.offsetWidth / 2;
    if (center) strip.scrollLeft = mid;
    else if (l < strip.scrollLeft || r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: mid, behavior: 'smooth' });
  }
  $('#monthLabel').textContent = dayName(addDays(start, focus), { month: 'long', year: 'numeric' });
}

// ---------- habit grid (contribution style) ----------
function renderTracker() {
  const el = $('#tracker'); if (!el) return;
  // Only tasks created in this app count (including ones also sent to Google). Events that live only in Google Calendar never do.
  const norm = s => s.trim().toLowerCase();
  const counts = {};
  tasks.forEach(t => { if (t.date) { const n = norm(t.title); (counts[n] = counts[n] || { name: t.title, n: 0 }).n++; } });
  const habits = Object.entries(counts).sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  if (habit && !counts[habit]) habit = '';
  const by = {};
  tasks.forEach(t => {
    if (!t.date || (habit && norm(t.title) !== habit)) return;
    const b = by[t.date] = by[t.date] || [0, 0], [ud, ut] = units(t); b[0] += ud; b[1] += ut;
  });
  const mon = d => addDays(d, -((d.getDay() + 6) % 7));
  const first = mon(start), weekStart = mon(today), weeks = Math.round((weekStart - first) / 864e5 / 7) + 1;
  let cells = '', months = '', lastM = -1;
  for (let w = 0; w < weeks; w++) {
    const wk = addDays(first, w * 7);
    const m = addDays(wk, 6).getMonth();
    months += `<span>${m !== lastM ? dayName(addDays(wk, 6), { month: 'short' }) : ''}</span>`; lastM = m;
    for (let r = 0; r < 7; r++) {
      const d = addDays(wk, r), k = key(d), [done, total] = by[k] || [0, 0];
      const future = d > today, before = d < start;
      const lv = future || before ? '' : !total ? 0 : done === total ? 4 : done / total > .66 ? 3 : done / total > .33 ? 2 : done ? 1 : d < today ? 'x' : 0;
      cells += `<button type="button" class="hc${future ? ' fut' : ''}${before ? ' out' : ''}${k === TODAY ? ' is-now' : ''}" data-lv="${lv}"`
        + `${before || future ? ' disabled' : ` data-key="${k}" aria-pressed="${hcDay === k}"`} title="${dayName(d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${total ? `${done} of ${total} done` : 'nothing planned'}"></button>`;
    }
  }
  // this week so far + streak of fully-completed days (days with nothing planned don't break it)
  let wd = 0, wt = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(weekStart, i); if (d > today) break; const b = by[key(d)]; if (b) { wd += b[0]; wt += b[1]; } }
  let streak = 0;
  for (let i = by[TODAY] && by[TODAY][0] < by[TODAY][1] ? 1 : 0; i <= C.daysBack; i++) {
    const b = by[key(addDays(today, -i))]; if (!b) continue; if (b[0] < b[1]) break; streak++;
  }
  const dl = [1, 2, 3, 4, 5, 6, 0].map(i => dayName(new Date(2026, 1, i + 1), { weekday: 'narrow' })); // Feb 1 2026 is a Sunday
  const hname = habit ? counts[habit].name : '';
  el.innerHTML = `<div class="hc-head"><b>Habit tracker${hname ? ` · ${esc(hname)}` : ''}</b><span>Last ${weeks} weeks</span></div>`
    + `<div class="hc-filter" role="group" aria-label="Show one habit">`
    + `<button type="button" data-h="" aria-pressed="${!habit}">All tasks</button>`
    + habits.map(([n, h]) => `<button type="button" data-h="${esc(n)}" aria-pressed="${habit === n}">${esc(h.name)}</button>`).join('') + `</div>`
    + `<div class="hc-body"><div class="hc-wrap" style="--cell:${C.cell}px">`
    + `<div class="hc-months" style="grid-template-columns:repeat(${weeks},var(--cell))">${months}</div>`
    + `<div class="hc-days">${dl.map((l, i) => `<span>${i % 2 ? '' : l}</span>`).join('')}</div>`
    + `<div class="hc-grid">${cells}</div></div>`
    + `<div class="hc-stats"><div><b>${wt ? Math.round(wd / wt * 100) : 0}%</b><span>this week · ${wd}/${wt} done</span></div>`
    + `<div><b>${streak}</b><span>day streak</span></div>`
    + `<div class="hc-legend">Less ${[0, 1, 2, 3, 4].map(l => `<i data-lv="${l}"></i>`).join('')} More</div>`
    + `<div class="hc-legend"><i data-lv="x"></i> Planned, not done</div></div></div>`;
  // Tapped day → breakdown of what was planned and what got done, right inside the tracker.
  if (hcDay) {
    const items = tasks.filter(t => t.date === hcDay && (!habit || norm(t.title) === habit)).sort((a, b) => a.start - b.start);
    const dn = items.filter(t => t.done).length, past = parse(hcDay) < today;
    el.insertAdjacentHTML('beforeend', `<div class="hc-day"><div class="hc-day-head"><b>${dayName(parse(hcDay), { weekday: 'long', month: 'long', day: 'numeric' }).replace(/^./, c => c.toUpperCase())}</b>`
      + `<span>${items.length ? `${dn} of ${items.length} done` : 'Nothing planned'}</span>`
      + `<button type="button" class="hc-close" data-close aria-label="Close day breakdown">×</button></div>`
      + (items.length ? `<ul>${items.map(t => `<li class="${t.done ? 'ok' : past ? 'miss' : ''}">`
        + `<span class="hc-mark" style="--c:var(--c${t.color})">${t.done ? CHECK : past ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>' : ''}</span>`
        + `<span class="hc-t">${esc(t.title)}</span><span class="hc-time">${t.steps && t.steps.length ? units(t).join('/') + ' · ' : ''}${fmtT(t.start)}</span></li>`
        + (t.steps && t.steps.length ? `<li class="hc-steps"><ul>${t.steps.map(s => `<li class="${s.done ? 'ok' : past ? 'miss' : ''}"><span class="hc-mark sm" style="--c:var(--c${t.color})">${s.done ? CHECK : past ? '×' : ''}</span><span class="hc-t">${esc(s.t)}</span></li>`).join('')}</ul></li>` : '')).join('')}</ul>` : '')
      + `</div>`);
    el.querySelector(`.hc[data-key="${hcDay}"]`)?.classList.add('picked');
  }
  const f = el.querySelector('.hc-filter'), on = f.querySelector('[aria-pressed="true"]');
  f.scrollLeft = hcFilterScroll; if (on && on.offsetLeft > f.scrollLeft + f.clientWidth) f.scrollLeft = on.offsetLeft - 12;
}
let habit = load('horizon-habit', ''), hcFilterScroll = 0, hcDay = null;
$('#tracker')?.addEventListener('click', e => {
  const h = e.target.closest('[data-h]');
  if (h) { hcFilterScroll = h.parentElement.scrollLeft; habit = h.dataset.h; store('horizon-habit', habit); renderTracker(); return; }
  if (e.target.closest('[data-close]')) { hcDay = null; renderTracker(); return; }
  const b = e.target.closest('.hc[data-key]'); if (!b) return;
  hcFilterScroll = $('#tracker .hc-filter').scrollLeft;
  hcDay = hcDay === b.dataset.key ? null : b.dataset.key; // tap again to close
  renderTracker();
});

// ---------- detail ----------
function current() {
  const t = findTask(sel); if (t) return [t, false];
  const k = focusKey(), m = nowMin();
  const day = allTasks().filter(x => x.date === k && !x.done && (k !== TODAY || x.start + x.dur >= m)).sort((a, b) => a.start - b.start);
  return [day[0] || null, !!day[0]];
}
function renderDetail() {
  const [t, auto] = current(), el = $('#detail');
  el.hidden = !t; // nothing to show → the habit tracker gets the space
  if (!t) return;
  const sr = seriesOf(t);
  el.innerHTML = `<div class="d-eyebrow">${auto ? 'Up next' : t.done ? 'Completed' : 'Selected'}${sr ? ` · Repeats ${RULES[sr.rule].toLowerCase()}` : ''}${t.gcal ? ' · From Google Calendar' : t.synced ? ' · Also in Google Calendar' : ''}</div>`
    + `<div class="d-head"><span class="d-ico" style="--c:var(--c${t.color})">${svg(t.icon)}</span>`
    + `<div class="d-main"><div class="d-time">${dayName(parse(t.date), { weekday: 'short', day: 'numeric' })} · ${fmtT(t.start)}${t.dur ? ' – ' + fmtT(t.start + t.dur) + ' · ' + fmtDur(t.dur) : ''}</div><h3>${esc(t.title)}</h3>`
    + `<div class="d-rem${remindOf(t) < 0 ? ' off' : ''}">${BELL}${remindLabel(remindOf(t))}</div></div>`
    + `<button type="button" class="d-check${t.done ? ' on' : ''}" data-act="done" aria-pressed="${t.done}" aria-label="Mark ${t.done ? 'not done' : 'done'}" style="--c:var(--c${t.color})">${CHECK}</button></div>`
    + (t.steps && t.steps.length ? `<ul class="d-steps">${t.steps.map((s, i) => `<li><button type="button" data-step="${i}" aria-pressed="${s.done}" style="--c:var(--c${t.color})"><span class="st-box">${s.done ? CHECK : ''}</span><span>${esc(s.t)}</span></button></li>`).join('')}</ul>` : '')
    + (t.notes ? `<p class="d-notes">${esc(t.notes)}</p>` : '')
    + (t.gcal
      ? `<div class="d-actions">${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : ''}</div>`
      : `<div class="d-actions"><button type="button" data-act="edit">Edit</button><button type="button" data-act="inbox">Move to Inbox</button>${sr ? '<button type="button" data-act="stop">Stop repeating</button>' : ''}<button type="button" data-act="delete" class="danger">Delete</button></div>`);
  el.dataset.id = t.id;
}

function renderInbox() {
  const list = tasks.filter(t => !t.date);
  $('#inboxList').innerHTML = list.length ? list.map(t =>
    `<li><span class="ib-ico" style="--c:var(--c${t.color})">${svg(t.icon)}</span><span class="ib-t">${esc(t.title)}</span>`
    + `<button type="button" class="ib-btn" data-sched="${t.id}">Schedule</button></li>`).join('')
    : `<li class="ib-empty">Inbox is empty. Save ideas here from the new task sheet, then schedule them when you know the time.</li>`;
  const c = $('#inboxCount'); if (c) c.textContent = list.length || '';
}

function renderAll() { renderTrack(); renderStrip(); renderDetail(); renderInbox(); renderTracker(); }

// ---------- navigation ----------
const goTo = (idx, min, smooth = true) =>
  scroller.scrollTo({ left: idx * dayW + min / 60 * C.pxh - scroller.clientWidth * 0.3, behavior: smooth ? 'smooth' : 'auto' });

let raf = 0;
scroller.addEventListener('scroll', () => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const i = Math.max(0, Math.min(NDAYS - 1, Math.floor((scroller.scrollLeft + scroller.clientWidth * 0.4) / dayW)));
    if (i === focus) return;
    focus = i;
    const s = findTask(sel);
    if (s && s.date !== focusKey()) { sel = null; track.querySelector('.task.sel')?.classList.remove('sel'); }
    markFocus(false); renderDetail();
  });
}, { passive: true });

// Mouse users can grab and drag the line and the day strip; vertical wheels scroll sideways.
function dragScroll(el) {
  let down = false, moved = false, sx, sl;
  el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.button) return; down = true; moved = false; sx = e.clientX; sl = el.scrollLeft; });
  addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - sx;
    if (!moved && Math.abs(dx) < 6) return;
    moved = true; el.classList.add('dragging'); el.scrollLeft = sl - dx / S;
  });
  addEventListener('pointerup', () => { down = false; el.classList.remove('dragging'); });
  el.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  el.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
}
dragScroll(scroller); dragScroll(strip);

strip.addEventListener('click', e => {
  const b = e.target.closest('.wd'); if (!b) return;
  const i = +b.dataset.idx;
  goTo(i, i === C.daysBack ? nowMin() : 8 * 60);
});
$('#todayBtn').addEventListener('click', () => goTo(C.daysBack, nowMin()));

track.addEventListener('click', e => {
  const b = e.target.closest('.task');
  if (b) {
    sel = b.dataset.id;
    track.querySelector('.task.sel')?.classList.remove('sel'); b.classList.add('sel');
    renderDetail(); return;
  }
  // tap on empty time = new task at that time (15-minute grid)
  const r = track.getBoundingClientRect(), x = (e.clientX - r.left) / S;
  const idx = Math.floor(x / dayW), min = Math.round((x - idx * dayW) / C.pxh * 4) * 15;
  openSheet(null, { date: key(addDays(start, idx)), start: Math.min(min, 1425) });
});

$('#detail').addEventListener('click', e => {
  const id = $('#detail').dataset.id, t = findTask(id); if (!t) return;
  const st = e.target.closest('[data-step]');
  if (st) { // checklist step: the task is done once every step is
    const s = t.steps[+st.dataset.step]; s.done = !s.done; t.done = t.steps.every(x => x.done); sel = t.id;
    save(); renderAll(); return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  if (act === 'done') {
    t.done = !t.done; sel = t.id;
    if (t.steps) t.steps.forEach(s => { s.done = t.done; });
    if (t.gcal) { gdone[t.gid + t.date] = t.done; store('horizon-gdone', gdone); }
  }
  if (act === 'stop') {
    // Keeps today and the past (they're your history); drops upcoming copies that aren't done yet.
    const sid = t.series, gone = tasks.filter(x => x.series === sid && x.id !== t.id && x.date > TODAY && !x.done);
    tasks = tasks.filter(x => !gone.includes(x)); series = series.filter(s => s.id !== sid); store(SERIES, series);
    toast(`Stopped repeating “${t.title}”${t.synced ? '. Stop it in Google Calendar too' : ''}`);
  }
  if (act === 'edit') return openSheet(t);
  const i = tasks.indexOf(t);
  if (act === 'inbox') { const prev = t.date; t.date = null; sel = null; toast('Moved to Inbox', () => { t.date = prev; save(); renderAll(); }); }
  if (act === 'delete') { tasks.splice(i, 1); sel = null; toast(`Deleted “${t.title}”`, () => { tasks.splice(i, 0, t); save(); renderAll(); }); }
  save(); renderAll();
});

$('#inboxList').addEventListener('click', e => {
  const id = e.target.closest('[data-sched]')?.dataset.sched; if (!id) return;
  openSheet(tasks.find(t => t.id === id), { date: focusKey(), start: nextSlot() });
});

document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'); });
  document.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== name; });
  if (name === 'timeline') markFocus(true);
  syncGuard();
}

// Android back button closes the sheet / leaves Inbox instead of exiting the app:
// one extra history entry exists while anything sits on top of the timeline.
let guard = false;
function syncGuard() {
  const atRoot = $('#sheetWrap').hidden && $('[data-view="inbox"]').hidden;
  if (!atRoot && !guard) { history.pushState({ guard: 1 }, ''); guard = true; }
  else if (atRoot && guard) { guard = false; history.back(); } // closed with a button: drop the entry (its popstate is ignored below)
}
addEventListener('popstate', () => {
  if (!guard) return;
  guard = false;
  if (!$('#sheetWrap').hidden) closeSheet(); else showTab('timeline');
});

// ---------- create / edit sheet ----------
const nextSlot = () => Math.min(1425, Math.ceil((nowMin() + 1) / 30) * 30);
$('#f-icons').innerHTML = Object.keys(ICONS).map(k => `<label title="${k}"><input type="radio" name="icon" value="${k}"><span class="pk-ico">${svg(k)}</span></label>`).join('');
$('#f-colors').innerHTML = [0, 1, 2, 3, 4, 5].map(c => `<label><input type="radio" name="color" value="${c}" aria-label="Color ${c + 1}"><span class="pk-sw" style="--c:var(--c${c})"></span></label>`).join('');
$('#f-durs').innerHTML = DURS.map(d => `<label><input type="radio" name="dur" value="${d}"><span class="pk-chip">${d ? fmtDur(d) : 'None'}</span></label>`).join('');
$('#f-reminds').innerHTML = REMINDS.map(r => `<label><input type="radio" name="remind" value="${r}"><span class="pk-chip">${r < 0 ? 'No' : r === 0 ? 'At start' : r + ' min'}</span></label>`).join('');
$('#f-repeats').innerHTML = Object.entries(RULES).map(([k, l]) => `<label><input type="radio" name="repeat" value="${k}"><span class="pk-chip">${l}</span></label>`).join('');
let formSteps = [];
function renderSteps() {
  $('#f-steps').innerHTML = formSteps.map((s, i) => `<li><span>${esc(s.t)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(s.t)}">×</button></li>`).join('');
}
function addStep() {
  const v = $('#f-step').value.trim(); if (!v) return;
  formSteps.push({ t: v, done: false }); $('#f-step').value = ''; renderSteps(); $('#f-step').focus();
}
$('#f-step-add').addEventListener('click', addStep);
$('#f-step').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }); // Enter adds a step, never submits
$('#f-steps').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { formSteps.splice(+b.dataset.rm, 1); renderSteps(); } });
$('#f-date').min = key(start); $('#f-date').max = key(addDays(start, NDAYS - 1));

function openSheet(t, preset = {}) {
  editing = t ? t.id : null;
  const v = Object.assign({ title: '', icon: 'work', color: 3, date: focusKey(), start: nextSlot(), dur: 30, notes: '' }, t || {}, preset);
  form.reset();
  $('#f-title').value = v.title;
  $('#f-date').value = v.date || focusKey();
  $('#f-time').value = `${pad(Math.floor(v.start / 60))}:${pad(v.start % 60)}`;
  $('#f-notes').value = v.notes;
  form.elements.icon.value = v.icon;
  form.elements.color.value = String(v.color);
  form.elements.dur.value = String(DURS.includes(v.dur) ? v.dur : 30);
  form.elements.remind.value = String(REMINDS.includes(remindOf(v)) ? remindOf(v) : 5);
  form.elements.repeat.value = 'none';
  formSteps = (v.steps || []).map(s => Object.assign({}, s)); renderSteps();
  $('#f-warn').hidden = true;
  $('#f-gcal-wrap').hidden = !gClient || !!(t && t.date); // only for new or inbox tasks
  $('#f-ghint').hidden = $('#f-gcal-wrap').hidden;
  $('#f-repeat-wrap').hidden = !!(t && t.date); // editing changes just that day
  $('#sheetTitle').textContent = t ? (t.date ? 'Edit task' : 'Schedule task') : 'New task';
  $('#f-save').textContent = t && t.date ? 'Save changes' : 'Add to timeline';
  $('#sheetWrap').hidden = false;
  syncGuard();
  setTimeout(() => $('#f-title').focus(), 60);
}
const closeSheet = () => { $('#sheetWrap').hidden = true; editing = null; syncGuard(); };

async function commit(scheduled) {
  const title = $('#f-title').value.trim();
  if (!title) { toast('Give the task a name first'); $('#f-title').focus(); return; }
  const [hh, mm] = ($('#f-time').value || '09:00').split(':').map(Number);
  const data = { title, icon: form.elements.icon.value || 'work', color: +form.elements.color.value || 0, dur: +form.elements.dur.value,
    remind: +form.elements.remind.value, notes: $('#f-notes').value.trim(), start: hh * 60 + mm, date: scheduled ? ($('#f-date').value || focusKey()) : null,
    steps: formSteps.map(s => Object.assign({}, s)) };
  if ($('#f-step').value.trim()) data.steps.push({ t: $('#f-step').value.trim(), done: false }); // typed but didn't tap Add
  if (!data.steps.length) delete data.steps;
  const rule = scheduled && !$('#f-repeat-wrap').hidden ? form.elements.repeat.value || 'none' : 'none';
  if (rule === 'weekdays') { let d = parse(data.date); while (d.getDay() % 6 === 0) d = addDays(d, 1); data.date = key(d); } // start on a weekday
  if (scheduled && !inRange(data)) { toast('Pick a day within the next four weeks'); return; }
  const c = scheduled && clash(data, editing);
  if (c) {
    // Suggest the first free start after the conflicting item.
    let s = c.start + c.dur, o;
    while ((o = clash(Object.assign({}, data, { start: s }), editing)) && s < 1440) s = o.start + o.dur;
    const w = $('#f-warn');
    w.innerHTML = `<b>That overlaps “${esc(c.title)}”</b> (${fmtT(c.start)}${c.dur ? '–' + fmtT(c.start + c.dur) : ''}). Only one thing can happen at a time.`
      + (s + data.dur <= 1440 ? ` <button type="button" id="f-fix">Start at ${fmtT(s)} instead</button>` : ' Pick another day.');
    w.hidden = false;
    const fix = $('#f-fix'); if (fix) fix.onclick = () => { $('#f-time').value = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; w.hidden = true; };
    return;
  }
  const toGoogle = scheduled && gClient && !$('#f-gcal-wrap').hidden && $('#f-gcal').checked;
  let t = tasks.find(x => x.id === editing), gErr = null;
  if (toGoogle) {
    closeSheet(); toast('Adding to Google Calendar…');
    // It stays an app task (so it counts in the habit tracker); its Google copy is hidden from the line to avoid a duplicate.
    // On failure the task is kept here so nothing is lost; a write is never retried automatically.
    try { Object.assign(data, { synced: true, gid: await addToGoogle(data, rule) }); } catch (err) { gErr = err; }
  }
  if (t) Object.assign(t, data); else { t = Object.assign({ id: uid(), done: false }, data); tasks.push(t); }
  if (t.steps) t.done = t.steps.every(s => s.done);
  let skipped = 0;
  if (rule !== 'none') {
    const s = { id: uid(), rule, from: data.date, made: [data.date], tpl: Object.assign({}, data, { date: null }) };
    t.series = s.id; series.push(s); skipped = fillSeries(s); store(SERIES, series);
  }
  save(); closeSheet();
  if (scheduled) {
    sel = t.id; showTab('timeline'); renderAll(); goTo(dayIdx(t.date), t.start);
    toast(gErr ? gWriteMsg(gErr) : `${t.synced ? 'Added to Google Calendar' : 'Planned'} for ${dayName(parse(t.date), { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtT(t.start)}`
      + (rule !== 'none' ? ` · repeats ${RULES[rule].toLowerCase()}` : '') + (skipped ? ` · skipped ${skipped} day${skipped > 1 ? 's' : ''} already taken` : ''));
  } else { if (sel === t.id) sel = null; renderAll(); toast('Saved to Inbox'); }
}
form.addEventListener('submit', e => { e.preventDefault(); commit(true); });
form.addEventListener('input', () => { $('#f-warn').hidden = true; });
$('#f-inbox').addEventListener('click', () => commit(false));
$('#f-cancel').addEventListener('click', closeSheet);
$('#sheetWrap').addEventListener('click', e => { if (e.target === e.currentTarget) closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });
$('#fab').addEventListener('click', () => openSheet(null));

function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.hidden = true; };
  el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// ---------- Google Calendar (direct, via Google Identity Services) ----------
// Needs a Google OAuth client ID in config.js (see README). Without one, Google features stay hidden.
const GCID = (window.HORIZON_CONFIG || {}).googleClientId || '';
const GAPI = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
let gToken = null, gExp = 0, gClient = null, gWanted = load('horizon-gconnected', false);
function readEvents(payload) {
  const evs = (payload && (payload.items || payload.events)) || [];
  // ponytail: first page only (maxResults 250 over ~12 weeks); follow nextPageToken if calendars get busier.
  gEvents = []; gAllDay = {};
  for (const ev of evs) {
    if (ev.status === 'cancelled' || !ev.start) continue;
    const title = ev.summary || '(No title)';
    if (ev.start.date) { // all-day: a label on each day it covers
      const s0 = parse(ev.start.date), e0 = ev.end && ev.end.date ? parse(ev.end.date) : addDays(s0, 1); // end date is exclusive
      for (let d = s0; d < e0; d = addDays(d, 1)) (gAllDay[key(d)] = gAllDay[key(d)] || []).push(title);
      continue;
    }
    const sd = new Date(ev.start.dateTime), ed = new Date((ev.end && ev.end.dateTime) || ev.start.dateTime);
    if (isNaN(sd)) continue;
    const date = key(sd), st = sd.getHours() * 60 + sd.getMinutes();
    // Skip events this app created: the app task already shows them (match by id, or by title+time if no id came back).
    if (tasks.some(t => t.synced && (t.gid === ev.id || (t.gid && t.gid === ev.recurringEventId) || (!t.gid && t.date === date && t.start === st && t.title === title)))) continue;
    gEvents.push({ id: 'g:' + ev.id, gid: ev.id, gcal: true, date, start: st, dur: Math.max(0, Math.min(1440 - st, Math.round((ed - sd) / 6e4))),
      title, icon: 'gcal', color: 3, link: ev.htmlLink, notes: String(ev.description || '').replace(/<[^>]*>/g, ' ').slice(0, 240),
      done: !!gdone[ev.id + date] });
  }
}
readEvents(load('horizon-gcache', null)); // last synced events → instant first paint, offline too

function setG(state, text, action) {
  const el = $('#gstatus'); if (!el) return;
  el.hidden = state === 'off';
  el.dataset.state = state;
  el.innerHTML = `${svg('gcal')}<span>${esc(text || '')}</span>`;
  el.title = text || '';
  el.onclick = action || null;
  el.disabled = !action;
}
function gTokenGet(interactive) {
  return new Promise((res, rej) => {
    if (gToken && Date.now() < gExp - 60000) return res(gToken);
    gClient.callback = r => {
      if (r.error) return rej(r);
      gToken = r.access_token; gExp = Date.now() + r.expires_in * 1000;
      gWanted = true; store('horizon-gconnected', true); res(gToken);
    };
    gClient.error_callback = rej; // popup blocked or closed
    gClient.requestAccessToken({ prompt: interactive && !gWanted ? 'consent' : '' });
  });
}
async function gFetch(path, opts, interactive) {
  const tok = await gTokenGet(interactive);
  const r = await fetch(GAPI + path, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } }));
  if (r.status === 401) { gToken = null; throw { code: 'auth' }; }
  if (!r.ok) throw { code: 'http', status: r.status };
  return r.json();
}
async function gSync(interactive) {
  if (!gClient) return;
  setG('busy', 'Syncing…');
  try {
    const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: addDays(start, NDAYS).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const p = await gFetch('?' + q, {}, interactive);
    store('horizon-gcache', { items: p.items || [] });
    readEvents(p); setG('ok', 'Google Calendar', () => gSync(true)); renderAll();
  } catch (e) {
    if (e && e.code === 'auth') setG('warn', 'Reconnect Google Calendar', () => gSync(true));
    else if (!navigator.onLine) setG('warn', 'Offline · showing saved events', () => gSync(true));
    else if (e && e.code === 'http') setG('warn', 'Couldn’t sync Google Calendar · tap to retry', () => gSync(true));
    else setG('warn', gWanted ? 'Tap to sync Google Calendar' : 'Connect Google Calendar', () => gSync(true)); // popup needs a tap
  }
}
function gWriteMsg(err) {
  if (err && err.code === 'auth') return 'Reconnect Google Calendar, then add it again. Saved it here only.';
  if (!navigator.onLine) return 'You’re offline. Saved it here only.';
  if (err && (err.type || err.error)) return 'Google sign-in was closed. Saved it here only.';
  return 'Couldn’t add it to Google Calendar. Saved it here only.';
}
async function addToGoogle(d, rule) {
  const sd = new Date(parse(d.date).getTime()); sd.setMinutes(d.start);
  const ed = new Date(sd.getTime()); ed.setMinutes(ed.getMinutes() + Math.max(d.dur, 15));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = { summary: d.title, start: { dateTime: sd.toISOString(), timeZone: tz }, end: { dateTime: ed.toISOString(), timeZone: tz },
    reminders: d.remind >= 0 ? { useDefault: false, overrides: [{ method: 'popup', minutes: d.remind }] } : { useDefault: false } };
  if (d.notes) body.description = d.notes;
  if (RRULE[rule]) body.recurrence = [RRULE[rule]];
  const ev = await gFetch('', { method: 'POST', body: JSON.stringify(body) }, true);
  gSync(false);
  return ev.id || null;
}
function gInit() {
  if (!GCID) { setG('off'); return; }
  if (!(window.google && google.accounts && google.accounts.oauth2)) { setTimeout(gInit, 400); return; } // GIS script loads async
  gClient = google.accounts.oauth2.initTokenClient({ client_id: GCID, scope: 'https://www.googleapis.com/auth/calendar.events', callback: () => {} });
  if (gWanted) { setG('warn', 'Tap to sync Google Calendar', () => gSync(true)); gSync(false); }
  else setG('warn', 'Connect Google Calendar', () => gSync(true));
}
setInterval(() => { if (gToken && !document.hidden) gSync(false); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && gToken) gSync(false); });
gInit();

// ---------- notifications ----------
// ponytail: system notifications fire while Chrome keeps the app alive in the background. Android can freeze a closed app,
// so for guaranteed lock-screen alerts, also add the task to Google Calendar (its app rings) — or add a push server later.
let swReg = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* best effort */ }
const notifState = () => ('Notification' in window ? Notification.permission : 'unsupported');
function renderNotifBtn() {
  const b = $('#notifBtn'); if (!b) return;
  const s = notifState();
  b.hidden = s === 'unsupported'; b.dataset.state = s;
  b.setAttribute('aria-label', s === 'granted' ? 'Notifications on' : s === 'denied' ? 'Notifications blocked' : 'Turn on notifications');
}
$('#notifBtn')?.addEventListener('click', async () => {
  const s = notifState();
  if (s === 'default') { try { await Notification.requestPermission(); } catch (e) { /* ignore */ } }
  else toast(s === 'granted' ? 'Notifications are on' : 'Notifications are blocked. Turn them on in Chrome → Site settings → Notifications.');
  renderNotifBtn();
  if (notifState() === 'granted') toast('Notifications are on');
});
function sysNotify(t, rid, when) {
  if (!document.hidden || !swReg || notifState() !== 'granted') return; // visible app shows its own banner
  swReg.showNotification(t.title, {
    body: when, tag: rid, renotify: true, requireInteraction: true, vibrate: [200, 100, 200],
    icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { id: t.id },
    actions: [{ action: 'snooze', title: 'Snooze 5 min' }, { action: 'done', title: 'Mark done' }],
  }).catch(() => {});
}
function handleAct(act, id) {
  const t = findTask(id); if (!t) return;
  if (act === 'done') {
    t.done = true;
    if (t.steps) t.steps.forEach(s => { s.done = true; });
    if (t.gcal) { gdone[t.gid + t.date] = true; store('horizon-gdone', gdone); } else save();
    renderAll(); toast(`Marked “${t.title}” done`);
  } else if (act === 'snooze') { snoozed[t.id + '@' + t.start] = nowMin() + 5; toast('Snoozed for 5 minutes'); }
  else { sel = t.id; showTab('timeline'); renderAll(); goTo(dayIdx(t.date), t.start); }
}
navigator.serviceWorker?.addEventListener('message', e => e.data && handleAct(e.data.act, e.data.id));


// ---------- reminders ----------
// ponytail: fires only while the page is open (artifact sandbox has no push/background notifications); a native app would use FCM/APNs.
const fired = new Set(), snoozed = {};
let ac = null;
addEventListener('pointerdown', () => { try { ac = ac || new AudioContext(); ac.resume(); } catch (e) { /* no audio */ } });
function chime() {
  if (!ac) return; // browsers only allow sound after the viewer has tapped once
  const t0 = ac.currentTime;
  [880, 1320, 880].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), s = t0 + i * .2;
    o.frequency.value = f; g.gain.setValueAtTime(.0001, s);
    g.gain.exponentialRampToValueAtTime(.18, s + .02); g.gain.exponentialRampToValueAtTime(.0001, s + .45);
    o.connect(g).connect(ac.destination); o.start(s); o.stop(s + .5);
  });
}
function showAlarm(t, rid) {
  const el = $('#alarm'), mins = t.start - nowMin();
  const when = t.date !== TODAY ? fmtT(t.start) : mins > 0 ? `Starts in ${mins} min · ${fmtT(t.start)}` : mins === 0 ? `Starting now · ${fmtT(t.start)}` : `Started ${-mins} min ago`;
  el.innerHTML = `<span class="d-ico" style="--c:var(--c${t.color})">${svg(t.icon)}</span>`
    + `<div class="al-main"><div class="al-when">${BELL}${when}</div><b>${esc(t.title)}</b></div>`
    + `<div class="al-btns"><button type="button" data-al="snooze">Snooze 5 min</button><button type="button" data-al="ok" class="al-ok">Got it</button></div>`;
  el.hidden = false; chime();
  sysNotify(t, rid, when);
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* unsupported */ }
  el.onclick = e => {
    const a = e.target.closest('[data-al]')?.dataset.al;
    if (a === 'snooze') { snoozed[rid] = nowMin() + 5; toast('Snoozed for 5 minutes'); }
    if (!a) { sel = t.id; showTab('timeline'); renderAll(); goTo(dayIdx(t.date), t.start); }
    el.hidden = true;
  };
}
function checkReminders() {
  const k = key(addDays(new Date(), 0)), m = nowMin();
  for (const t of allTasks()) {
    const r = remindOf(t);
    if (t.date !== k || t.done || r < 0) continue;
    const rid = t.id + '@' + t.start, due = snoozed[rid] ?? t.start - r;
    // 2-minute window so opening the page late doesn't replay every reminder of the day
    if (m >= due && m - due <= 2 && !fired.has(rid + ':' + due)) { fired.add(rid + ':' + due); showAlarm(t, rid); return; }
  }
}
setInterval(checkReminders, 15000);

// ---------- boot ----------
if (series.length) { series.forEach(fillSeries); store(SERIES, series); save(); } // top up repeating tasks as days go by
renderAll(); renderNotifBtn();
const qp = new URLSearchParams(location.search), act = qp.get('act'); // set when a notification button opened the app
if (act) history.replaceState(null, '', location.pathname);
// Open on today at the current time. Repeat after first paint in case the browser restores an old scroll position.
const home = () => goTo(C.daysBack, nowMin(), false);
home(); requestAnimationFrame(home); setTimeout(home, 300);
if (act) setTimeout(() => handleAct(act, qp.get('id')), 350);
setInterval(tickNow, 30000);
})();
