const $ = sel => document.querySelector(sel);

const state = {
  pillTime: localStorage.getItem('pillTime') || '07:30',
  dailyReminder: localStorage.getItem('dailyReminder') === 'true',
};

function pad(n){ return (n<10? '0':'') + n; }

function localTimeStr(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextOccurrenceTodayOrTomorrow(timeStr) {
  const [h, m] = timeStr.split(':').map(x=>parseInt(x,10));
  const now = new Date();
  const t = new Date();
  t.setHours(h, m, 0, 0);
  if (t <= now) t.setDate(t.getDate()+1);
  return t;
}

async function ensurePermissions() {
  if (!('Notification' in window)) {
    alert('Este dispositivo no soporta notificaciones web.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

function showLocalNotification(title, body) {
  if (Notification.permission === 'granted') {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png' });
    });
  }
}

// Chromium-only Scheduled Triggers
async function scheduleTrigger(when, title, body) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!('showTrigger' in Notification.prototype) || !window.TimestampTrigger || !reg) {
      return false; // fallback will be used
    }
    await reg.showNotification(title, {
      body,
      showTrigger: new TimestampTrigger(when.getTime()),
      icon: 'icons/icon-192.png'
    });
    return true;
  } catch(e) {
    console.log('Trigger scheduling failed', e);
    return false;
  }
}

function scheduleSupplementPlus4h() {
  const now = new Date();
  const when = new Date(now.getTime() + 4*60*60*1000);
  scheduleTrigger(when, 'Suplementos (+4h)', 'Hierro/calcio/biotina: ya puedes tomarlos.')
    .then(scheduled => {
      if (!scheduled) {
        // Fallback: simple timeout while app stays open
        const ms = when.getTime() - Date.now();
        setTimeout(() => showLocalNotification('Suplementos (+4h)', 'Hierro/calcio/biotina: ya puedes tomarlos.'), ms);
      }
    });
  $('#status').textContent = `Recordatorio de suplementos programado para hoy a las ${when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}.`;
}

function scheduleDailyPillReminder() {
  localStorage.setItem('pillTime', state.pillTime);
  localStorage.setItem('dailyReminder', 'true');
  const next = nextOccurrenceTodayOrTomorrow(state.pillTime);
  scheduleTrigger(next, 'Eutirox', 'Toma tu Eutirox en ayunas con agua.')
    .then(scheduled => {
      $('#status').textContent = scheduled
        ? `Recordatorio diario preparado para las ${state.pillTime}.`
        : `Recordatorio listo (si el navegador no soporta programación en segundo plano, mantén la app abierta).`;
    });
}

function cancelDaily() {
  localStorage.setItem('dailyReminder', 'false');
  $('#status').textContent = 'Recordatorio diario desactivado.';
}

function exportICS({ title, description, start, durationMinutes, rrule }) {
  const dt = (d)=>{
    const z = new Date(d);
    // naive local -> floating time for calendar apps
    return z.getFullYear().toString() +
      pad(z.getMonth()+1) + pad(z.getDate()) + 'T' +
      pad(z.getHours()) + pad(z.getMinutes()) + '00';
  };
  const uid = crypto.randomUUID();
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//BestieLegend//ThyroidBuddy//ES\n';
  ics += 'BEGIN:VEVENT\n';
  ics += `UID:${uid}\n`;
  ics += `DTSTAMP:${dt(new Date())}\n`;
  ics += `DTSTART:${dt(start)}\n`;
  if (durationMinutes) {
    const end = new Date(start.getTime() + durationMinutes*60000);
    ics += `DTEND:${dt(end)}\n`;
  }
  if (rrule) ics += `RRULE:${rrule}\n`;
  ics += `SUMMARY:${title}\n`;
  ics += `DESCRIPTION:${description}\n`;
  ics += 'END:VEVENT\nEND:VCALENDAR';
  const blob = new Blob([ics], {type:'text/calendar'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title.replace(/\s+/g,'_') + '.ics';
  a.click();
  URL.revokeObjectURL(url);
}

function createICSReminders() {
  // 1) Daily supplements at pillTime+4h
  const [h, m] = state.pillTime.split(':').map(n=>parseInt(n,10));
  const start = new Date();
  start.setHours(h+4, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate()+1);
  exportICS({
    title: 'Suplementos tras Eutirox (+4h)',
    description: 'Tomar hierro/calcio/biotina al menos 4h después de Eutirox.',
    start,
    durationMinutes: 5,
    rrule: 'FREQ=DAILY'
  });

  // 2) Thyroid labs every 6 months (rough cadence)
  const labs = new Date();
  labs.setMonth(labs.getMonth()+6);
  labs.setHours(9,0,0,0);
  exportICS({
    title: 'Recordar laboratorios TSH ± T4',
    description: 'Programar/realizar labs de tiroides; si hubo ajuste de dosis, hacerlo 6–8 semanas después del cambio.',
    start: labs,
    durationMinutes: 30,
    rrule: 'FREQ=MONTHLY;INTERVAL=6'
  });
}

function initUI() {
  $('#pillTime').value = state.pillTime;
  $('#pillTime').addEventListener('change', (e)=>{
    state.pillTime = e.target.value;
  });

  $('#btnNotify').addEventListener('click', async ()=>{
    const ok = await ensurePermissions();
    if (ok) showLocalNotification('Notificaciones activadas', 'Listo para recordatorios.');
  });

  $('#btnDaily').addEventListener('click', async ()=>{
    const ok = await ensurePermissions();
    if (!ok) return;
    scheduleDailyPillReminder();
  });

  $('#btnCancelDaily').addEventListener('click', cancelDaily);
  $('#btnPlus4').addEventListener('click', async ()=>{
    const ok = await ensurePermissions();
    if (!ok) return;
    scheduleSupplementPlus4h();
  });

  $('#btnICS').addEventListener('click', createICSReminders);
}

window.addEventListener('load', async ()=>{
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      console.log('SW registered');
    } catch(e) {
      console.log('SW registration failed', e);
    }
  }
  initUI();
});
