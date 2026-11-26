
import webpush from 'web-push';
import { db } from '../lib/firebase-admin.js';
import { createHash } from 'node:crypto';

// ==========================================
// VAPID + FIRESTORE
// ==========================================
try {
  webpush.setVapidDetails(
    'mailto:deensphere1922@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.error('VAPID Keys are missing or invalid in Vercel:', e.message);
}

const state = key => db.collection('notification_state').doc(createHash('sha256').update(key).digest('hex'));
function validSubscription(s){try {const u=new URL(s.endpoint);const h=u.hostname;return u.protocol==='https:' && !u.port && !u.username && !u.password && (['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','android.googleapis.com'].includes(h)||h.endsWith('.notify.windows.com')||h.endsWith('.push.apple.com'));}catch{return false;}}
const subscriptionsFor = async uid => (await db.collection('users').doc(uid).collection('push_subscriptions').get()).docs.map(d=>({...d.data(),ref:d.ref})).filter(d=>validSubscription(d.subscription||{}));
// ==========================================
// HELPERS
// ==========================================
function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.year}-${pad(d.month)}-${pad(d.day)}`; }

function localPartsFor(timeZone, at) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, minutes: values.hour * 60 + values.minute };
}

function timeStringToMinutes(value) {
  if (!value) return 0;
  const clean = String(value).trim().split(' ')[0];
  const [hours, minutes] = clean.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return ((hours * 60 + minutes) % 1440 + 1440) % 1440;
}

// ==========================================
// WINDOW LOGIC (1-min late ONLY for prayers)
// ==========================================
// For Prayers: fires on time (diff 0) OR 1 min late (diff 1)
function isWithinPrayerWindow(targetMinute, currentMinute) {
  const target = ((targetMinute % 1440) + 1440) % 1440;
  const current = ((currentMinute % 1440) + 1440) % 1440;
  const diff = (current - target + 1440) % 1440;
  return diff === 0 || diff === 1; 
}

// For Checks, Adhkar, Quran: fires EXACTLY on time (diff 0) so they don't overlap with delayed prayers
function isWithinExactWindow(targetMinute, currentMinute) {
  const target = ((targetMinute % 1440) + 1440) % 1440;
  const current = ((currentMinute % 1440) + 1440) % 1440;
  return current === target;
}

// ==========================================
// ALADHAN — PRAYER TIMES
// ==========================================
const METHOD_MAP = { MWL: 3, ISNA: 2, EGYPT: 5, KARACHI: 1, UMMALQURA: 4 };

const timingsCache = new Map();
async function getAladhanTimings(lat, lng, tzName, calcMethod, asrMethod, localDate) {
  const dd = pad(localDate.day);
  const mm = pad(localDate.month);
  const yyyy = localDate.year;
  const methodId = METHOD_MAP[calcMethod] || 3;
  const school = asrMethod === 'hanafi' ? 1 : 0;

  const url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${lat}&longitude=${lng}&method=${methodId}&school=${school}&timezonestring=${encodeURIComponent(tzName)}`;
  const cached=timingsCache.get(url); if(cached) return cached;
  const response = await fetch(url,{signal:AbortSignal.timeout(5000)});

  if (!response.ok) throw new Error(`AlAdhan HTTP ${response.status}`);
  const json = await response.json();
  if (!json || !json.data || !json.data.timings) throw new Error('AlAdhan invalid');

  const timings = json.data.timings;
  const result = {
    fajr: timeStringToMinutes(timings.Fajr),
    dhuhr: timeStringToMinutes(timings.Dhuhr),
    asr: timeStringToMinutes(timings.Asr),
    maghrib: timeStringToMinutes(timings.Maghrib),
    isha: timeStringToMinutes(timings.Isha)
  };
  if(timingsCache.size>=500) timingsCache.clear(); timingsCache.set(url,result); return result;
}

// ==========================================
// PUSH SENDER
// ==========================================
async function sendUserNotification(userId, payload, notificationKey) {
  const dedupeKey = `${userId}:${notificationKey}`;

  const claim = state(dedupeKey);
  try { await claim.create({key:dedupeKey,value:'claimed',createdAt:Date.now()}); } catch(e) {if(e.code===6 || e.code==='already-exists') return false; throw e;}
  const subscriptions = await subscriptionsFor(userId);
  if (!subscriptions.length) {await claim.delete();return false;}
  const finalPayload = { ...payload, icon: '/Deensphere_app_icon.png', url: '/' };
  let delivered = false;

  const pref=payload.prayer || (notificationKey.includes('adhkar')?'adhkar':notificationKey.startsWith('quran')?'quran':notificationKey.startsWith('birthday')?'birthday':null);
  for (const row of subscriptions) {
    if(pref && row.notif?.[pref] !== true) continue;
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify(finalPayload),
        { TTL: 3600 }
      );
    delivered = true;

console.log('PUSH SUCCESS:',
  new URL(row.subscription.endpoint).hostname
);

} catch (error) {

  console.error('PUSH FAILED:',
    new URL(row.subscription.endpoint).hostname,
    error.statusCode,
    error.message
  );

  if (error.statusCode === 410 || error.statusCode === 404) {
        await row.ref.delete();
      }
    }
  }

  if (!delivered) {
    await claim.delete();
    return false;
  }

  return true;
}

