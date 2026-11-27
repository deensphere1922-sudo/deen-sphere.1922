  import { requireUser } from '../lib/firebase-admin.js';
  export const config = { maxDuration: 60 };
  
  const MAX_QUERY_LENGTH = 1000;
  const MAX_SOURCES = 12;
  const MIN_RELEVANCE_SCORE = 0.24;
  
  // Search only primary English Qur'an/Hadith sources for English questions.
  // Only Quran.com and Sunnah.com are permitted.
  const sourceGroups = [
    {
      type: 'Qur’an evidence',
      domains: ['quran.com', 'quranenc.com'],
      limit: 4,
      query: (question) =>
        `Find Quran verses and English translations directly answering this question: ${question}. Include exact Surah and verse references.`
    },
    {
      type: 'Hadith evidence',
      domains: ['sunnah.com', 'hadeethenc.com'],
      limit: 4,
      query: (question) =>
        `Find relevant English Hadith directly answering this question: ${question}. Include collection, Hadith number and authenticity grade when available.`
    }
  , {type: 'Tafsir evidence', domains: ['quran.com'], limit: 4, query: question => `Quran.com tafsir named commentary explaining ${question} historical context and verse references` }
];
  
  const STOP_WORDS = new Set(`a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my of on or our please should so that the their them there these they this to was we what when where which who why will with would you your islamic quran qur an hadith evidence explain meaning mean means definition define describe according tell about related relevant question directly exact topic source sources reference references verse verses ayah ayat mentioned mentions say says said talk talks give show find all`.split(/\s+/));
  
  const SPELLING_MAP = new Map([
    ['tahejjud', 'tahajjud'], ['tahajud', 'tahajjud'], ['tahajjudh', 'tahajjud'],
    ['tahajjad', 'tahajjud'], ['tahajjudh', 'tahajjud'], ['tahajjud', 'tahajjud'],
    ['isalm', 'islam'], ['islm', 'islam'], ['islaam', 'islam'],
    ['forgivness', 'forgiv'], ['forgivnesss', 'forgiv'], ['forgivng', 'forgiv'],
    ['routin', 'routine'], ['routne', 'routine'], ['routien', 'routine'],
    ['quraan', 'quran'], ['quraan', 'quran'], ['tawakul', 'tawakkul'], ['tawakkal', 'tawakkul'],
    ['salah', 'prayer'], ['salat', 'prayer'], ['namaz', 'prayer'],
    ['quraan', 'quran'], ['quraan', 'quran'], ['koran', 'quran'],
    ['ramzan', 'ramadan'], ['ramadhan', 'ramadan'],
    ['roza', 'fasting'], [' saum', 'fasting'],
    ['dua', 'dua'], ['duaa', 'dua'], ['dhikr', 'dhikr'], ['zikr', 'dhikr'],
    ['wudu', 'wudu'], ['wudhu', 'wudu'], ['ablution', 'wudu'],
    ['forgiveness', 'forgiv'], ['forgiven', 'forgiv'], ['forgiving', 'forgiv'], ['forgive', 'forgiv'],
    ['patience', 'patien'], ['patient', 'patien'], ['patients', 'patien'], ['sabr', 'patien'],
    ['repentance', 'repent'], ['repenting', 'repent'], ['tawbah', 'repent'], ['tawba', 'repent'],
    ['prayers', 'prayer'], ['charity', 'charit'], ['charities', 'charit'],
  ]);
  
  const COMMON_ISLAMIC_TERMS = [
    'tahajjud', 'fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'salah', 'prayer',
    'quran', 'hadith', 'sunnah', 'tawheed', 'tawhid', 'tawakkul', 'sabr',
    'patience', 'forgiveness', 'tawbah', 'repentance', 'zakat', 'sawm',
    'fasting', 'hajj', 'umrah', 'dua', 'dhikr', 'wudu', 'ghusl', 'jannah',
    'jahannam', 'angels', 'prophets', 'islam', 'routine'
  ];
  
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      previous = current;
    }
    return previous[b.length];
  }
  
  function normalizeWord(word) {
    const w = String(word || '').toLowerCase();
    if (SPELLING_MAP.has(w)) return SPELLING_MAP.get(w);
    if (w.length >= 5) {
      const match = COMMON_ISLAMIC_TERMS
        .map(term => ({ term, distance: levenshtein(w, term) }))
        .filter(item => item.distance <= (w.length >= 8 ? 2 : 1))
        .sort((a, b) => a.distance - b.distance)[0];
      if (match) return SPELLING_MAP.get(match.term) || match.term;
    }
    if (w === 'sabr') return 'patien';
    return w;
  }
  
  function tokenize(value) {
    return [...new Set(String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word.length > 2 && !STOP_WORDS.has(word))
      .map(normalizeWord))];
  }
  
  function getTopic(question) {
    const originalWords = String(question || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    let terms = tokenize(question);
    // A broad question such as "Islam" is valid; do not reject it because it
    // is not a narrow subtopic. If only instruction words remain, preserve the
    // meaningful original words rather than returning a validation error.
    if (!terms.length) {
      terms = [...new Set(originalWords.map(normalizeWord).filter(word => word.length > 2))];
    }
    // Treat broad Islam/Qur'an/Hadith questions as valid general searches.
    // If the user typed a misspelling, normalizeWord corrects it before this check.
    const meaningful = terms.filter(word => !['routine', 'daily', 'schedule', 'plan','mean','meaning','means','definition','what','is','explain'].includes(word));
    const broad = meaningful.length === 1 && ['islam', 'quran', 'hadith'].includes(meaningful[0]);
    const topic = broad ? meaningful[0] : (terms.join(' ') || String(question).trim());
    return { topic, terms: broad ? meaningful : terms, broad };
  }
  
const SURAH_NAMES = 'Al-Fatihah|Al-Baqarah|Al-Imran|An-Nisa|Al-Maidah|Al-Anam|Al-Araf|Al-Anfal|At-Tawbah|Yunus|Hud|Yusuf|Ar-Rad|Ibrahim|Al-Hijr|An-Nahl|Al-Isra|Al-Kahf|Maryam|Ta-Ha|Al-Anbiya|Al-Hajj|Al-Muminun|An-Nur|Al-Furqan|Ash-Shuara|An-Naml|Al-Qasas|Al-Ankabut|Ar-Rum|Luqman|As-Sajdah|Al-Ahzab|Saba|Fatir|Ya-Sin|As-Saffat|Sad|Az-Zumar|Ghafir|Fussilat|Ash-Shura|Az-Zukhruf|Ad-Dukhan|Al-Jathiyah|Al-Ahqaf|Muhammad|Al-Fath|Al-Hujurat|Qaf|Adh-Dhariyat|At-Tur|An-Najm|Al-Qamar|Ar-Rahman|Al-Waqiah|Al-Hadid|Al-Mujadilah|Al-Hashr|Al-Mumtahanah|As-Saff|Al-Jumuah|Al-Munafiqun|At-Taghabun|At-Talaq|At-Tahrim|Al-Mulk|Al-Qalam|Al-Haqqah|Al-Maarij|Nuh|Al-Jinn|Al-Muzzammil|Al-Muddaththir|Al-Qiyamah|Al-Insan|Al-Mursalat|An-Naba|An-Naziat|Abasa|At-Takwir|Al-Infitar|Al-Mutaffifin|Al-Inshiqaq|Al-Buruj|At-Tariq|Al-Ala|Al-Ghashiyah|Al-Fajr|Al-Balad|Ash-Shams|Al-Layl|Ad-Duha|Ash-Sharh|At-Tin|Al-Alaq|Al-Qadr|Al-Bayyinah|Az-Zalzalah|Al-Adiyat|Al-Qariah|At-Takathur|Al-Asr|Al-Humazah|Al-Fil|Quraysh|Al-Maun|Al-Kawthar|Al-Kafirun|An-Nasr|Al-Masad|Al-Ikhlas|Al-Falaq|An-Nas'.split('|');
function requestedChapter(question) {
  const explicit = question.match(/\b(?:surah|sura|chapter)\s+(\d{1,3})\b/i);
  if (explicit && +explicit[1]>=1 && +explicit[1]<=114) return +explicit[1];
  const clean = s => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]/g,'');
  const m = question.match(/\b(?:surah|sura|chapter)\s+([\w’' -]+)/i);
  const q = clean(m ? m[1] : question);
  const aliases = SURAH_NAMES.flatMap((name,i)=> [[clean(name),i+1],[clean(name.replace(/^[^-]+-/,'')),i+1]]).concat([['yaseen',36],['yasin',36],['fatiha',1],['baqara',2]]).sort((a,b)=>b[0].length-a[0].length);
  return aliases.find(([alias])=>alias && (q===alias || (m && q.startsWith(alias))))?.[1] || null;
}
function exactVersePath(url) {
  if (!/^(?:www\.)?quran\.com$/.test(url.hostname)) return null;
  const p = url.pathname.replace(/^\/en(?=\/)/,'');
  const m = p.match(/^\/(\d{1,3})[/:](\d{1,3})\/?$/);
  return m ? {chapter:+m[1],verse:+m[2]} : null;
}
function relevantSource(url, chapter, strictChapter) {
  if (/(?:^|\/)(?:search|search-results|tag|tags)(?:\/|$)/i.test(url.pathname)) return false;
  if (!strictChapter) return true;
  const v = exactVersePath(url);
  if (v) return v.chapter===chapter;
  if (!/^(?:www\.)?quran\.com$/.test(url.hostname)) return false;
  const p = url.pathname.replace(/^\/en(?=\/)/,'');
  const m = p.match(/^\/(\d{1,3})(?:\/|:|$)/);
  const slug = p.split('/').filter(Boolean)[0];
  return m ? +m[1]===chapter : slug===SURAH_NAMES[chapter-1]?.toLowerCase();
}
async function directVerseResults(chapter, wanted) {
  try {
    const base=(process.env.QURAN_API_URL || 'https://quranenc.com/api/v1').replace(/\/$/,'');
    const response=await fetch(`${base}/translation/sura/english_saheeh/${chapter}`,{signal:AbortSignal.timeout(6500)});
    if(!response.ok) return [];
    const data=await response.json();
    const rows=Array.isArray(data.result)?data.result:[];
    return rows.filter(v=>+v.sura===chapter && wanted.includes(+v.aya) && typeof v.translation==='string' && v.translation.trim()).map(v=>({title:`Surah ${SURAH_NAMES[chapter-1]} — ${chapter}:${+v.aya}`,url:`https://quran.com/${chapter}/${+v.aya}`,content:v.translation,sourceType:'Qur’an evidence',evidenceQuality:'page_excerpt',score:1}));
  } catch { return []; }
}

  function calculateRelevance(topic, title, content, providerScore) {
    const terms = topic.terms || [];
    if (!terms.length) return Math.max(0, Math.min(providerScore, 1));
    const titleTerms = new Set(tokenize(title));
    const contentTerms = new Set(tokenize(content));
    const matched = terms.filter(term => titleTerms.has(term) || contentTerms.has(term));
    if (!matched.length) return topic.broad ? Math.min(Math.max(providerScore, 0), 1) * 0.60 : 0;
    const coverage = new Set(matched).size / terms.length;
    const titleCoverage = terms.filter(term => titleTerms.has(term)).length / terms.length;
    const contentCoverage = terms.filter(term => contentTerms.has(term)).length / terms.length;
    // Lexical topic evidence dominates the search provider's score.
    return coverage * 0.60 + titleCoverage * 0.15 + contentCoverage * 0.20 + Math.min(Math.max(providerScore, 0), 1) * 0.05;
  }
  
  const ALBANIAN_MARKERS = /\b(është|eshte|dhe|nga|për|per|kush|kur|ku|nuk|që|qe|më|me|ata|ato|ju|shumë|shume|zoti|mëshirë|mesh ire|falë|fale|besojnë|besojne|jetën|jeten|thoni|thuaju)\b/i;
  const NON_ENGLISH_URL_MARKERS = /\/(?:sq|al|ar|ur|tr|id|fr|de|es|ru|bn|ms)(?:\/|$)/i;
  const ENGLISH_URL_MARKERS = /\/(?:en|english)(?:\/|$)/i;
  
  function looksEnglish(text) {
    const value = String(text || '').trim();
   if (!value) return false;
  
    const letters = value.match(/\p{L}/gu) || [];
    if (!letters.length) return false;
  
    const nonLatin = value.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0400-\u04FF]/g) || [];
    // Permit a short Arabic quotation alongside an English translation, but
    // reject excerpts that are predominantly Arabic/Urdu/Cyrillic.
    if (nonLatin.length / letters.length > 0.45) return false;
  
    const common = (value.toLowerCase().match(/\b(the|and|of|to|is|in|you|your|he|who|for|with|his|them|those|will|not|what|from|that|this|are|one|god|allah|lord|islam|submission|faith|believe|believers|quran|qur'an|messenger|forgive|forgiveness|patience|patient)\b/g) || []).length;
    return common >= 1 || letters.length >= 30;
  }
  
  function isEnglishQuranUrl(url) {
    // Quran.com verse URLs often use canonical paths without an /en/ segment.
    // Accept canonical URLs, but reject explicit non-English language routes.
    return !NON_ENGLISH_URL_MARKERS.test(url.pathname);
  }
  
  async function getRequestBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    if (typeof req.on === 'function') return new Promise(resolve => {
      let raw = '', tooLarge = false;
      req.on('data', chunk => { if (tooLarge) return; raw += chunk; if (raw.length > 10000) { tooLarge = true; raw = ''; } });
      req.on('end', () => { try { resolve(!tooLarge && raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
    return {};
  }
  
  function getQuestion(body) {
    for (const value of [body?.query, body?.question, body?.text])
      if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  }
  

function selectContext(raw, snippet, topic, limit=12000) {
  const page=typeof raw==='string'?raw.trim():'';
  const lead=typeof snippet==='string'?snippet.trim():'';
  if(!page) return {content:lead.slice(0,limit),evidenceQuality:'search_snippet'};
  // Contiguous window near matching terms; retain adjacent context.
  const terms=topic.terms||[];
  const windows=[];
  for(let i=0;i<page.length && i<120000;i+=2400){
    const text=page.slice(i,i+4800);
    const words=new Set(tokenize(text));
    windows.push({i,score:terms.filter(t=>words.has(t)).length});
  }
  windows.sort((a,b)=>b.score-a.score||a.i-b.i);
  const start=Math.max(0,(windows[0]?.i||0)-1200);
  return {content:page.slice(start,start+limit),evidenceQuality:'page_excerpt'};
}

function classifySource(url) {
  const u = new URL(url);
  if (/(^|\.)quran\.com$/.test(u.hostname) && /\/tafsirs?(?:\/|$)/i.test(u.pathname)) return 'Tafsir evidence';
  if (/(^|\.)(sunnah\.com|hadeethenc\.com)$/.test(u.hostname)) return 'Hadith evidence';
  return 'Qur’an evidence';
}

  function isTrustedUrl(value, domains) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    } catch { return false; }
  }
  
  function getRetryAfter(response) {
    const values = [response.headers.get('retry-after'), response.headers.get('x-ratelimit-reset-requests'), response.headers.get('x-ratelimit-reset-tokens')].filter(Boolean);
    return values.find(value => !/^(?:0+(?:\.0+)?)(?:\s*(?:ms|s|sec|seconds?))?$/i.test(value.trim())) || values[0] || null;
  }
  
  export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    if (!await requireUser(req,res)) return;
    try {
      const body = await getRequestBody(req);
      const query = getQuestion(body);
      if (query.length < 2 || query.length > MAX_QUERY_LENGTH)
        return res.status(400).json({ error: `Enter a search question between 2 and ${MAX_QUERY_LENGTH} characters.` });
  
      const topic = getTopic(query);
      const chapter = requestedChapter(query);
      const strictChapter = !!chapter && !/\b(?:compare|comparison|versus|vs|hadith|hadeeth|virtues?|benefits?)\b/i.test(query);
      const islamDefinition = topic.broad && topic.topic === 'islam';
      // Short definition questions get direct scripture rather than generic search pages.
      if (islamDefinition) {
        const verses = await directVerseResults(3,[19,20]);
        if (verses.length) return res.status(200).json({results:verses.map(({score,...v})=>v),total:verses.length,researchUnavailable:false});
      }
      const searchQuestion = islamDefinition ? 'What does Islam mean as submission to Allah? Quran 3:19 and 3:20' : query;
      const activeGroups = strictChapter ? sourceGroups.filter(g=>g.type !== 'Hadith evidence') : sourceGroups;
  
    const apiKey = process.env.TAVILY_API_KEY?.trim();
  
  const responses = await Promise.allSettled(
   (apiKey ? activeGroups : []).map(async group => {
      for (let attempt = 0; attempt < 1; attempt++) {
        try {
          const response = await fetch(
            'https://api.tavily.com/search',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey.trim()}`
              },
              body: JSON.stringify({
                query: group.query(searchQuestion, topic.topic).slice(0, 390),
                search_depth: 'advanced',
                max_results: group.limit,
                include_domains: group.domains,
                include_answer: false,
                include_raw_content: true
              }),
              signal: AbortSignal.timeout(6500)
            }
          );
  
          if (
            attempt < 0 &&
            [500, 502, 503, 504].includes(response.status)
          ) {
            await new Promise(resolve =>
              setTimeout(resolve, 1000)
            );
            continue;
          }
  
          return response;
  
        } catch (error) {
          throw error;
  
          await new Promise(resolve =>
            setTimeout(resolve, 1000)
          );
        }
      }
    })
  );
  
  const candidates = [];
  const requestedRefs=[...query.matchAll(/\b(\d{1,3}):(\d{1,3})\b/g)];
  if (requestedRefs.length) {
    const chapters=[...new Set(requestedRefs.map(m=>+m[1]))].filter(n=>n>=1&&n<=114).slice(0,3);
    candidates.push(...(await Promise.all(chapters.map(n=>directVerseResults(n,requestedRefs.filter(m=>+m[1]===n).map(m=>+m[2]))))).flat());
  }
  let successfulSearches = 0;
      for (let index = 0; index < responses.length; index++) {
      const group = activeGroups[index];
  const settled = responses[index];
  
  if (settled.status === 'rejected') {
    console.error('Search request failed:', group.type, settled.reason);
    continue;
  }
  
  const response = settled.value;
  let data;
     try {
    data = await response.json();
  } catch {
    console.error('Invalid search response:', group.type);
    continue;
  }
  
  if (!response.ok) {
    console.error('Tavily search failed:', {
      source: group.type,
      status: response.status,
      error: data?.detail || data?.error || data?.message
    });
    continue;
  }
  
  successfulSearches++;
  
        for (const result of Array.isArray(data.results) ? data.results : []) {
          if (!result || typeof result.url !== 'string' || typeof result.content !== 'string' || !isTrustedUrl(result.url, group.domains)) continue;
          const url = new URL(result.url);
          if (!relevantSource(url, chapter, strictChapter)) continue;
          const title = typeof result.title === 'string' && result.title.trim() ? result.title.trim().slice(0, 250) : url.hostname;
        const {content,evidenceQuality} = selectContext(result.raw_content,result.content,topic);
          if (/(^|\.)quran\.com$/.test(url.hostname) && !isEnglishQuranUrl(url)) continue;
          if (!looksEnglish(`${title} ${content}`)) continue;
          const providerScore = typeof result.score === 'number' ? result.score : 0;
          const relevance = calculateRelevance(topic, title, content, providerScore);
          if (relevance < MIN_RELEVANCE_SCORE) continue;
          candidates.push({ title, url: url.href, content, sourceType: classifySource(url.href), evidenceQuality, score: relevance });
        }
      }
  
  
    // SERPER BACKUP WEB SEARCH
  if (candidates.length === 0 || !activeGroups.every(group=>candidates.some(c=>c.sourceType===group.type))) {
    const serperKey = process.env.SERPER_API_KEY?.trim();
  
    if (serperKey) {
      try {
        const domains = [
          ...new Set(activeGroups.flatMap(group => group.domains))
        ];
  
        const siteFilter = domains
          .map(domain => `site:${domain}`)
          .join(' OR ');
  
        const response = await fetch(
          'https://google.serper.dev/search',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-KEY': serperKey
            },
            body: JSON.stringify({
              q: `${searchQuestion.slice(0, 300)} (${siteFilter})`,
              hl: 'en',
              num: 10
            }),
            signal: AbortSignal.timeout(4500)
          }
        );
  
        if (response.ok) {
          const data = await response.json();
  
          for (const result of data.organic || []) {
            const group = activeGroups.find(group =>
              isTrustedUrl(result.link, group.domains)
            );
  
            if (!group) continue;
  
            const url = new URL(result.link);
            if (!relevantSource(url, chapter, strictChapter)) continue;
            const title = String(result.title || '').trim();
            const content = String(result.snippet || '')
              .replace(/<[^>]*>/g, '')
              .trim();
  
            if (!content || !looksEnglish(content)) continue;
  
            if (
              group.type === 'Qur’an evidence' &&
              !isEnglishQuranUrl(url)
            ) continue;
  
            const score = calculateRelevance(
              topic,
              title,
              content,
              0
            );
  
            if (score < MIN_RELEVANCE_SCORE) continue;
  
            candidates.push({
              title,
              url: url.href,
              content,
              sourceType: classifySource(url.href), evidenceQuality: "search_snippet",
              score
            });
          }
        } else {
          console.error(
            'Serper search failed:',
            response.status
          );
        }
      } catch (error) {
        console.error(
          'Serper fallback failed:',
          error.message
        );
      }
    }
  }
   const seenUrls = new Set();
  const seenTitles = new Set();
  
  const unique = candidates
    .sort((a, b) => Number(b.evidenceQuality==='page_excerpt')-Number(a.evidenceQuality==='page_excerpt') || b.score-a.score)
    .filter(source => {
      const url = new URL(source.url);
  
      url.hash = '';
      url.search = '';
  
      const urlKey = url.href
        .replace(/\/$/, '');
  
      const titleKey = String(source.title || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
  
      if (
        seenUrls.has(urlKey)
      ) {
        return false;
      }
  
      seenUrls.add(urlKey);
  
      if (titleKey) {
        seenTitles.add(titleKey);
      }
  
      return true;
    });
  
      const finalResults = unique.slice(0, MAX_SOURCES).map(({ score, ...source }) => source);

  return res.status(200).json({
    results: finalResults,
    total: finalResults.length,
    researchUnavailable: finalResults.length === 0
  });
  
  } catch (error) {
    console.error('Web search API error:', error);
  
    return res.status(200).json({
      results: [],
      total: 0,
      researchUnavailable: true
    });
  }
  }