// ==========================================
// NEWS
// ==========================================
async function handleNews(profiles) {
  try {
    const r = await fetch(new URL('/api/news', process.env.APP_ORIGIN));
    if (!r.ok) return 0;
    const data = await r.json();
    if (!Array.isArray(data?.items) || data.items.length === 0) return 0;

    const latest = data.items[0];
    const articleId = latest.id || latest.link;
    if (!articleId) return 0;

    let count = 0;
    for (const profile of profiles) {
      const settings = profile.value || {};
      if (settings.notif && settings.notif.news === false) continue;

      const userKey = `seen_news:${profile.user_id}`;
      const row = (await state(userKey).get()).data();

      let seen = [];
      if (row?.value) { try { seen = JSON.parse(row.value); } catch { seen = []; } }
      if (seen.includes(articleId)) continue;

      const subs = await subscriptionsFor(profile.user_id);
      if (!subs || subs.length === 0) continue;

      const payload = { title: '📰 Ummah Hub Update', body: latest.title, icon: '/Deensphere_app_icon.png', url: latest.link || '/', tag: 'news-update' };
      let delivered = false;

      for (const s of subs) {
        if(s.notif?.news !== true) continue;
        try {
          await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 3600 });
          delivered = true;
        } catch (e) {
          if (e.statusCode === 410 || e.statusCode === 404) {
            await s.ref.delete();
          }
        }
      }

      if (delivered) {
        seen.push(articleId);
        if (seen.length > 100) seen = seen.slice(-100);
        await state(userKey).set({key:userKey,value:JSON.stringify(seen)});
        count++;
      }
    }
    return count;
  } catch (err) { return 0; }
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).send("Unauthorized");
  try {
    const now = new Date();
    const profiles = (await db.collectionGroup('data').where('key','==','settings').get()).docs.map(d=>({user_id:d.ref.parent.parent.id,value:d.data().value}));

    if (!profiles || profiles.length === 0) return res.status(200).send('No user settings found.');

    let sentCount = 0;
    if (now.getUTCMinutes()%15===0) sentCount += await handleNews(profiles);

    for (const profile of profiles) {
      try {
        const settings = profile.value || {};
        if (!settings.setupDone || !settings.location) continue;

        const lat = settings.location.lat;
        const lng = settings.location.lng;
        if (lat == null || lng == null) continue;

        const calcMethod = settings.calcMethod || 'MWL';
        const asrMethod = settings.asrMethod || 'standard';

        const tzName = settings.location.timezone || settings.timezone;
        if (!tzName) continue;

        let local;
        try { local = localPartsFor(tzName, now); } catch { continue; }

        const localDate = { year: local.year, month: local.month, day: local.day };
        const at = local.minutes;
        const today = dateStr(localDate);

        const hitPrayer = (targetMinute) => isWithinPrayerWindow(targetMinute, at);
        const hitExact = (targetMinute) => isWithinExactWindow(targetMinute, at);
        const allowed = (key) => !settings.notif || settings.notif[key] !== false;

        let userMin;
        try { userMin = await getAladhanTimings(lat, lng, tzName, calcMethod, asrMethod, localDate); } catch { continue; }

        const getTargetTime = (minuteOfDay, baseDate) => {
          const dayOffset = Math.floor(minuteOfDay / 1440);
          const wrapped = ((minuteOfDay % 1440) + 1440) % 1440;
          const h = Math.floor(wrapped / 60);
          const m = wrapped % 60;
          return new Date(baseDate.year, baseDate.month - 1, baseDate.day + dayOffset, h, m, 0).getTime();
        };

        const send = async (payload, key) => {
          const delivered = await sendUserNotification(profile.user_id, payload, key);
          if (delivered) sentCount++;
        };

        // FIVE PRAYERS (Using hitPrayer = 1 min late safety)
        if (hitPrayer(userMin.fajr) && allowed('fajr')) {
          await send({ title: '🕌 Fajr Prayer', body: 'Time for Fajr. Begin your day with prayer.', prayer: 'fajr', kind: 'time', targetTime: getTargetTime(userMin.fajr, localDate) }, `fajr-${today}`);
        }
        if (hitPrayer(userMin.dhuhr) && allowed('dhuhr')) {
          await send({ title: '🕌 Dhuhr Prayer', body: 'Time for Dhuhr. Take a break and reconnect with Allah.', prayer: 'dhuhr', kind: 'time', targetTime: getTargetTime(userMin.dhuhr, localDate) }, `dhuhr-${today}`);
        }
        if (hitPrayer(userMin.asr) && allowed('asr')) {
          await send({ title: '🕌 Asr Prayer', body: 'Time for Asr. Pause your day to remember Him.', prayer: 'asr', kind: 'time', targetTime: getTargetTime(userMin.asr, localDate) }, `asr-${today}`);
        }
        if (hitPrayer(userMin.maghrib) && allowed('maghrib')) {
          await send({ title: '🕌 Maghrib Prayer', body: 'Time for Maghrib. The sun has set, time to pray.', prayer: 'maghrib', kind: 'time', targetTime: getTargetTime(userMin.maghrib, localDate) }, `maghrib-${today}`);
        }
        if (hitPrayer(userMin.isha) && allowed('isha')) {
          await send({ title: '🕌 Isha Prayer', body: 'Time for Isha. End your day with prayer and peace.', prayer: 'isha', kind: 'time', targetTime: getTargetTime(userMin.isha, localDate) }, `isha-${today}`);
        }

        // CHECKS (Using hitExact = 0 min late to prevent overlap)
        if (hitExact(userMin.fajr + 30) && allowed('fajr')) {
          await send({ title: '🕌 Fajr Check', body: 'Did you offer Fajr? Tap to log your prayer now.', prayer: 'fajr', kind: 'check' }, `fajr-check-${today}`);
        }
        if (hitExact(userMin.dhuhr + 30) && allowed('dhuhr')) {
          await send({ title: '🕌 Dhuhr Check', body: 'Did you offer Dhuhr? Tap to log your prayer now.', prayer: 'dhuhr', kind: 'check' }, `dhuhr-check-${today}`);
        }
        if (hitExact(userMin.asr + 30) && allowed('asr')) {
          await send({ title: '🕌 Asr Check', body: 'Did you offer Asr? Tap to log your prayer now.', prayer: 'asr', kind: 'check' }, `asr-check-${today}`);
        }
        if (hitExact(userMin.maghrib + 30) && allowed('maghrib')) {
          await send({ title: '🕌 Maghrib Check', body: 'Did you offer Maghrib? Tap to log your prayer now.', prayer: 'maghrib', kind: 'check' }, `maghrib-check-${today}`);
        }
        if (hitExact(userMin.isha + 30) && allowed('isha')) {
          await send({ title: '🕌 Isha Check', body: 'Did you offer Isha? Tap to log your prayer now.', prayer: 'isha', kind: 'check' }, `isha-check-${today}`);
        }

        // ADHKAR / QURAN / BIRTHDAY (Using hitExact)
        if (hitExact(7 * 60) && allowed('adhkar')) {
          await send({ title: '🌅 Morning Adhkar', body: 'Start your day with the remembrance of Allah.' }, `morning-adhkar-${today}`);
        }
        if (hitExact(18 * 60) && allowed('adhkar')) {
          await send({ title: '🌇 Evening Adhkar', body: 'Take a moment to remember Allah before the day ends.' }, `evening-adhkar-${today}`);
        }
       if (hitExact(18 * 60 + 29) && allowed('quran')) {
          await send({ title: '📖 Qur\'an Reminder', body: 'A moment with the Qur\'an brings peace.' }, `quran-${today}`);
        }
        if (hitExact(9 * 60) && settings.birthday && allowed('birthday')) {
          try {
            const [, birthdayMonth, birthdayDay] = String(settings.birthday).split('-').map(Number);
            if (birthdayMonth === local.month && birthdayDay === local.day) {
              await send({ title: '🎂 Happy Birthday', body: 'May Allah bless your year ahead. Take a moment for gratitude today.' }, `birthday-${today}`);
            }
          } catch {}
        }

      } catch (profileError) { console.warn("Notification profile failed",profileError.message); }
    }

    if (sentCount > 0) return res.status(200).send(`Sent ${sentCount} notifications.`);
    return res.status(200).send('No notifications to send right now.');
  } catch (error) {
    console.error('Cron failed',error); return res.status(500).send('Notification scheduler failed');
  }
}
