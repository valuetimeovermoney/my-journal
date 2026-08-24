import { useState, useEffect, useRef, useCallback, useMemo, memo, Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = {err:null}; }
  static getDerivedStateFromError(err) { return {err}; }
  render() {
    if(this.state.err) return (
      <div style={{padding:40,fontFamily:"system-ui,sans-serif",maxWidth:480,margin:"80px auto",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:16}}>⚠️</div>
        <h2 style={{color:"#c0392b",marginBottom:8}}>Something went wrong</h2>
        <p style={{color:"#666",marginBottom:24,fontSize:14}}>{this.state.err.message}</p>
        <button onClick={()=>window.location.reload()}
          style={{background:"#e8900a",color:"#fff",border:"none",borderRadius:8,padding:"10px 28px",cursor:"pointer",fontWeight:700,fontSize:15}}>
          Reload App
        </button>
      </div>
    );
    return this.props.children;
  }
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────
// Setup (5 min, one-time):
// 1. console.cloud.google.com → New project → Enable "Google Drive API"
// 2. OAuth consent screen → External → add your Gmail as test user
// 3. Credentials → OAuth 2.0 Client ID → Web app
//    Authorised JS origin: https://valuetimeovermoney.github.io
// 4. Paste Client ID below — no backend or GitHub needed
const GOOGLE_CLIENT_ID = "297234707517-i2v6cd84sj8ps75cj5lh500e67mlo06a.apps.googleusercontent.com";
const DRIVE_FILE_NAME  = "my-journal-backup.json";
const DRIVE_SCOPE      = "https://www.googleapis.com/auth/drive.appdata";

// ─── Daily inspiration quotes (rotate by date) ───────────────────────────────
const DAILY_QUOTES = [
  { text: "Your time is limited, so don't waste it living someone else's life.", who: "Steve Jobs" },
  { text: "Stay hungry, stay foolish.", who: "Steve Jobs" },
  { text: "The only way to do great work is to love what you do.", who: "Steve Jobs" },
  { text: "Simplicity is the ultimate sophistication.", who: "Leonardo da Vinci" },
  { text: "The journey of a thousand miles begins with one step.", who: "Lao Tzu" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", who: "Aristotle" },
  { text: "Write it. Shoot it. Publish it. Make.", who: "Joss Whedon" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", who: "Anne Lamott" },
  { text: "The scariest moment is always just before you start.", who: "Stephen King" },
  { text: "You don't have to be great to start, but you have to start to be great.", who: "Zig Ziglar" },
  { text: "In the middle of every difficulty lies opportunity.", who: "Albert Einstein" },
  { text: "Do one thing every day that scares you.", who: "Eleanor Roosevelt" },
  { text: "What you get by achieving your goals is not as important as what you become.", who: "Thoreau" },
  { text: "A reader lives a thousand lives before he dies.", who: "George R.R. Martin" },
  { text: "Not all those who wander are lost.", who: "J.R.R. Tolkien" },
  { text: "It does not matter how slowly you go as long as you do not stop.", who: "Confucius" },
  { text: "Creativity is intelligence having fun.", who: "Albert Einstein" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", who: "Chinese Proverb" },
  { text: "An unexamined life is not worth living.", who: "Socrates" },
  { text: "Journals are letters to yourself from yourself.", who: "Unknown" },
];
const getTodayDailyQuote = () => {
  const d = new Date();
  return DAILY_QUOTES[(d.getFullYear()*366 + d.getMonth()*31 + d.getDate()) % DAILY_QUOTES.length];
};

// ─── Constants ────────────────────────────────────────────────────────────────
const KEY              = "myjournal_";
const DEFAULT_LOCATION = "Vancouver, BC";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const fmtDate = (s, opts) => {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("en-US", opts||{weekday:"long",year:"numeric",month:"long",day:"numeric"});
};
const fmtTime  = ts  => new Date(ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
const nowTs    = ()  => Date.now();
const uid      = ()  => Math.random().toString(36).slice(2,9);
const isSun    = s   => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d).getDay()===0; };
const getTxt   = t   => typeof t==="object" ? t.text : t;
const getDone  = t   => typeof t==="object" ? !!t.done : false;

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};
const calcMins = (start, end) => {
  if (!start || !end) return 0;
  const [sh,sm] = start.split(":").map(Number);
  const [eh,em] = end.split(":").map(Number);
  const diff = (eh*60+em) - (sh*60+sm);
  return diff > 0 ? diff : 0;
};
const fmtMins  = m => m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
const blankSession = () => ({ id:uid(), startTime:nowHHMM(), endTime:"" });
const blankBook    = () => ({ id:uid(), title:"", author:"", sessions:[blankSession()], notes:[] });
const bookMins     = b => (b.sessions||[]).reduce((acc,s)=>acc+calcMins(s.startTime,s.endTime),0);

// Book notes are timestamped entries. Old data stored a single string — normalise
// it to a one-note array (ts null → rendered as "earlier").
const blankBookNote = () => ({ id:uid(), ts:nowTs(), text:"" });
const bookNotes = b => {
  if (Array.isArray(b?.notes)) return b.notes;
  if (typeof b?.notes === "string" && b.notes.trim()) return [{ id:`${b.id||uid()}-legacy`, ts:null, text:b.notes }];
  return [];
};
const normTitle = t => (t||"").trim().toLowerCase();

// blank personal quote
const blankMyQuote = () => ({ id:uid(), text:"", source:"", ts:nowTs() });
const blankNote    = () => ({ id:uid(), ts:nowTs(), source:"", text:"" });

// ─── Habits helpers ───────────────────────────────────────────────────────────
const HABITS_KEY  = "myjournal_habits";
const blankHabit  = () => ({ id:uid(), name:"" });
const loadHabits  = () => { try{const r=localStorage.getItem(HABITS_KEY);if(r){const d=JSON.parse(r);if(Array.isArray(d))return d;}}catch{} return []; };
const saveHabits  = h => localStorage.setItem(HABITS_KEY, JSON.stringify(h));

// ─── Goals helpers ────────────────────────────────────────────────────────────
const GOALS_KEY  = "myjournal_goals";
const blankGoal  = () => ({ id:uid(), title:"", notes:[], start:"", target:"", week:"", month:"", timing:"date", done:false, doneP:{}, createdAt:nowTs(), updatedAt:nowTs(), steps:[] });
const blankStep  = () => ({ id:uid(), title:"", start:"", target:"", week:"", month:"", timing:"date", done:false, doneP:{} });
// The old single "why does this matter" field becomes the first note, so
// anything already written carries over instead of disappearing.
const migrateGoal = g => {
  if(!g || typeof g!=="object") return g;
  const { why, ...rest } = g;
  let notes = Array.isArray(g.notes) ? g.notes : [];
  if(!notes.length && typeof why==="string" && why.trim())
    notes = [{ id:uid(), ts:g.createdAt||nowTs(), text:why }];
  return { ...rest, notes };
};
const loadGoals  = () => { try{const r=localStorage.getItem(GOALS_KEY);if(r){const d=JSON.parse(r);if(Array.isArray(d))return d.map(migrateGoal);}}catch{} return []; };
const saveGoals  = g => localStorage.setItem(GOALS_KEY, JSON.stringify(g));

// Goals and reports are edited constantly (ticking things off), so a union by
// id isn't enough — for an item both sides have, keep whichever was edited last.
const mergeByNewer = (local, remote) => {
  const byId = new Map(local.map(g=>[g.id,g]));
  (remote||[]).forEach(r=>{
    if(!r?.id) return;
    const l = byId.get(r.id);
    if(!l || (Number(r.updatedAt)||0) > (Number(l.updatedAt)||0)) byId.set(r.id,r);
  });
  return [...byId.values()];
};

// Whole days from today until a YYYY-MM-DD target; null when undated.
const daysUntil = ymd => {
  if(!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y,m,d] = ymd.split("-").map(Number);
  const t = new Date(y,m-1,d); t.setHours(0,0,0,0);
  const n = new Date();       n.setHours(0,0,0,0);
  return Math.round((t-n)/86400000);
};
const fmtCountdown = n => {
  if(n===null) return "no date";
  if(n===0)    return "today";
  if(n<0)      return `${Math.abs(n)}d overdue`;
  if(n<31)     return `${n}d left`;
  if(n<365)    return `${Math.round(n/30)}mo left`;
  const y = n/365;
  return `${y>=2?Math.round(y):y.toFixed(1)}y left`;
};
const cdClass = n => n===null ? "none" : n<0 ? "over" : n<=30 ? "soon" : "";

// ─── ISO weeks (Monday start; week 1 is the one holding the first Thursday) ───
const isoWeekOf = d => {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay()+6)%7));          // Thursday decides the year
  const year = t.getFullYear();
  const jan4 = new Date(year,0,4);
  const week = 1 + Math.round(((t - jan4)/86400000 - 3 + ((jan4.getDay()+6)%7))/7);
  return { year, week };
};
const isoWeekStart = (year, week) => {                       // Monday of that week
  const jan4 = new Date(year,0,4);
  const d = new Date(year, 0, 4 - ((jan4.getDay()+6)%7));
  d.setDate(d.getDate() + (week-1)*7);
  return d;
};
const isoWeeksInYear = y => isoWeekOf(new Date(y,11,28)).week;   // Dec 28 is always in the last week
const weekKey        = (year,week) => `${year}-W${String(week).padStart(2,"0")}`;
const parseWeekKey   = k => { const m=/^(\d{4})-W(\d{2})$/.exec(k||""); return m?{year:+m[1],week:+m[2]}:null; };
const thisWeekKey    = () => { const {year,week}=isoWeekOf(new Date()); return weekKey(year,week); };
const weekRangeLabel = k => {
  const p=parseWeekKey(k); if(!p) return "";
  const s=isoWeekStart(p.year,p.week), e=new Date(s); e.setDate(e.getDate()+6);
  const f=d=>d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${f(s)}–${f(e)}`;
};
// A week goal is due at the END of its week, so it isn't "overdue" on the Tuesday.
const daysUntilWeekEnd = k => {
  const p=parseWeekKey(k); if(!p) return null;
  const e=isoWeekStart(p.year,p.week); e.setDate(e.getDate()+6);
  return daysUntil(dateKey(e));
};
// Week dropdown options for this year and next, rebuilt at most once a day.
let _weekOpts=null, _weekOptsDay="";
const weekOptions = () => {
  const today=todayKey();
  if(_weekOpts && _weekOptsDay===today) return _weekOpts;
  const cy=isoWeekOf(new Date()).year, out=[];
  [cy,cy+1].forEach(y=>{
    for(let w=1;w<=isoWeeksInYear(y);w++){
      const k=weekKey(y,w);
      out.push({ key:k, label:`${y===cy?"":y+" "}W${w} · ${weekRangeLabel(k)}` });
    }
  });
  _weekOptsDay=today; _weekOpts=out;
  return out;
};

// ─── Months ───────────────────────────────────────────────────────────────────
const MONTH_RE      = /^\d{4}-\d{2}$/;
const thisMonthKey  = () => todayKey().slice(0,7);
const monthLabel    = (k,opts) => { const [y,m]=k.split("-").map(Number);
  return new Date(y,m-1,1).toLocaleDateString("en-US",opts||{month:"long",year:"numeric"}); };
const endOfMonthKey = k => { const [y,m]=k.split("-").map(Number); return dateKey(new Date(y,m,0)); };
const daysUntilMonthEnd = k => MONTH_RE.test(k||"") ? daysUntil(endOfMonthKey(k)) : null;

// ─── Goal / step scheduling ───────────────────────────────────────────────────
// Timing splits two ways. Specific: a date, a particular week, or a particular
// month. Recurring: every week or every month, which come back around rather
// than being finished once. Plus ongoing — kept at with no deadline at all.
const GOAL_TIMINGS = [
  ["date","Date"], ["week","Week"], ["month","Month"],
  ["weekly","Every week"], ["monthly","Every month"], ["ongoing","Ongoing"],
];
const timingOf    = g => GOAL_TIMINGS.some(([k])=>k===g?.timing) ? g.timing : "date";
const isRecurring = t => t==="weekly" || t==="monthly";
// The period a recurring item is currently working on.
const periodKeyOf = t => t==="weekly" ? thisWeekKey() : t==="monthly" ? thisMonthKey() : "";

// Recurring items are ticked per period, so last week's tick doesn't mark this
// week done. Everything else keeps a single done flag.
// `pk` overrides which period is being ticked — the week planner can show a
// week other than the current one, and a tick there must land on that week.
const periodDone = (item, pk) => {
  const t=timingOf(item);
  return isRecurring(t) ? !!(item?.doneP||{})[pk||periodKeyOf(t)] : !!item?.done;
};
const togglePatch = (item, pk) => {
  const t=timingOf(item);
  if(!isRecurring(t)) return { done:!item?.done };
  const k=pk||periodKeyOf(t), dp={...(item?.doneP||{})};
  if(dp[k]) delete dp[k]; else dp[k]=true;
  return { doneP:dp };
};
// Step n weeks from a week key, and the seven days it covers.
const shiftWeekKey = (k,delta) => {
  const p=parseWeekKey(k); if(!p) return thisWeekKey();
  const d=isoWeekStart(p.year,p.week); d.setDate(d.getDate()+delta*7);
  const r=isoWeekOf(d); return weekKey(r.year,r.week);
};
const weekDays = k => {
  const p=parseWeekKey(k); if(!p) return [];
  const s=isoWeekStart(p.year,p.week);
  return Array.from({length:7},(_,i)=>{
    const d=new Date(s); d.setDate(d.getDate()+i);
    return { ymd:dateKey(d), lbl:d.toLocaleDateString("en-US",{weekday:"short"}).slice(0,2), dom:d.getDate() };
  });
};
// Dated steps first in day order, then undated ones in the order they were added.
const orderedSteps = steps => [...(steps||[])].sort((a,b)=>{
  const ad=DATE_RE.test(a?.target||"")?a.target:"", bd=DATE_RE.test(b?.target||"")?b.target:"";
  if(ad&&bd) return ad.localeCompare(bd);
  return ad ? -1 : bd ? 1 : 0;
});
// The last n periods, oldest first — for the little completion strip.
const recentPeriods = (t,n=6) => {
  const out=[], now=new Date();
  for(let i=n-1;i>=0;i--){
    if(t==="weekly"){
      const x=new Date(now); x.setDate(x.getDate()-i*7);
      const {year,week}=isoWeekOf(x);
      out.push({ key:weekKey(year,week), label:`W${week}` });
    } else {
      const x=new Date(now.getFullYear(),now.getMonth()-i,1);
      out.push({ key:`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`,
                 label:x.toLocaleDateString("en-US",{month:"short"}) });
    }
  }
  return out;
};

const schedOf = item => {
  const t = timingOf(item);
  if(t==="ongoing") return { timing:t, days:null, label:"ongoing", cls:"ongoing", recurring:false };
  if(t==="weekly"){
    const d=daysUntilWeekEnd(thisWeekKey());
    return { timing:t, days:d, cls:"recur", recurring:true, label:`every week · ${fmtCountdown(d)}` };
  }
  if(t==="monthly"){
    const d=daysUntilMonthEnd(thisMonthKey());
    return { timing:t, days:d, cls:"recur", recurring:true, label:`every month · ${fmtCountdown(d)}` };
  }
  if(t==="week"){
    const k=item?.week||"", p=parseWeekKey(k), d=daysUntilWeekEnd(k);
    return { timing:t, days:d, week:k, recurring:false, cls:d===null?"none":cdClass(d),
             label: p ? `W${p.week} · ${fmtCountdown(d)}` : "no week" };
  }
  if(t==="month"){
    const k=item?.month||"", d=daysUntilMonthEnd(k);
    return { timing:t, days:d, month:k, recurring:false, cls:d===null?"none":cdClass(d),
             label: MONTH_RE.test(k) ? `${monthLabel(k,{month:"short",year:"numeric"})} · ${fmtCountdown(d)}` : "no month" };
  }
  const d=daysUntil(item?.target);
  return { timing:t, days:d, recurring:false, label:fmtCountdown(d), cls:cdClass(d) };
};
// A recurring item is never overdue — its period simply rolls over.
const isOverdue = item => { const s=schedOf(item); return !s.recurring && s.timing!=="ongoing" && s.days!==null && s.days<0; };
// Sort key: soonest first, then ongoing, then anything with no schedule at all.
const schedRank = item => { const s=schedOf(item); return s.timing==="ongoing" ? 1e9 : s.days===null ? 1e9+1 : s.days; };
// A goal is only permanently closed if it isn't recurring — recurring ones come back.
const goalClosed = g => !isRecurring(timingOf(g)) && !!g?.done;

// ─── Start dates ──────────────────────────────────────────────────────────────
// A deadline says when something must be finished; an optional start date turns
// that into a span you can see your way through.
const daysBetween = (a,b) => {
  const [ay,am,ad]=a.split("-").map(Number), [by,bm,bd]=b.split("-").map(Number);
  return Math.round((new Date(by,bm-1,bd) - new Date(ay,am-1,ad))/86400000);
};
// The deadline as a plain date, whichever way the item is timed.
const schedEndYmd = item => {
  const t=timingOf(item);
  if(t==="ongoing") return "";
  if(t==="date")    return DATE_RE.test(item?.target||"") ? item.target : "";
  if(t==="week"||t==="weekly"){
    const p=parseWeekKey(t==="week" ? (item?.week||"") : thisWeekKey());
    if(!p) return "";
    const e=isoWeekStart(p.year,p.week); e.setDate(e.getDate()+6);
    return dateKey(e);
  }
  const k = t==="month" ? (item?.month||"") : thisMonthKey();
  return MONTH_RE.test(k) ? endOfMonthKey(k) : "";
};
const spanOf = item => {
  const start = DATE_RE.test(item?.start||"") ? item.start : "";
  if(!start) return null;
  const until = daysUntil(start);              // positive while it is still ahead
  const end   = schedEndYmd(item);
  const total = end ? daysBetween(start,end) : null;
  const gone  = Math.max(-until,0);
  return { start, until, notStarted:until>0, total,
           elapsed: total===null ? null : Math.min(gone,total),
           pct: total>0 ? Math.round(Math.min(gone,total)/total*100) : (until<=0?100:0) };
};

// Which week an item belongs to — a dated item still lands in its calendar week.
// Month-scoped and recurring items have no single week; they group elsewhere.
const effWeekKey = item => {
  const t=timingOf(item);
  if(t==="ongoing"||isRecurring(t)||t==="month") return "";
  if(t==="week") return item?.week||"";
  const d=item?.target;
  if(!d || !DATE_RE.test(d)) return "";
  const [y,m,day]=d.split("-").map(Number);
  const {year,week}=isoWeekOf(new Date(y,m-1,day));
  return weekKey(year,week);
};
// Which month an item rolls up to. A week belongs to the month holding its
// Thursday — the same rule ISO uses to decide a week's year.
const effMonthKey = item => {
  const t=timingOf(item);
  if(t==="ongoing"||isRecurring(t)) return "";
  if(t==="month") return MONTH_RE.test(item?.month||"") ? item.month : "";
  if(t==="week"){
    const p=parseWeekKey(item?.week); if(!p) return "";
    const th=isoWeekStart(p.year,p.week); th.setDate(th.getDate()+3);
    return `${th.getFullYear()}-${String(th.getMonth()+1).padStart(2,"0")}`;
  }
  const d=item?.target;
  return (d && DATE_RE.test(d)) ? d.slice(0,7) : "";
};

// ─── Ideas helpers ────────────────────────────────────────────────────────────
const IDEAS_KEY  = "myjournal_ideas";
const blankIdea  = () => ({ id:uid(), title:"", description:"", createdAt:nowTs(), rank:0 });
const loadIdeas  = () => { try{const r=localStorage.getItem(IDEAS_KEY);if(r){const d=JSON.parse(r);if(Array.isArray(d))return d;}}catch{} return []; };
const saveIdeas  = ideas => localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas));

// ─── Annual report tracker helpers ────────────────────────────────────────────
const REPORTS_KEY = "myjournal_reports";
const REPORT_DEPTHS = [["new","New"],["deep","Deep dive"]];
// Anything saved before this existed reads as a first look.
const depthOf = r => r?.depth==="deep" ? "deep" : "new";
const normCompany = c => (c||"").trim().toLowerCase();
const blankReport = (status="planned", depth="new") => ({ id:uid(), company:"", notes:[], status, depth, start:"", due:"", readOn:status==="read"?todayKey():"", createdAt:nowTs(), updatedAt:nowTs() });

// The old single-line "detail" becomes the first note, so anything already
// jotted down carries over rather than disappearing.
const migrateReport = r => {
  if(!r || typeof r!=="object") return r;
  const { detail, ...rest } = r;
  let notes = Array.isArray(r.notes) ? r.notes : [];
  if(!notes.length && typeof detail==="string" && detail.trim())
    notes = [{ id:uid(), ts:r.updatedAt||r.createdAt||nowTs(), text:detail }];
  return { ...rest, notes };
};

// Research runs over days — a deep dive begun Monday and finished Thursday.
// A planned entry measures against its due date, a logged one against the day
// it was actually finished.
const reportSpan = r => {
  const start = DATE_RE.test(r?.start||"") ? r.start : "";
  if(!start) return null;
  const done  = r?.status==="read";
  const end   = done ? (DATE_RE.test(r?.readOn||"") ? r.readOn : "")
                     : (DATE_RE.test(r?.due||"")    ? r.due    : "");
  const until = daysUntil(start);
  const total = end ? Math.max(daysBetween(start,end),0) : null;
  const gone  = Math.max(-until,0);
  return { start, end, done, until, notStarted:until>0, total,
           elapsed: total===null ? null : Math.min(gone,total),
           pct: total>0 ? Math.round(Math.min(gone,total)/total*100) : (until<=0?100:0) };
};
const loadReports = () => { try{const r=localStorage.getItem(REPORTS_KEY);if(r){const d=JSON.parse(r);if(Array.isArray(d))return d.map(migrateReport);}}catch{} return []; };
const saveReports = r => localStorage.setItem(REPORTS_KEY, JSON.stringify(r));

// The week runs Monday → Sunday, matching the Sunday weekly reflection.
const endOfWeekYmd   = () => { const d=new Date(); d.setDate(d.getDate()+((7-d.getDay())%7)); return dateKey(d); };
const endOfMonthYmd  = () => { const d=new Date(); return dateKey(new Date(d.getFullYear(),d.getMonth()+1,0)); };
const startOfWeekYmd = () => { const d=new Date(); d.setDate(d.getDate()-((d.getDay()+6)%7)); return dateKey(d); };
const reportBucket = due => {
  if(!due) return "someday";
  const t=todayKey();
  if(due<t)   return "overdue";
  if(due===t) return "today";
  if(due<=endOfWeekYmd())  return "week";
  if(due<=endOfMonthYmd()) return "month";
  return "later";
};
const dateKey     = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const calcHabitStreak = (habitId) => {
  let s=0; const d=new Date();
  while(true){
    const k=dateKey(d);
    try{ const e=JSON.parse(localStorage.getItem(KEY+k)||"{}"); if(e.habitChecks?.[habitId]){s++;d.setDate(d.getDate()-1);}else break; }catch{break;}
  }
  return s;
};
const getLast7 = (habitId, today) => {
  return Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); const k=dateKey(d);
    try{ const e=JSON.parse(localStorage.getItem(KEY+k)||"{}"); return {k,done:!!e.habitChecks?.[habitId],isToday:k===today,day:d.toLocaleDateString("en-US",{weekday:"short"}).slice(0,2)}; }catch{return {k,done:false,isToday:k===today,day:"?"};} });
};

const blankEntry = () => ({
  todos:            [{text:"",done:false}],
  diaryBlocks:      [],
  notes:            [],
  habitChecks:      {},
  gratitude:        ["","",""],
  weeklyReflection: "",
  location:         DEFAULT_LOCATION,
  books:            [],
  myQuotes:         [],
});

const migrate = p => {
  if (!p || typeof p !== "object") return blankEntry();
  // Ensure all array fields are actually arrays (guard against corrupted/old data)
  if (!Array.isArray(p.todos))         p.todos         = [{text:"",done:false}];
  if (!Array.isArray(p.diaryBlocks))   p.diaryBlocks   = [];
  if (!Array.isArray(p.notes))         p.notes         = [];
  if (!Array.isArray(p.myQuotes))      p.myQuotes      = [];
  if (!Array.isArray(p.gratitude))     p.gratitude     = ["","",""];
  while (p.gratitude.length < 3)       p.gratitude.push("");
  if (!p.habitChecks || typeof p.habitChecks !== "object" || Array.isArray(p.habitChecks))
                                        p.habitChecks   = {};
  if (p.location == null)              p.location      = DEFAULT_LOCATION;
  // old single reading → books array
  if (!p.books) {
    if (p.reading?.book?.trim()) {
      p.books = [{ id:uid(), title:p.reading.book, author:p.reading.author||"", sessions:[{id:uid(),startTime:"",endTime:""}], notes:p.reading.notes||"" }];
    } else {
      p.books = [];
    }
    delete p.reading;
  }
  if (!Array.isArray(p.books)) p.books = [];
  // migrate old books to sessions array format, and old string notes to timestamped array
  p.books = p.books.map(b => {
    if (!b || typeof b !== "object") return null;
    const notes = bookNotes(b);
    if (!b.sessions) {
      const session = { id:uid(), startTime:b.startTime||"", endTime:b.endTime||"" };
      return { id:b.id||uid(), title:b.title||"", author:b.author||"", sessions:[session], notes };
    }
    return { ...b, notes };
  }).filter(Boolean);
  return p;
};

// Key-sorted stringify, so two entries with the same content compare equal
// regardless of the order their fields happen to be stored in.
const stableStr = v => JSON.stringify(v, (k,val)=>
  (val && typeof val==="object" && !Array.isArray(val))
    ? Object.keys(val).sort().reduce((o,key)=>{o[key]=val[key];return o;},{})
    : val);

// True when an entry holds nothing worth keeping. `location` is excluded — it
// defaults to DEFAULT_LOCATION, so it is present even on an untouched day.
const entryIsEmpty = e => {
  if(!e || typeof e!=="object") return true;
  const has = v => typeof v==="string" ? !!v.trim() : !!v;
  if((e.diaryBlocks||[]).some(b=>has(b?.text)))    return false;
  if((e.todos||[]).some(t=>has(getTxt(t))))        return false;
  if((e.gratitude||[]).some(has))                  return false;
  if((e.notes||[]).some(n=>has(n?.text)))          return false;
  if((e.myQuotes||[]).some(q=>has(q?.text)))       return false;
  if((e.books||[]).some(b=>has(b?.title)||bookNotes(b).some(n=>has(n?.text)))) return false;
  if(has(e.weeklyReflection))                      return false;
  if(Object.values(e.habitChecks||{}).some(Boolean)) return false;
  return true;
};

const load  = dk => { try { const r=localStorage.getItem(KEY+dk); if(r) return migrate(JSON.parse(r)); } catch {} return blankEntry(); };

// Stamps updatedAt, but only when the content actually changed — otherwise
// merely opening the app would make this device look "newer" than one that
// really wrote something, and win the merge below.
const save = (dk,data) => {
  const next = {...data}; delete next.updatedAt;
  const body = stableStr(next);
  let prevBody = null;
  try{
    const r=localStorage.getItem(KEY+dk);
    if(r){ const p=JSON.parse(r); delete p.updatedAt; prevBody=stableStr(p); }
  }catch{}
  if(prevBody===body) return;
  localStorage.setItem(KEY+dk, JSON.stringify({...next, updatedAt:Date.now()}));
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Which of two versions of the same day to keep. Content always beats blank;
// otherwise the more recently edited one wins. Entries written before
// updatedAt existed count as 0, so a local one is kept over a legacy remote —
// the safe direction, and it self-corrects the next time either is edited.
const pickNewer = (localE, driveE) => {
  const lEmpty = entryIsEmpty(localE), dEmpty = entryIsEmpty(driveE);
  if(lEmpty && !dEmpty) return driveE;
  if(dEmpty && !lEmpty) return localE;
  return (Number(driveE?.updatedAt)||0) > (Number(localE?.updatedAt)||0) ? driveE : localE;
};

// Write Drive's copy of a day into localStorage only when doing so cannot
// destroy newer local work. Returns true if it wrote.
const applyDriveEntry = (date, driveEntry) => {
  const incoming = migrate({...driveEntry});
  let local = null;
  try{ const r=localStorage.getItem(KEY+date); if(r) local=migrate(JSON.parse(r)); }catch{}
  if(local && pickNewer(local, {...incoming, updatedAt:driveEntry?.updatedAt}) === local) return false;
  localStorage.setItem(KEY+date, JSON.stringify({...incoming, updatedAt:driveEntry?.updatedAt||Date.now()}));
  return true;
};

const applyDriveEntries = list => {
  let n=0;
  (list||[]).forEach(e=>{
    if(e?.date && DATE_RE.test(e.date)){ const {date,...rest}=e; if(applyDriveEntry(date,rest)) n++; }
  });
  return n;
};
const allEntries = () => {
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    const date = k.startsWith(KEY) ? k.slice(KEY.length) : "";
    if(date && DATE_RE.test(date)){
      try{
        const parsed=JSON.parse(localStorage.getItem(k));
        out.push({...migrate(parsed), date});
      }catch{}
    }
  }
  return out.sort((a,b)=>b.date.localeCompare(a.date));
};

// ─── Google Drive ─────────────────────────────────────────────────────────────
const DRIVE_CONNECTED_KEY = "myjournal_drive_connected";

let gsiLoaded=false;
const loadGSI = () => new Promise(res=>{
  if(gsiLoaded||window.google?.accounts){gsiLoaded=true;return res();}
  const s=document.createElement("script"); s.src="https://accounts.google.com/gsi/client";
  s.onload=()=>{gsiLoaded=true;res();}; document.head.appendChild(s);
});

// Token cache — one OAuth prompt per session, then silent reuse
let _tok=null, _tokExp=0;
const getCachedToken = () => (_tok && Date.now()<_tokExp-60000) ? _tok : null;
const cacheToken = r => { _tok=r.access_token; _tokExp=Date.now()+(r.expires_in||3600)*1000; return _tok; };

// Interactive auth — shows Google account picker (called once per session on demand)
const getToken = () => new Promise((res,rej)=>{
  const cached=getCachedToken(); if(cached) return res(cached);
  loadGSI().then(()=>{
    window.google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID, scope:DRIVE_SCOPE,
      callback:r=>r.error?rej(r):res(cacheToken(r)),
    }).requestAccessToken();
  });
});

// Silent auth — returns null instead of prompting if session expired
const getTokenSilent = () => new Promise(res=>{
  const cached=getCachedToken(); if(cached) return res(cached);
  loadGSI().then(()=>{
    window.google.accounts.oauth2.initTokenClient({
      client_id:GOOGLE_CLIENT_ID, scope:DRIVE_SCOPE,
      callback:r=>res(r.error?null:cacheToken(r)),
      error_callback:()=>res(null),
    }).requestAccessToken({prompt:"none"});
  }).catch(()=>res(null));
});

const getDriveFileId = async token => {
  const r=await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${DRIVE_FILE_NAME}'&fields=files(id)`,
    {headers:{"Authorization":`Bearer ${token}`}}).then(r=>r.json());
  return r.files?.[0]?.id||null;
};
const saveToDrive = async (entries, token) => {
  if(!token) token=await getToken();
  const content=JSON.stringify({v:2,entries,habits:loadHabits(),ideas:loadIdeas(),goals:loadGoals(),reports:loadReports()},null,2);
  const fileId=await getDriveFileId(token);
  let url;
  if(!fileId){
    const m=await fetch("https://www.googleapis.com/drive/v3/files",
      {method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
       body:JSON.stringify({name:DRIVE_FILE_NAME,parents:["appDataFolder"]})}).then(r=>r.json());
    url=`https://www.googleapis.com/upload/drive/v3/files/${m.id}?uploadType=media`;
  } else { url=`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`; }
  await fetch(url,{method:"PATCH",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},body:content});
  return true;
};
const loadFromDrive = async (token) => {
  if(!token) token=await getToken();
  const fileId=await getDriveFileId(token);
  if(!fileId) return null;
  const raw=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {headers:{"Authorization":`Bearer ${token}`}}).then(r=>r.json());
  if(Array.isArray(raw)) return {entries:raw,habits:[]};
  return raw;
};

// Merge local entries with Drive entries, then save back to Drive.
// For a date both sides have, the more recently edited copy wins — pushing from
// a device that hasn't synced in a while must not clobber newer work from another.
// Drive fills in dates missing locally.
const mergeAndSaveToDrive = async (localEntries, token) => {
  if(!token) token=await getToken();
  let toSave = localEntries;
  try {
    const driveData = await loadFromDrive(token);
    if(driveData){
      const driveEntries = Array.isArray(driveData.entries)?driveData.entries:[];
      const driveByDate = new Map(driveEntries.filter(e=>e?.date && DATE_RE.test(e.date)).map(e=>[e.date,e]));
      const localDates = new Set(localEntries.map(e=>e.date));
      toSave = localEntries.map(e=>{
        const d = driveByDate.get(e.date);
        return d ? pickNewer(e,d) : e;
      });
      const extra = [...driveByDate.values()].filter(e=>!localDates.has(e.date));
      if(extra.length) toSave = [...toSave, ...extra];
      const driveHabits = Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length) saveHabits([...local,...extraH]);
      }
      const driveIdeas = Array.isArray(driveData.ideas)?driveData.ideas:[];
      if(driveIdeas.length){
        const local=loadIdeas();
        const localIds=new Set(local.map(i=>i.id));
        const extraI=driveIdeas.filter(i=>i.id&&!localIds.has(i.id));
        if(extraI.length) saveIdeas([...local,...extraI]);
      }
      const driveGoals = Array.isArray(driveData.goals)?driveData.goals:[];
      if(driveGoals.length){
        const local=loadGoals();
        const mergedG=mergeByNewer(local,driveGoals);
        if(stableStr(mergedG)!==stableStr(local)) saveGoals(mergedG);
      }
      const driveReports = Array.isArray(driveData.reports)?driveData.reports:[];
      if(driveReports.length){
        const local=loadReports();
        const mergedR=mergeByNewer(local,driveReports);
        if(stableStr(mergedR)!==stableStr(local)) saveReports(mergedR);
      }
    }
  } catch {}
  await saveToDrive(toSave, token);
  return toSave;
};

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html,body{height:100%;overflow:hidden;}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Arial,sans-serif;background:#F5F0E8;color:#1a1a1a;line-height:1.6;}
.app{display:flex;height:100vh;height:100dvh;overflow:hidden;position:relative;}

.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:20;animation:fadeIn .2s ease;}
.overlay.open{display:block;}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}

/* ── sidebar ── */
.sidebar{width:260px;flex-shrink:0;background:#1a1a1a;color:#F5F0E8;display:flex;flex-direction:column;height:100vh;height:100dvh;overflow-y:auto;position:relative;z-index:30;transition:transform .3s ease;}
.sb-head{padding:26px 20px 18px;border-bottom:1px solid #2e2e2e;}
.sb-logo{font-family:'Playfair Display',serif;font-size:20px;font-weight:600;letter-spacing:-.3px;margin-bottom:2px;}
.sb-sub{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1.5px;}
.sb-today{margin:12px 14px 4px;padding:9px 14px;background:#C8A96E;color:#1a1a1a;border:none;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:13px;font-weight:500;cursor:pointer;width:calc(100% - 28px);text-align:left;transition:background .2s;}
.sb-today:hover{background:#d4b87a;}
.sb-sec{padding:14px 20px 6px;font-size:9px;color:#555;text-transform:uppercase;letter-spacing:1.5px;}
.sb-entry{padding:8px 20px;cursor:pointer;border-left:2px solid transparent;transition:background .15s;}
.sb-entry:hover{background:#222;} .sb-entry.active{background:#252525;border-left-color:#C8A96E;}
.sb-edate{font-size:12px;color:#bbb;} .sb-edate.today{color:#C8A96E;font-weight:500;}
.sb-eprev{font-size:11px;color:#555;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-foot{margin-top:auto;padding:14px 20px;border-top:1px solid #2a2a2a;font-size:10px;color:#444;line-height:1.6;}
.sb-foot strong{color:#666;display:block;margin-bottom:2px;}
.sb-sync-status{margin-top:6px;font-size:9px;color:#5a6a5a;font-style:italic;}

/* ── topbar ── */
.topbar{display:none;align-items:center;gap:12px;padding:13px 18px;background:#F5F0E8;border-bottom:1px solid #e8e2d8;position:sticky;top:0;z-index:15;flex-shrink:0;}
.hbg{background:none;border:none;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:4px;}
.hbg span{display:block;width:20px;height:1.5px;background:#1a1a1a;border-radius:2px;}
.tb-title{font-family:'Playfair Display',serif;font-size:17px;font-weight:600;}
.tb-date{font-size:11px;color:#aaa;margin-left:auto;}
.tb-sync{background:none;border:1.5px solid #d0cfc0;border-radius:6px;padding:4px 9px;font-size:13px;color:#888;cursor:pointer;transition:all .2s;flex-shrink:0;line-height:1;}
.tb-sync:hover:not(:disabled){border-color:#4285F4;color:#4285F4;}
.tb-sync:disabled{opacity:.5;cursor:not-allowed;}
.tb-sync.synced{border-color:#5a9a60;color:#5a9a60;}
.tb-sync.error{border-color:#c05050;color:#c05050;}
.tb-sync.connected{border-color:#4285F4;color:#4285F4;}

/* ── main ── */
.main{flex:1;overflow-y:auto;display:flex;flex-direction:column;}

/* ── desktop nav ── */
.desk-nav{display:flex;gap:6px;flex-wrap:wrap;padding:20px 52px 0;max-width:760px;align-items:center;}
.npill{padding:7px 16px;border:none;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;cursor:pointer;background:white;color:#888;transition:all .2s;}
.npill.active{background:#1a1a1a;color:#F5F0E8;}
.npill:hover:not(.active){background:#eee8de;}
.sync-pill{margin-left:auto;background:none;border:1.5px solid #d0cfc0;color:#888;font-size:11px;}
.sync-pill:hover:not(:disabled){border-color:#4285F4;color:#4285F4;background:white;}
.sync-pill:disabled{opacity:.5;cursor:not-allowed;}
.sync-pill.synced{border-color:#5a9a60;color:#5a9a60;background:#f0f8f0;}
.sync-pill.error{border-color:#c05050;color:#c05050;}

/* ── page head ── */
.pg-head{padding:36px 52px 0;max-width:760px;}
.eyebrow{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;}
.pg-title{font-family:'Playfair Display',serif;font-size:34px;font-weight:400;color:#1a1a1a;line-height:1.2;letter-spacing:-.5px;}
.pg-title em{font-style:italic;color:#C8A96E;}
.pg-subtitle{font-size:13px;color:#aaa;font-weight:300;margin-top:5px;}

/* ── daily inspiration quote ── */
.insp-bar{margin:14px 52px 0;max-width:760px;padding:14px 18px;background:linear-gradient(135deg,#1a1a1a,#2a2218);border-radius:10px;display:flex;align-items:flex-start;gap:12px;}
.insp-mark{font-family:'Playfair Display',serif;font-size:30px;color:#C8A96E;line-height:.85;flex-shrink:0;margin-top:3px;}
.insp-body{flex:1;}
.insp-text{font-family:'Playfair Display',serif;font-style:italic;font-size:13px;color:#e8e0d0;line-height:1.6;}
.insp-who{font-size:10px;color:#C8A96E;margin-top:4px;text-transform:uppercase;letter-spacing:1px;}

/* ── location ── */
.loc-bar{display:flex;align-items:center;gap:8px;margin:10px 52px 0;max-width:760px;padding:9px 14px;background:white;border-radius:8px;border:1.5px solid transparent;transition:border-color .2s;position:relative;}
.loc-bar:focus-within{border-color:#C8A96E30;}
.loc-inp{flex:1;border:none;outline:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:13px;font-weight:300;color:#555;background:transparent;}
.loc-inp::placeholder{color:#ccc;}
.loc-hint{font-size:10px;color:#ccc;}
.loc-gps-btn{background:none;border:1.5px solid #e0d8cc;border-radius:5px;padding:3px 8px;font-size:12px;color:#aaa;cursor:pointer;transition:all .2s;flex-shrink:0;white-space:nowrap;}
.loc-gps-btn:hover:not(:disabled){border-color:#C8A96E;color:#C8A96E;background:#C8A96E08;}
.loc-gps-btn:disabled{opacity:.5;cursor:not-allowed;}
.loc-dropdown{position:absolute;top:100%;left:0;right:0;background:white;border-radius:0 0 8px 8px;border:1.5px solid #e0d8cc;border-top:none;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,.08);margin-top:-1px;}
.loc-sugg{padding:9px 14px;font-size:13px;color:#555;cursor:pointer;transition:background .15s;display:flex;align-items:center;gap:8px;}
.loc-sugg:hover{background:#F5F0E8;color:#1a1a1a;}
.loc-sugg:last-child{border-radius:0 0 6px 6px;}

/* ── stats ── */
.stats-row{display:flex;gap:10px;flex-wrap:wrap;padding:14px 52px 0;max-width:760px;}
.stat{background:white;border-radius:8px;padding:11px 14px;flex:1;min-width:72px;}
.stat strong{display:block;font-family:'Playfair Display',serif;font-size:24px;font-weight:600;color:#1a1a1a;line-height:1;margin-bottom:2px;}
.stat span{font-size:10px;color:#aaa;font-weight:300;}

/* ── content ── */
.content{padding:28px 52px 80px;max-width:760px;}

/* ── section ── */
.section{margin-bottom:40px;}
.sec-hd{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.sec-ic{width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;}
.ic-todo{background:#EDE8DE;} .ic-diary{background:#E2ECDB;} .ic-grat{background:#E4DBED;}
.ic-ref{background:#DBE4ED;} .ic-read{background:#DBE8E8;} .ic-quote{background:#F0E8D8;}
.sec-ttl{font-family:'Playfair Display',serif;font-size:17px;font-weight:600;}
.sec-hint{font-size:10px;color:#bbb;margin-left:auto;}

/* ── todos ── */
.todo-list{display:flex;flex-direction:column;gap:7px;}
.todo-row{display:flex;align-items:center;gap:10px;background:white;border-radius:8px;padding:11px 12px;border:1.5px solid transparent;transition:border-color .2s,box-shadow .2s;}
.todo-row:focus-within{border-color:#C8A96E30;box-shadow:0 2px 10px rgba(200,169,110,.1);}
.ck{width:18px;height:18px;border-radius:50%;border:1.5px solid #ccc;background:white;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s;font-size:9px;color:white;}
.ck.done{background:#C8A96E;border-color:#C8A96E;}
.ti{flex:1;border:none;outline:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;color:#1a1a1a;background:transparent;}
.ti.struck{text-decoration:line-through;color:#bbb;}
.rm{opacity:0;background:none;border:none;color:#ccc;cursor:pointer;font-size:15px;padding:0 2px;transition:opacity .15s,color .15s;}
.todo-row:hover .rm{opacity:1;} .rm:hover{color:#e07070;}
.add-row{margin-top:6px;background:none;border:1.5px dashed #d8d0c0;border-radius:8px;padding:9px 12px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#c0b8a8;cursor:pointer;width:100%;text-align:left;transition:all .2s;}
.add-row:hover{border-color:#C8A96E;color:#C8A96E;background:#C8A96E08;}

/* ── journal blocks ── */
.diary-blocks{display:flex;flex-direction:column;gap:12px;}
.diary-block{background:white;border-radius:8px;border:1.5px solid transparent;transition:border-color .2s,box-shadow .2s;overflow:hidden;}
.diary-block:focus-within{border-color:#C8A96E30;box-shadow:0 2px 14px rgba(200,169,110,.08);}
.db-meta{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 0;}
.db-ts{font-size:10px;color:#C8A96E;font-weight:500;letter-spacing:.3px;}
.db-del{background:none;border:none;color:#ddd;cursor:pointer;font-size:14px;padding:0 2px;transition:color .15s;line-height:1;}
.db-del:hover{color:#e07070;}
.db-ta{width:100%;border:none;outline:none;padding:8px 14px 14px;font-family:'Playfair Display',serif;font-size:15px;line-height:1.85;color:#1a1a1a;resize:none;background:transparent;min-height:80px;}
.db-ta::placeholder{color:#ccc;font-style:italic;}

/* ── habits ── */
.habits-list{display:flex;flex-direction:column;gap:7px;}
.habit-row{display:flex;align-items:center;gap:10px;background:white;border-radius:8px;padding:11px 12px;border:1.5px solid transparent;transition:border-color .2s;}
.habit-row.checked{opacity:.65;}
.hck{width:18px;height:18px;border-radius:4px;border:1.5px solid #ccc;background:white;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s;font-size:9px;color:white;}
.hck.on{background:#e8900a;border-color:#e8900a;}
.habit-lbl{flex:1;font-size:14px;font-weight:300;color:#1a1a1a;user-select:none;cursor:pointer;}
.habit-lbl.struck{text-decoration:line-through;color:#bbb;}
.habit-score{font-size:11px;color:#e8900a;font-weight:500;margin-left:auto;}
.ic-habit{background:#FDEBD0;}
.habits-view{padding:28px 52px 80px;max-width:760px;}
.hv-manage{background:white;border-radius:10px;padding:16px 18px;margin-bottom:22px;border:1.5px solid #fde0b0;}
.hv-manage-hd{font-size:10px;color:#e8900a;text-transform:uppercase;letter-spacing:1.2px;font-weight:500;margin-bottom:14px;}
.habit-edit-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.habit-stat-card{background:white;border-radius:10px;padding:14px 18px;margin-bottom:10px;border:1.5px solid #fde0b0;}
.hsc-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.hsc-name{font-size:14px;font-weight:400;color:#1a1a1a;}
.hsc-streak{font-size:12px;color:#e8900a;font-weight:500;}
.habit-week{display:flex;gap:5px;flex-wrap:wrap;}
.hwdot{width:32px;height:32px;border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;gap:1px;}
.hwdot.on{background:#e8900a;color:white;}
.hwdot.off{background:#f5ede0;color:#ccc;}
.hwdot.today-dot{box-shadow:0 0 0 2px #e8900a;}
.hwdot-day{font-size:8px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;opacity:.7;}

/* ── ideas view ── */
.ideas-view{padding:28px 52px 80px;max-width:760px;}
.ideas-sort-bar{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;}
.ideas-sort-btn{padding:5px 14px;border:1.5px solid #e0d8cc;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#888;cursor:pointer;background:none;transition:all .2s;}
.ideas-sort-btn.active{background:#1a1a1a;color:#F5F0E8;border-color:#1a1a1a;}
.idea-card{background:white;border-radius:10px;padding:16px 18px;margin-bottom:14px;border:1.5px solid transparent;transition:border-color .2s,box-shadow .2s;}
.idea-card:focus-within{border-color:#C8A96E30;box-shadow:0 2px 12px rgba(200,169,110,.1);}
.idea-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.idea-ts{font-size:10px;color:#C8A96E;font-weight:500;letter-spacing:.3px;}
.idea-del{background:none;border:none;color:#ddd;cursor:pointer;font-size:15px;padding:0 2px;transition:color .15s;line-height:1;}
.idea-del:hover{color:#e07070;}
.idea-title-inp{width:100%;border:none;outline:none;font-family:'Playfair Display',serif;font-size:17px;font-weight:600;color:#1a1a1a;background:transparent;margin-bottom:10px;}
.idea-title-inp::placeholder{color:#ccc;font-weight:400;}
.idea-desc-ta{width:100%;border:none;outline:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;line-height:1.75;color:#444;background:transparent;resize:none;min-height:56px;margin-bottom:12px;}
.idea-desc-ta::placeholder{color:#ccc;}
.idea-rank-row{display:flex;align-items:center;gap:6px;}
.idea-rank-lbl{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-right:4px;}
.idea-star{font-size:20px;cursor:pointer;line-height:1;transition:transform .1s;user-select:none;}
.idea-star:hover{transform:scale(1.2);}

/* ── goals view ── */
.goals-view{padding:28px 52px 80px;max-width:760px;}
.gv-sort{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center;}
.gv-sort-btn{padding:5px 14px;border:1.5px solid #e0d8cc;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#888;cursor:pointer;background:none;transition:all .2s;}
.gv-sort-btn.active{background:#1a1a1a;color:#F5F0E8;border-color:#1a1a1a;}
.goal-card{background:white;border-radius:10px;padding:15px 18px;margin-bottom:12px;border:1.5px solid #dde6ef;transition:border-color .2s,opacity .2s;}
.goal-card:focus-within{border-color:#5a7fa860;}
.goal-card.is-done{opacity:.5;}
.goal-top{display:flex;align-items:center;gap:8px;}
.goal-caret{background:none;border:none;color:#b8c6d4;cursor:pointer;font-size:11px;padding:3px 5px;flex-shrink:0;transition:color .15s;line-height:1;}
.goal-caret:hover{color:#5a7fa8;}
.goal-title-inp{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:'Playfair Display',serif;font-size:17px;font-weight:600;color:#1a1a1a;}
.goal-title-inp::placeholder{color:#ccc;font-weight:400;}
.goal-card.is-done .goal-title-inp{text-decoration:line-through;color:#999;}
.goal-actions{display:flex;gap:1px;flex-shrink:0;}
.goal-btn{background:none;border:none;color:#d5dde5;cursor:pointer;font-size:13px;padding:3px 4px;line-height:1;transition:color .15s;}
.goal-btn:hover{color:#5a7fa8;}
.goal-btn.del:hover{color:#e07070;}
.goal-btn:disabled{opacity:.3;cursor:default;}
.goal-meta{display:flex;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap;}
.goal-date{border:none;outline:none;background:#f2f6fa;border-radius:6px;padding:4px 8px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#5a7fa8;cursor:pointer;flex-shrink:0;}
.goal-date::-webkit-calendar-picker-indicator{opacity:.45;cursor:pointer;}
.goal-cd{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:#eef3f8;color:#5a7fa8;flex-shrink:0;}
.goal-cd.none{background:#f4f4f4;color:#bbb;font-weight:400;}
.goal-cd.soon{background:#fdf3e3;color:#c98a2e;}
.goal-cd.over{background:#fdecec;color:#c05050;}
.goal-prog{flex:1;min-width:70px;height:5px;border-radius:3px;background:#eef2f6;overflow:hidden;}
.goal-prog-fill{height:100%;background:#5a7fa8;border-radius:3px;transition:width .3s;}
.goal-prog-lbl{font-size:10px;color:#a8b8c8;flex-shrink:0;}
.goal-body{margin-top:13px;padding-top:12px;border-top:1px solid #f0f4f8;}
.goal-sec-lbl{font-size:10px;color:#a8b8c8;text-transform:uppercase;letter-spacing:1px;margin-bottom:7px;}
.step-row{display:flex;align-items:center;gap:9px;background:#f7fafc;border-radius:7px;padding:7px 10px;margin-bottom:5px;flex-wrap:wrap;}
.step-span{flex:0 0 100%;display:flex;align-items:center;gap:7px;margin:1px 0 0 27px;}
.wp-span{margin:4px 0 0 26px;}
.step-inp{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:13px;font-weight:300;color:#1a1a1a;}
.step-inp::placeholder{color:#c5cfd8;}
.step-inp.struck{text-decoration:line-through;color:#bbb;}
.step-date{border:none;outline:none;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#8fa8bf;cursor:pointer;flex-shrink:0;width:26px;transition:width .2s;}
.step-date.set{width:100px;}
.step-date::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer;}
.step-cd{font-size:10px;color:#a8b8c8;flex-shrink:0;}
.step-cd.over{color:#c05050;}
.goal-add-step{margin-top:2px;background:none;border:1.5px dashed #dde6ef;border-radius:7px;padding:7px 10px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#a8b8c8;cursor:pointer;width:100%;text-align:left;transition:all .2s;}
.goal-add-step:hover{border-color:#5a7fa8;color:#5a7fa8;background:#5a7fa808;}

/* ── goal timing (date / week / ongoing) ── */
.tim-seg{display:inline-flex;border:1.5px solid #e2e9f0;border-radius:7px;overflow:hidden;flex-shrink:0;}
.tim-btn{border:none;background:none;padding:4px 9px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#9fb0c2;cursor:pointer;transition:all .15s;}
.tim-btn+.tim-btn{border-left:1.5px solid #e2e9f0;}
.tim-btn.on{background:#5a7fa8;color:white;}
.tim-btn:hover:not(.on){background:#f0f5fa;color:#5a7fa8;}
.goal-week{border:none;outline:none;background:#f2f6fa;border-radius:6px;padding:4px 7px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#5a7fa8;cursor:pointer;max-width:190px;}
.goal-cd.ongoing{background:#eaf3ee;color:#4f8f68;}
.step-sched{display:flex;align-items:center;gap:5px;margin-left:auto;flex-shrink:0;}
.step-cd.ongoing{color:#4f8f68;}

/* ── start date / span ── */
.btn-tiny{padding:3px 10px;border:1.5px dashed #dde6ef;border-radius:20px;background:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:10px;color:#b8c6d4;cursor:pointer;transition:all .2s;flex-shrink:0;}
.btn-tiny:hover{border-color:#5a7fa8;color:#5a7fa8;background:#5a7fa808;}
.goal-start{display:flex;align-items:center;gap:1px;flex-shrink:0;}
.goal-start .goal-date{background:#f5f8fa;color:#8fa8bf;}
.goal-span{display:flex;align-items:center;gap:8px;margin-top:9px;}
.span-bar{flex:1;min-width:50px;height:4px;border-radius:3px;background:#eef2f6;overflow:hidden;}
.span-fill{height:100%;background:#9db8d4;border-radius:3px;transition:width .3s;}
.span-lbl{font-size:10px;color:#a8b8c8;flex-shrink:0;}
.span-lbl.pre{color:#c98a2e;font-weight:600;}
.gt-badge.pre{background:#fdf6ea;color:#c98a2e;}

/* ── week planner ── */
.wp-nav{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.wp-arrow{width:32px;height:32px;border:1.5px solid #dde6ef;border-radius:8px;background:white;color:#5a7fa8;font-size:13px;cursor:pointer;flex-shrink:0;transition:all .2s;}
.wp-arrow:hover{border-color:#5a7fa8;background:#f2f6fa;}
.wp-title{flex:1;min-width:0;}
.wp-w{font-family:'Playfair Display',serif;font-size:19px;font-weight:600;color:#1a1a1a;line-height:1.15;}
.wp-w.now{color:#5a7fa8;}
.wp-range{font-size:11px;color:#a8b8c8;margin-top:1px;}
.wp-prog{font-size:11px;color:#5a7fa8;font-weight:600;flex-shrink:0;}
.wp-days{display:flex;gap:4px;margin-bottom:16px;}
.wp-day{flex:1;min-width:0;border-radius:8px;background:#f4f7fa;padding:6px 2px;text-align:center;transition:all .15s;}
.wp-day.today{background:#5a7fa8;}
.wp-day.today .wp-day-lbl,.wp-day.today .wp-day-num{color:white;}
.wp-day-lbl{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.4px;color:#a8b8c8;font-weight:600;}
.wp-day-num{display:block;font-size:13px;color:#5a7fa8;font-weight:600;line-height:1.3;}
.wp-day-cnt{display:block;font-size:8px;color:#8fa8bf;}
.wp-day.today .wp-day-cnt{color:#dce7f2;}
.wp-goal{background:white;border:1.5px solid #dde6ef;border-radius:10px;padding:13px 15px;margin-bottom:11px;}
.wp-goal.done{opacity:.55;}
.wp-goal.gt-drop-into{border-color:#5a7fa8;background:#eef4fa;}
.wp-step.gt-drop-into{background:#eef4fa;border-radius:7px;}
.wp-step{border:1.5px solid transparent;}
.wp-goal-hd{display:flex;align-items:center;gap:9px;}
.wp-goal-inp{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:'Playfair Display',serif;font-size:16px;font-weight:600;color:#1a1a1a;}
.wp-goal-inp::placeholder{color:#ccc;font-weight:400;}
.wp-goal-inp.struck{text-decoration:line-through;color:#aaa;}
.wp-steps{margin-top:11px;padding-top:10px;border-top:1px solid #f0f4f8;}
.wp-step{margin-bottom:7px;}
.wp-step-top{display:flex;align-items:center;gap:8px;}
.wp-step-inp{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:13px;font-weight:300;color:#1a1a1a;}
.wp-step-inp::placeholder{color:#c5cfd8;}
.wp-step-inp.struck{text-decoration:line-through;color:#bbb;}
.wp-chips{display:flex;gap:3px;margin:5px 0 0 26px;}
.wp-chip{flex:1;min-width:0;padding:3px 0;border:1.5px solid #eef2f6;border-radius:5px;background:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.2px;color:#c3cfdb;cursor:pointer;transition:all .15s;}
.wp-chip:hover{border-color:#5a7fa8;color:#5a7fa8;}
.wp-chip.on{background:#5a7fa8;border-color:#5a7fa8;color:white;}
.wp-chip.today-c:not(.on){border-color:#c8d8e8;color:#8fa8bf;}
.wp-also{margin-top:22px;}
.wp-also-hd{font-size:10px;color:#a8b8c8;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;}

/* ── goal notes ── */
.gnote-list{display:flex;flex-direction:column;gap:7px;}
.gnote{background:#f7fafc;border-radius:8px;border:1.5px solid transparent;padding:7px 12px 9px;transition:border-color .2s;}
.gnote:focus-within{border-color:#5a7fa850;}
.gnote-head{display:flex;align-items:center;justify-content:space-between;}
.gnote-ts{font-size:10px;color:#5a7fa8;font-weight:500;letter-spacing:.3px;}
.gnote-ta{width:100%;border:none;outline:none;background:transparent;resize:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;line-height:1.7;color:#1a1a1a;min-height:40px;}
.gnote-ta::placeholder{color:#c3cfdb;}
.step-dlbl{font-size:9px;color:#b8c6d4;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0;}
.step-cd.legacy{border:1.5px solid #dde6ef;border-radius:20px;background:none;padding:2px 8px;color:#8fa8bf;cursor:pointer;font-size:10px;transition:all .2s;}
.step-cd.legacy:hover{border-color:#5a7fa8;color:#5a7fa8;}

/* ── recurring period strip ── */
.pstrip{display:flex;gap:4px;margin-top:9px;flex-wrap:wrap;}
.pdot{width:34px;height:30px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:10px;cursor:pointer;background:#f0f4f8;color:#c3cfdb;transition:all .15s;}
.pdot.on{background:#5a7fa8;color:white;}
.pdot.now{box-shadow:0 0 0 1.5px #5a7fa8;}
.pdot:hover{filter:brightness(.96);}
.pdot-lbl{font-size:8px;font-weight:500;letter-spacing:.2px;opacity:.75;}
.goal-cd.recur{background:#eef0fb;color:#6b6fc0;}
.step-cd.recur{color:#6b6fc0;font-weight:600;}
.gt-badge.recur{background:#eef0fb;color:#6b6fc0;}
.gw-recur{background:#f7f9fd;border-radius:10px;padding:12px 13px 4px;border:1.5px solid #e4ebf4;}
.tim-sel{max-width:126px;}

/* ── goal tree (drag & drop) ── */
.gt-hint{font-size:11px;color:#b8c6d4;margin-bottom:12px;}
.gt-node{position:relative;}
.gt-row{display:flex;align-items:center;gap:8px;border:1.5px solid transparent;border-radius:9px;transition:background .15s,border-color .15s;}
.gt-root{background:white;border-color:#dde6ef;padding:9px 11px;margin-bottom:6px;}
.gt-child{background:#f7fafc;padding:7px 10px;margin-bottom:5px;}
.gt-children{margin-left:20px;padding-left:18px;border-left:1.5px solid #e2e9f0;margin-bottom:8px;}
.gt-child::before{content:"";position:absolute;left:-18px;top:50%;width:14px;height:1.5px;background:#e2e9f0;}
.gt-child-wrap{position:relative;}
.gt-grip{flex-shrink:0;color:#c6d2de;font-size:13px;line-height:1;padding:3px 2px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.gt-grip:active{cursor:grabbing;color:#5a7fa8;}
.gt-title{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;color:#1a1a1a;}
.gt-root .gt-title{font-family:'Playfair Display',serif;font-size:16px;font-weight:600;}
.gt-title.struck{text-decoration:line-through;color:#bbb;}
.gt-title::placeholder{color:#ccc;}
.gt-dragging{opacity:.35;}
.gt-drop-before{box-shadow:0 -3px 0 -1px #5a7fa8;}
.gt-drop-after{box-shadow:0 3px 0 -1px #5a7fa8;}
.gt-drop-into{border-color:#5a7fa8;background:#eef4fa;}
.gt-badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;background:#eef3f8;color:#5a7fa8;flex-shrink:0;}
.gt-badge.over{background:#fdecec;color:#c05050;}
.gt-badge.soon{background:#fdf3e3;color:#c98a2e;}
.gt-badge.ongoing{background:#eaf3ee;color:#4f8f68;}
.gt-badge.none{background:#f4f4f4;color:#bbb;font-weight:400;}

/* ── goals by week ── */
.gw-week{margin-bottom:16px;}
.gw-hd{display:flex;align-items:baseline;gap:9px;margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid #eef2f6;}
.gw-num{font-family:'Playfair Display',serif;font-size:16px;font-weight:600;color:#1a1a1a;}
.gw-num.now{color:#5a7fa8;}
.gw-range{font-size:11px;color:#a8b8c8;}
.gw-count{font-size:10px;color:#c0ccd8;margin-left:auto;text-transform:uppercase;letter-spacing:.8px;}
.gw-item{display:flex;align-items:center;gap:9px;background:white;border:1.5px solid #eef2f6;border-radius:8px;padding:8px 11px;margin-bottom:5px;}
.gw-item.sub{background:#f7fafc;border-color:transparent;margin-left:18px;}
.gw-txt{flex:1;min-width:0;font-size:13px;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gw-txt.struck{text-decoration:line-through;color:#bbb;}
.gw-parent{font-size:10px;color:#a8b8c8;flex-shrink:0;max-width:36%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ── reports view (company research tracker) ── */
.rc-co{background:white;border-radius:10px;padding:16px 18px;margin-bottom:14px;border:1.5px solid #e2ece3;}
.rc-hd{margin-bottom:13px;padding-bottom:11px;border-bottom:1px solid #f0f6f0;}
.rc-name{font-family:'Playfair Display',serif;font-size:17px;font-weight:600;color:#1a1a1a;line-height:1.3;}
.rc-badge{display:inline-block;margin-left:8px;padding:2px 9px;border-radius:20px;background:#4a6fa5;color:white;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:10px;font-weight:600;vertical-align:middle;}
.rc-stats{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:11px;color:#a8c0ab;}
.rc-stats strong{color:#5a9a60;font-weight:600;}
.rc-note{padding-top:12px;margin-top:12px;border-top:1px solid #f4f9f4;}
.rc-note.first{padding-top:0;margin-top:0;border-top:none;}
.rc-note-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;}
.rc-note-date{font-size:10px;color:#5a9a60;font-weight:500;letter-spacing:.3px;}
.rp-notes{margin-top:9px;padding-top:9px;border-top:1px solid #eef4ee;}
.reports-view .gnote{background:#f4faf5;}
.reports-view .gnote:focus-within{border-color:#5a9a6050;}
.reports-view .gnote-ts{color:#5a9a60;}
.reports-view .goal-add-step{border-color:#dbeadd;color:#9dbca3;}
.reports-view .goal-add-step:hover{border-color:#5a9a60;color:#5a9a60;background:#5a9a6008;}
.rp-span{display:flex;align-items:center;gap:8px;margin-top:7px;}
.rp-rows{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:-12px 0 20px;}
.rp-rlbl{font-size:10px;color:#a8b8c8;text-transform:uppercase;letter-spacing:.9px;}
.rp-depth{display:inline-flex;border:1.5px solid #e2ece3;border-radius:20px;overflow:hidden;flex-shrink:0;}
.rp-depth button{border:none;background:none;padding:2px 10px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:10px;color:#8aa890;cursor:pointer;transition:all .15s;white-space:nowrap;}
.rp-depth button+button{border-left:1.5px solid #e2ece3;}
.rp-depth button:hover:not(.on){background:#f2f8f3;color:#5a9a60;}
.rp-depth button.on{background:#5a9a60;color:white;}
.rp-depth button.on.deep{background:#4a6fa5;}

.reports-view{padding:28px 52px 80px;max-width:760px;}
.rp-add{display:flex;gap:7px;margin-bottom:24px;flex-wrap:wrap;}
.rp-add-inp{flex:1;min-width:150px;border:1.5px solid #e0d8cc;border-radius:8px;background:white;padding:10px 13px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;color:#1a1a1a;outline:none;transition:border-color .2s;}
.rp-add-inp:focus{border-color:#5a9a60;}
.rp-add-inp::placeholder{color:#ccc;}
.rp-btn{padding:9px 14px;border:1.5px solid #5a9a60;border-radius:8px;background:none;color:#5a9a60;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap;}
.rp-btn:hover{background:#5a9a6012;}
.rp-btn.solid{background:#5a9a60;color:white;}
.rp-btn.solid:hover{background:#4c8852;}
.rp-sec-hd{font-family:'Playfair Display',serif;font-size:17px;font-weight:600;margin-bottom:4px;}
.rp-bucket{font-size:10px;color:#8ab890;text-transform:uppercase;letter-spacing:1.5px;margin:14px 0 6px;}
.rp-bucket.over{color:#c05050;}
.rp-card{display:flex;align-items:flex-start;gap:10px;background:white;border-radius:9px;padding:11px 12px;margin-bottom:6px;border:1.5px solid transparent;transition:border-color .2s;}
.rp-card:focus-within{border-color:#5a9a6040;}
.rp-card.read{border-color:#e6f0e7;}
.rp-card .ck{margin-top:2px;}
.rp-card .ck.done{background:#5a9a60;border-color:#5a9a60;}
.rp-card-main{flex:1;min-width:0;}
.rp-co-inp{width:100%;border:none;outline:none;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:500;color:#1a1a1a;}
.rp-co-inp::placeholder{color:#ccc;}
.rp-meta{display:flex;align-items:center;gap:5px;margin-top:6px;flex-wrap:wrap;}
.rp-chip{padding:2px 9px;border:1.5px solid #e2ece3;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:10px;color:#8aa890;background:none;cursor:pointer;transition:all .2s;}
.rp-chip:hover{border-color:#5a9a60;color:#5a9a60;}
.rp-chip.on{background:#5a9a60;border-color:#5a9a60;color:white;}
.rp-date{border:none;outline:none;background:#f2f8f3;border-radius:6px;padding:3px 7px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#5a9a60;cursor:pointer;}
.rp-date::-webkit-calendar-picker-indicator{opacity:.45;cursor:pointer;}

/* ── book notes (timestamped, inside a book card) ── */
.bnote-list{display:flex;flex-direction:column;gap:7px;}
.bnote{background:#f4fafa;border-radius:8px;border:1.5px solid transparent;padding:7px 12px 9px;transition:border-color .2s;}
.bnote:focus-within{border-color:#8ababa50;}
.bnote-head{display:flex;align-items:center;justify-content:space-between;}
.bnote-ts{font-size:10px;color:#4a9a9a;font-weight:500;letter-spacing:.3px;}
.bnote-ta{width:100%;border:none;outline:none;background:transparent;resize:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;line-height:1.7;color:#1a1a1a;min-height:40px;}
.bnote-ta::placeholder{color:#c8d4d4;}
.bnote-add{margin-top:7px;background:none;border:1.5px dashed #cfe2e2;border-radius:8px;padding:8px 12px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#9dbaba;cursor:pointer;width:100%;text-align:left;transition:all .2s;}
.bnote-add:hover{border-color:#8ababa;color:#4a9a9a;background:#8ababa08;}

/* ── reading view (all notes grouped by book) ── */
.reading-view{padding:28px 52px 80px;max-width:760px;}
.rv-book{background:white;border-radius:10px;padding:18px;margin-bottom:16px;border:1.5px solid #dfeded;}
.rv-book-hd{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #eef5f5;}
.rv-book-title{font-family:'Playfair Display',serif;font-size:17px;font-weight:600;color:#1a1a1a;line-height:1.3;}
.rv-book-author{font-size:12px;color:#8ababa;margin-top:2px;}
.rv-book-stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;font-size:11px;color:#a8c0c0;}
.rv-book-stats strong{color:#4a9a9a;font-weight:600;}
.rv-note{padding-top:13px;margin-top:13px;border-top:1px solid #f2f8f8;}
.rv-note.first{padding-top:0;margin-top:0;border-top:none;}
.rv-note-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;}
.rv-note-date{font-size:10px;color:#4a9a9a;font-weight:500;letter-spacing:.3px;cursor:pointer;}
.rv-note-date:hover{text-decoration:underline;}
.rv-no-notes{font-size:12px;color:#ccc;font-style:italic;}

/* ── notes (takeaways) ── */
.note-block{background:white;border-radius:8px;border:1.5px solid transparent;transition:border-color .2s,box-shadow .2s;overflow:hidden;}
.note-block:focus-within{border-color:#8a7acc30;box-shadow:0 2px 14px rgba(138,122,204,.08);}
.note-src-bar{display:flex;align-items:center;gap:6px;padding:7px 14px 5px;background:#f7f5ff;border-bottom:1px solid #ede9f8;}
.note-src-ic{font-size:11px;color:#9b8fd0;flex-shrink:0;}
.note-src-inp{flex:1;border:none;outline:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#7a6aaa;background:transparent;}
.note-src-inp::placeholder{color:#c8c0e0;}
.note-ts-lbl{font-size:10px;color:#9b8fd0;font-weight:500;letter-spacing:.3px;flex-shrink:0;}
.ic-notes{background:#EDE8F5;}
.past-note-block{border-left:2px solid #9b8fd0;padding:6px 0 6px 14px;margin-bottom:10px;}
.past-note-src{font-size:10px;color:#9b8fd0;font-weight:500;text-transform:uppercase;letter-spacing:.8px;margin-bottom:3px;}
.past-note-txt{font-size:14px;font-weight:300;color:#333;line-height:1.7;white-space:pre-wrap;}

/* ── reading tracker (multi-book) ── */
.book-list{display:flex;flex-direction:column;gap:14px;}
.book-card{background:white;border-radius:10px;padding:16px;border:1.5px solid transparent;transition:border-color .2s;}
.book-card:focus-within{border-color:#8ababa30;}
.book-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.book-num{font-family:'Playfair Display',serif;font-size:12px;color:#8ababa;font-style:italic;}
.book-del{background:none;border:none;color:#ddd;cursor:pointer;font-size:14px;transition:color .15s;}
.book-del:hover{color:#e07070;}
.book-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.bf{display:flex;flex-direction:column;gap:3px;}
.bf-lbl{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:1px;}
.bf-inp{border:none;outline:none;border-bottom:1.5px solid #e8e2d8;padding:4px 0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;color:#1a1a1a;background:transparent;transition:border-color .2s;width:100%;}
.bf-inp:focus{border-color:#8ababa;}
.bf-inp::placeholder{color:#ddd;}
.mins-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
.mb{width:28px;height:28px;border-radius:6px;border:1.5px solid #e8e2d8;background:none;cursor:pointer;font-size:14px;color:#888;display:flex;align-items:center;justify-content:center;transition:all .2s;flex-shrink:0;}
.mb:hover{border-color:#8ababa;color:#8ababa;}
.mv{font-family:'Playfair Display',serif;font-size:20px;font-weight:600;color:#1a1a1a;min-width:36px;text-align:center;}
.mu{font-size:11px;color:#aaa;margin-right:8px;}
.preset{padding:3px 9px;border:1.5px solid #e8e2d8;border-radius:20px;font-size:11px;color:#888;cursor:pointer;background:none;transition:all .2s;}
.preset:hover,.preset.on{border-color:#8ababa;color:#8ababa;background:#8ababa10;}
.book-time-row{display:flex;align-items:flex-end;gap:10px;margin-bottom:12px;flex-wrap:wrap;}
.bf-time{font-size:15px;font-weight:400;color:#1a1a1a;cursor:pointer;letter-spacing:.3px;}
.bf-time::-webkit-calendar-picker-indicator{opacity:.4;cursor:pointer;}
.time-arrow{font-size:16px;color:#ccc;padding-bottom:5px;flex-shrink:0;}
.book-dur{text-align:center;background:#E8F5F5;border-radius:8px;padding:6px 12px;flex-shrink:0;}
.book-dur-val{font-size:16px;font-weight:600;color:#4a9a9a;line-height:1;}
.book-dur-lbl{font-size:10px;color:#8ababa;text-transform:uppercase;letter-spacing:.8px;margin-top:2px;}
.reading-now-badge{font-size:11px;color:#8ababa;margin-bottom:10px;font-style:italic;}
.reading-total{background:#E8F5F5;border-radius:8px;padding:11px 16px;font-size:13px;color:#4a9a9a;margin-bottom:8px;}
.reading-total strong{font-size:16px;font-weight:600;}

/* ── my quotes ── */
.quote-collector{display:flex;flex-direction:column;gap:12px;}
.my-quote-card{background:white;border-radius:10px;padding:16px;border:1.5px solid transparent;transition:border-color .2s;}
.my-quote-card:focus-within{border-color:#C8A96E30;}
.mqc-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
.mqc-ts{font-size:10px;color:#C8A96E;font-weight:500;}
.mqc-del{background:none;border:none;color:#ddd;cursor:pointer;font-size:14px;transition:color .15s;}
.mqc-del:hover{color:#e07070;}
.mq-ta{width:100%;border:none;outline:none;font-family:'Playfair Display',serif;font-style:italic;font-size:15px;line-height:1.75;color:#1a1a1a;background:transparent;resize:none;min-height:60px;margin-bottom:8px;}
.mq-ta::placeholder{color:#ccc;}
.mq-src{width:100%;border:none;outline:none;border-bottom:1.5px solid #e8e2d8;padding:3px 0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#888;background:transparent;transition:border-color .2s;}
.mq-src:focus{border-color:#C8A96E;}
.mq-src::placeholder{color:#ddd;}

/* ── gratitude ── */
.grat-list{display:flex;flex-direction:column;gap:8px;}
.grat-row{display:flex;align-items:center;gap:12px;background:white;border-radius:8px;padding:13px 14px;border:1.5px solid transparent;transition:border-color .2s;}
.grat-row:focus-within{border-color:#C8A96E30;}
.gn{font-family:'Playfair Display',serif;font-size:18px;color:#d0c0e0;font-style:italic;flex-shrink:0;width:18px;text-align:center;}
.gi{flex:1;border:none;outline:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;color:#1a1a1a;background:transparent;}
.gi::placeholder{color:#ccc;}

/* ── weekly reflection ── */
.ref-badge{display:inline-block;margin-bottom:10px;padding:4px 10px;background:#DBE4ED;border-radius:20px;font-size:10px;color:#6a8aaa;text-transform:uppercase;letter-spacing:1px;}
.ref-ta{width:100%;min-height:110px;border:1.5px solid transparent;border-radius:8px;background:white;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-style:italic;font-size:14px;line-height:1.8;color:#1a1a1a;resize:vertical;outline:none;transition:border-color .2s;}
.ref-ta:focus{border-color:#9bafc030;}
.ref-ta::placeholder{color:#ccc;}

/* ── focus view ── */
.focus-view{padding:28px 52px 80px;max-width:760px;}
.focus-date-hd{display:flex;align-items:baseline;gap:10px;margin:22px 0 8px;}
.focus-date-lbl{font-family:'Playfair Display',serif;font-size:15px;font-weight:600;color:#1a1a1a;}
.focus-date-lbl.today-lbl{color:#C8A96E;}
.focus-date-stat{font-size:10px;color:#bbb;text-transform:uppercase;letter-spacing:1px;}
.focus-todo{display:flex;align-items:center;gap:10px;background:white;border-radius:8px;padding:10px 12px;margin-bottom:6px;border:1.5px solid transparent;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.focus-todo:hover{border-color:#C8A96E30;box-shadow:0 2px 8px rgba(200,169,110,.1);}
.focus-todo.done-row{opacity:.55;}
.focus-todo-txt{flex:1;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;color:#1a1a1a;user-select:none;}
.focus-todo-txt.struck{text-decoration:line-through;color:#bbb;}

/* ── past view ── */
.past-wrap{padding:28px 52px 80px;max-width:760px;}
.edit-lnk{display:inline-block;margin-bottom:22px;background:none;border:1.5px solid #e0d8cc;border-radius:6px;padding:7px 16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:11px;color:#aaa;cursor:pointer;transition:all .2s;}
.edit-lnk:hover{border-color:#C8A96E;color:#C8A96E;}
.past-sec{margin-bottom:28px;}
.past-lbl{font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#bbb;margin-bottom:10px;}
.past-diary-block{margin-bottom:16px;}
.past-ts{font-size:10px;color:#C8A96E;margin-bottom:4px;font-weight:500;}
.past-inv-ts{font-size:10px;color:#5a9a60;margin-bottom:4px;font-weight:500;}
.past-diary-txt{font-family:'Playfair Display',serif;font-size:15px;line-height:1.85;color:#333;white-space:pre-wrap;}
.past-todo{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:300;color:#444;padding:4px 0;}
.past-dot{width:5px;height:5px;border-radius:50%;background:#C8A96E;flex-shrink:0;}
.past-todo.di{color:#bbb;text-decoration:line-through;}
.past-grat{font-size:14px;font-weight:300;color:#555;padding:4px 0;display:flex;gap:10px;}
.pgn{font-family:'Playfair Display',serif;font-style:italic;color:#c0b0d0;}
.past-loc{display:flex;align-items:center;gap:6px;font-size:13px;color:#888;font-weight:300;margin-bottom:6px;}
.past-loc-pin{color:#C8A96E;}
.past-book{background:#F0F7F7;border-radius:8px;padding:12px 14px;margin-bottom:8px;}
.past-book-title{font-weight:500;color:#1a1a1a;font-size:14px;}
.past-book-meta{font-size:11px;color:#8ababa;margin-top:2px;}
.past-book-note{margin-top:8px;padding-left:10px;border-left:2px solid #a8d0d0;}
.past-book-note-ts{font-size:10px;color:#4a9a9a;font-weight:500;margin-bottom:2px;}
.past-book-note-txt{font-size:13px;color:#555;line-height:1.7;white-space:pre-wrap;}
.past-my-quote{border-left:2px solid #C8A96E;padding:8px 0 8px 14px;margin-bottom:10px;}
.pmq-text{font-family:'Playfair Display',serif;font-style:italic;font-size:14px;color:#333;line-height:1.7;margin-bottom:4px;}
.pmq-src{font-size:11px;color:#aaa;}
.empty{color:#ccc;font-style:italic;font-family:'Playfair Display',serif;font-size:14px;}

/* ── month view ── */
.month-view{padding:28px 52px 80px;max-width:760px;}
.month-nav{display:flex;align-items:center;gap:16px;margin-bottom:24px;}
.month-nav button{background:none;border:1.5px solid #e0d8cc;border-radius:6px;padding:6px 14px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:12px;color:#888;cursor:pointer;transition:all .2s;}
.month-nav button:hover{border-color:#C8A96E;color:#C8A96E;}
.month-nm{font-family:'Playfair Display',serif;font-size:24px;font-weight:400;}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;}
.cal-dow{text-align:center;font-size:10px;color:#bbb;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;}
.cal-day{aspect-ratio:1;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:12px;font-weight:300;color:#888;background:white;transition:all .2s;}
.cal-day.has{background:#1a1a1a;color:#F5F0E8;cursor:pointer;} .cal-day.has:hover{background:#2a2a2a;}
.cal-day.today{box-shadow:0 0 0 2px #C8A96E;} .cal-day.sel{background:#C8A96E;color:#1a1a1a;} .cal-day.empty{background:transparent;}
.cal-dots{display:flex;gap:2px;margin-top:2px;}
.cal-dot{width:4px;height:4px;border-radius:50%;}
.dot-d{background:#C8A96E;} .dot-g{background:#c0b0d0;} .dot-r{background:#8ababa;} .dot-q{background:#e8c878;} .dot-i{background:#5a9a60;}
.streak-note{margin-top:18px;font-size:12px;color:#aaa;font-weight:300;}
.streak-note strong{color:#1a1a1a;}

/* ── search ── */
.search-view{padding:28px 52px 80px;max-width:760px;}
.sb-wrap{position:relative;margin-bottom:22px;}
.sb-inp{width:100%;padding:13px 42px 13px 16px;border:1.5px solid #e0d8cc;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;background:white;outline:none;color:#1a1a1a;transition:border-color .2s;}
.sb-inp:focus{border-color:#C8A96E;}
.sb-ico{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:#ccc;pointer-events:none;}
.sr{background:white;border-radius:8px;padding:14px;margin-bottom:10px;cursor:pointer;border:1.5px solid transparent;transition:all .2s;}
.sr:hover{border-color:#C8A96E30;box-shadow:0 2px 10px rgba(200,169,110,.1);}
.sr-date{font-size:10px;color:#C8A96E;margin-bottom:5px;text-transform:uppercase;letter-spacing:.8px;}
.sr-snip{font-size:13px;color:#555;line-height:1.6;}
.sr-snip mark{background:#C8A96E22;color:#1a1a1a;border-radius:2px;padding:0 2px;}
.no-res{color:#ccc;font-style:italic;font-family:'Playfair Display',serif;}

/* ── export ── */
.export-view{padding:28px 52px 80px;max-width:760px;}
.ex-card{background:white;border-radius:10px;padding:22px;margin-bottom:14px;}
.ex-card h3{font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px;}
.ex-card p{font-size:13px;color:#888;margin-bottom:14px;line-height:1.6;}
.ex-btn{padding:9px 20px;border:none;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;}
.ex-btn.pri{background:#1a1a1a;color:#F5F0E8;} .ex-btn.pri:hover{background:#333;}
.ex-btn.goog{background:#4285F4;color:white;} .ex-btn.goog:hover{background:#3367d6;}
.ex-btn.goog-o{background:none;border:1.5px solid #4285F4;color:#4285F4;} .ex-btn.goog-o:hover{background:#4285F408;}
.ex-btn.sec{background:#F5F0E8;color:#888;border:1.5px solid #e0d8cc;} .ex-btn.sec:hover{border-color:#C8A96E;color:#C8A96E;}
.ex-btn:disabled{opacity:.5;cursor:not-allowed;}
.drive-card{background:linear-gradient(135deg,#e8f0fe,#f5f0ff);border:1.5px solid #c8d8f8;border-radius:10px;padding:22px;margin-bottom:14px;}
.drive-card h3{font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px;color:#1a1a2e;}
.drive-card p{font-size:13px;color:#5a6a8a;margin-bottom:14px;line-height:1.6;}
.drive-btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.drive-status{font-size:11px;color:#5a6a8a;padding:8px 12px;background:white;border-radius:6px;border:1px solid #c8d8f8;}
.drive-setup{background:#f0f4ff;border-radius:8px;padding:14px;font-size:12px;color:#5a6a8a;line-height:1.8;border:1px dashed #b0c4f0;margin-top:12px;}
.drive-setup code{background:#e0e8f8;border-radius:3px;padding:1px 5px;font-size:11px;}

/* ── bottom nav ── */
.bot-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid #e8e2d8;padding:8px 0 env(safe-area-inset-bottom,8px);z-index:40;}
.bn-items{display:flex;justify-content:space-around;}
.bn-item{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;padding:4px 6px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.8px;transition:color .2s;}
.bn-item.active,.bn-item:hover{color:#C8A96E;}
.bn-ico{font-size:17px;line-height:1;}

/* ── toast ── */
.toast{position:fixed;bottom:24px;right:24px;background:#1a1a1a;color:#C8A96E;padding:9px 18px;border-radius:100px;font-size:11px;font-weight:500;opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none;z-index:50;}
.toast.show{opacity:1;transform:translateY(0);}

/* ── responsive ── */
@media(max-width:680px){
  .sidebar{position:fixed;top:0;left:0;bottom:0;transform:translateX(-100%);z-index:30;width:260px;}
  .sidebar.open{transform:translateX(0);}
  .main{margin-left:0;}
  .topbar{display:flex;}
  .desk-nav{display:none;}
  .bot-nav{display:block;}
  .pg-head,.insp-bar,.loc-bar,.stats-row,.content,.past-wrap,.month-view,.search-view,.export-view,.ideas-view,.habits-view,.reading-view,.goals-view,.reports-view{padding-left:18px;padding-right:18px;}
  .insp-bar,.loc-bar{margin-left:18px;margin-right:18px;}
  .pg-head{padding-top:18px;}
  .pg-title{font-size:26px;}
  .main{padding-bottom:64px;}
  .toast{bottom:80px;right:16px;}
  .book-fields{grid-template-columns:1fr;}
  /* Prevent iOS auto-zoom on input focus (triggered when font-size < 16px) */
  .ti,.loc-inp,.db-ta,.bf-inp,.mq-ta,.gi,.idea-title-inp,.idea-desc-ta,.bnote-ta,
  .goal-title-inp,.gnote-ta,.step-inp,.rp-add-inp,.rp-co-inp,.gt-title,.wp-goal-inp,.wp-step-inp{font-size:16px;}
  /* the date pickers stay small — they open a native picker, so no zoom risk */
  .step-date.set{width:92px;}
}
/* keep the 9-item bottom nav from overflowing on narrow phones */
@media(max-width:480px){
  .bn-item{flex:1;min-width:0;padding:4px 0;font-size:8px;letter-spacing:.1px;gap:2px;}
  .bn-ico{font-size:15px;}
}
@media(max-width:360px){
  .bn-item{font-size:7px;}
  .bn-ico{font-size:14px;}
}
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

const Sidebar = memo(({ open, entries, selectedDate, today, onSelect, onToday, lastSync }) => (
  <div className={`sidebar${open?" open":""}`}>
    <div className="sb-head">
      <div className="sb-logo">My Journal</div>
      <div className="sb-sub">Your thoughts, your story</div>
    </div>
    <div style={{padding:"12px 0 4px"}}>
      <button className="sb-today" onClick={onToday}>✦ Today</button>
      <div className="sb-sec">Past Entries</div>
      {entries.map(e=>(
        <div key={e.date} className={`sb-entry${e.date===selectedDate?" active":""}`} onClick={()=>onSelect(e.date)}>
          <div className={`sb-edate${e.date===today?" today":""}`}>
            {e.date===today?"Today":fmtDate(e.date,{month:"short",day:"numeric",year:"numeric"})}
          </div>
          {e.diaryBlocks?.[0]?.text&&<div className="sb-eprev">{e.diaryBlocks[0].text.slice(0,44)}…</div>}
        </div>
      ))}
    </div>
    <div className="sb-foot">
      <strong>📦 Storage</strong>
      Browser local storage on this device.<br/>
      Use Drive sync or JSON export to back up and sync to your phone.
      {lastSync&&<div className="sb-sync-status">Last synced: {lastSync}</div>}
    </div>
  </div>
));

const InspirationBar = memo(() => {
  const q = getTodayDailyQuote();
  return (
    <div className="insp-bar">
      <div className="insp-mark">"</div>
      <div className="insp-body">
        <div className="insp-text">{q.text}</div>
        <div className="insp-who">— {q.who}</div>
      </div>
    </div>
  );
});

const TodoList = memo(({ todos, onChange }) => {
  const upd = useCallback((i,f,v)=>onChange(todos.map((t,j)=>j!==i?t:f==="text"?{text:v,done:getDone(t)}:{text:getTxt(t),done:v})),[todos,onChange]);
  const add  = useCallback(()=>onChange([...todos,{text:"",done:false}]),[todos,onChange]);
  const del  = useCallback(i=>{const n=todos.filter((_,j)=>j!==i);onChange(n.length?n:[{text:"",done:false}]);},[todos,onChange]);
  return (
    <div className="todo-list">
      {todos.map((t,i)=>(
        <div key={i} className="todo-row">
          <div className={`ck${getDone(t)?" done":""}`} onClick={()=>upd(i,"done",!getDone(t))}>{getDone(t)&&"✓"}</div>
          <input className={`ti${getDone(t)?" struck":""}`} value={getTxt(t)} placeholder="One thing to do today…"
            onChange={e=>upd(i,"text",e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();add();}if(e.key==="Backspace"&&!getTxt(t)&&todos.length>1)del(i);}}/>
          {todos.length>1&&<button className="rm" onClick={()=>del(i)}>×</button>}
        </div>
      ))}
      <button className="add-row" onClick={add}>+ Add another</button>
    </div>
  );
});

const JournalBlocks = memo(({ blocks, onChange }) => {
  const add = useCallback(()=>onChange([...blocks,{id:uid(),ts:nowTs(),text:""}]),[blocks,onChange]);
  const upd = useCallback((id,text)=>onChange(blocks.map(b=>b.id===id?{...b,text}:b)),[blocks,onChange]);
  const del = useCallback(id=>onChange(blocks.filter(b=>b.id!==id)),[blocks,onChange]);
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  return (
    <div className="diary-blocks">
      {blocks.map(b=>(
        <div key={b.id} className="diary-block">
          <div className="db-meta">
            <span className="db-ts">{b.ts?fmtTime(b.ts):"earlier"}</span>
            <button className="db-del" onClick={()=>del(b.id)}>×</button>
          </div>
          <textarea className="db-ta" value={b.text} placeholder="What's on your mind right now?"
            onChange={e=>{upd(b.id,e.target.value);grow(e.target);}}
            onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
        </div>
      ))}
      <button className="add-row" onClick={add}>
        {blocks.length===0?"+ Start writing…":`+ Add another entry · ${new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`}
      </button>
    </div>
  );
});

const BookCard = memo(({ book, num, onChange, onDelete }) => {
  const set        = useCallback((f,v)=>onChange({...book,[f]:v}),[book,onChange]);
  const grow       = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  const addSession = useCallback(()=>onChange({...book,sessions:[...(book.sessions||[]),blankSession()]}),[book,onChange]);
  const updSession = useCallback((id,f,v)=>onChange({...book,sessions:(book.sessions||[]).map(s=>s.id===id?{...s,[f]:v}:s)}),[book,onChange]);
  const delSession = useCallback(id=>onChange({...book,sessions:(book.sessions||[]).filter(s=>s.id!==id)}),[book,onChange]);
  const addNote    = useCallback(()=>onChange({...book,notes:[...bookNotes(book),blankBookNote()]}),[book,onChange]);
  const updNote    = useCallback((id,text)=>onChange({...book,notes:bookNotes(book).map(n=>n.id===id?{...n,text}:n)}),[book,onChange]);
  const delNote    = useCallback(id=>onChange({...book,notes:bookNotes(book).filter(n=>n.id!==id)}),[book,onChange]);
  const sessions   = book.sessions||[];
  const notes      = bookNotes(book);
  const total      = bookMins(book);
  return (
    <div className="book-card">
      <div className="book-card-head">
        <span className="book-num">Book {num}</span>
        <button className="book-del" onClick={onDelete}>×</button>
      </div>
      <div className="book-fields">
        <div className="bf">
          <div className="bf-lbl">Title</div>
          <input className="bf-inp" value={book.title} placeholder="Book title…" onChange={e=>set("title",e.target.value)}/>
        </div>
        <div className="bf">
          <div className="bf-lbl">Author</div>
          <input className="bf-inp" value={book.author} placeholder="Author…" onChange={e=>set("author",e.target.value)}/>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div className="bf-lbl">Reading sessions</div>
          <button onClick={addSession} style={{background:"none",border:"1.5px solid #8ababa",borderRadius:5,padding:"2px 10px",fontSize:11,color:"#8ababa",cursor:"pointer",transition:"all .2s"}}
            onMouseEnter={e=>{e.target.style.background="#8ababa";e.target.style.color="white";}} onMouseLeave={e=>{e.target.style.background="none";e.target.style.color="#8ababa";}}>
            + Add session
          </button>
        </div>
        {sessions.map((s,i)=>{
          const mins=calcMins(s.startTime,s.endTime);
          return (
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:8,background:"#f2fafa",borderRadius:8,padding:"8px 10px",marginBottom:5}}>
              <span style={{fontSize:11,color:"#8ababa",fontWeight:600,minWidth:22,flexShrink:0}}>#{i+1}</span>
              <input className="bf-inp bf-time" type="time" value={s.startTime||""} onChange={e=>updSession(s.id,"startTime",e.target.value)} style={{flex:1,minWidth:0,padding:"2px 0"}}/>
              <span style={{color:"#ccc",flexShrink:0}}>→</span>
              <input className="bf-inp bf-time" type="time" value={s.endTime||""} onChange={e=>updSession(s.id,"endTime",e.target.value)} style={{flex:1,minWidth:0,padding:"2px 0"}}/>
              {mins>0 ? <span style={{color:"#4a9a9a",fontSize:12,fontWeight:600,flexShrink:0,minWidth:32,textAlign:"right"}}>{fmtMins(mins)}</span>
                      : <span style={{fontSize:10,color:"#8ababa",flexShrink:0}}>now…</span>}
              {sessions.length>1&&<button className="book-del" style={{flexShrink:0,marginLeft:2}} onClick={()=>delSession(s.id)}>×</button>}
            </div>
          );
        })}
        {total>0&&sessions.length>1&&<div style={{textAlign:"right",fontSize:12,color:"#4a9a9a",fontWeight:600,marginTop:2}}>Total: {fmtMins(total)}</div>}
      </div>
      <div className="bf-lbl" style={{marginBottom:5}}>Notes / highlights</div>
      <div className="bnote-list">
        {notes.map(n=>(
          <div key={n.id} className="bnote">
            <div className="bnote-head">
              <span className="bnote-ts">{n.ts?fmtTime(n.ts):"earlier"}</span>
              <button className="book-del" onClick={()=>delNote(n.id)}>×</button>
            </div>
            <textarea className="bnote-ta" value={n.text} placeholder="Highlight, quote, or thought from this session…"
              onChange={e=>{updNote(n.id,e.target.value);grow(e.target);}}
              onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
          </div>
        ))}
      </div>
      <button className="bnote-add" onClick={addNote}>
        {notes.length===0?"+ Add a reading note…":`+ Add another note · ${fmtTime(nowTs())}`}
      </button>
    </div>
  );
});

const ReadingTracker = memo(({ books, onChange }) => {
  const addBook = useCallback(()=>onChange([...books,blankBook()]),[books,onChange]);
  const updBook = useCallback((id,updated)=>onChange(books.map(b=>b.id===id?updated:b)),[books,onChange]);
  const delBook = useCallback(id=>onChange(books.filter(b=>b.id!==id)),[books,onChange]);
  const totalMins = books.reduce((acc,b)=>acc+bookMins(b),0);
  return (
    <div className="book-list">
      {books.map((b,i)=>(
        <BookCard key={b.id} book={b} num={i+1}
          onChange={updated=>updBook(b.id,updated)}
          onDelete={()=>delBook(b.id)}/>
      ))}
      {totalMins > 0 && (
        <div className="reading-total">
          Total reading today: <strong>{fmtMins(totalMins)}</strong>
        </div>
      )}
      <button className="add-row" onClick={addBook}>+ Add a book</button>
    </div>
  );
});

const MyQuotes = memo(({ quotes, onChange }) => {
  const add = useCallback(()=>onChange([...quotes,blankMyQuote()]),[quotes,onChange]);
  const upd = useCallback((id,f,v)=>onChange(quotes.map(q=>q.id===id?{...q,[f]:v}:q)),[quotes,onChange]);
  const del = useCallback(id=>onChange(quotes.filter(q=>q.id!==id)),[quotes,onChange]);
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  return (
    <div className="quote-collector">
      {quotes.map(q=>(
        <div key={q.id} className="my-quote-card">
          <div className="mqc-head">
            <span className="mqc-ts">{q.ts?fmtTime(q.ts):""}</span>
            <button className="mqc-del" onClick={()=>del(q.id)}>×</button>
          </div>
          <textarea className="mq-ta" value={q.text} placeholder="A quote that moved you…"
            onChange={e=>{upd(q.id,"text",e.target.value);grow(e.target);}}
            onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
          <input className="mq-src" value={q.source} placeholder="Source — book title, person, or 'my own reflection'"
            onChange={e=>upd(q.id,"source",e.target.value)}/>
        </div>
      ))}
      <button className="add-row" onClick={add}>+ Capture a quote</button>
    </div>
  );
});

const GratList = memo(({ items, onChange }) => (
  <div className="grat-list">
    {items.map((g,i)=>(
      <div key={i} className="grat-row">
        <div className="gn">{i+1}</div>
        <input className="gi" value={g} placeholder={i===0?"Something good from today…":"One more thing…"}
          onChange={e=>{const n=[...items];n[i]=e.target.value;onChange(n);}}/>
      </div>
    ))}
  </div>
));

// ─── Notes / Takeaways section ────────────────────────────────────────────────
const NoteCard = memo(({ note, onChange, onDelete }) => {
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  return (
    <div className="note-block">
      <div className="note-src-bar">
        <span className="note-src-ic">✎</span>
        <input className="note-src-inp" value={note.source}
          placeholder="Source — YouTube · Article · Podcast · Book · Conversation…"
          onChange={e=>onChange({...note,source:e.target.value})}/>
        <span className="note-ts-lbl">{note.ts?fmtTime(note.ts):""}</span>
        <button className="db-del" style={{marginLeft:4}} onClick={onDelete}>×</button>
      </div>
      <textarea className="db-ta" style={{fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:14,fontStyle:"normal",fontWeight:300,lineHeight:1.75}}
        value={note.text} placeholder="Key takeaway, insight, or idea…"
        onChange={e=>{onChange({...note,text:e.target.value});grow(e.target);}}
        onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
    </div>
  );
});

const NotesSection = memo(({ notes, onChange }) => {
  const add = useCallback(()=>onChange([...notes,blankNote()]),[notes,onChange]);
  const upd = useCallback((id,updated)=>onChange(notes.map(n=>n.id===id?updated:n)),[notes,onChange]);
  const del = useCallback(id=>onChange(notes.filter(n=>n.id!==id)),[notes,onChange]);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {notes.map(n=>(
        <NoteCard key={n.id} note={n} onChange={updated=>upd(n.id,updated)} onDelete={()=>del(n.id)}/>
      ))}
      <button className="add-row" onClick={add}>
        {notes.length===0?"+ Add a note…":`+ Add another · ${new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`}
      </button>
    </div>
  );
});

// ─── DailyHabits (Write tab checklist) ───────────────────────────────────────
const DailyHabits = memo(({ checks, onChange, refreshKey }) => {
  const [habits, setHabits] = useState(()=>loadHabits());
  useEffect(()=>setHabits(loadHabits()),[refreshKey]);
  const named = habits.filter(h=>h.name.trim());
  if(!named.length) return (
    <div style={{color:"#ccc",fontSize:13,fontStyle:"italic",padding:"8px 0"}}>
      No habits set up yet — add them in the <strong style={{color:"#e8900a",fontStyle:"normal"}}>Habits</strong> tab.
    </div>
  );
  const done = named.filter(h=>checks[h.id]).length;
  return (
    <div>
      <div className="habits-list">
        {named.map(h=>(
          <div key={h.id} className={`habit-row${checks[h.id]?" checked":""}`}
            onClick={()=>onChange({...checks,[h.id]:!checks[h.id]})}>
            <div className={`hck${checks[h.id]?" on":""}`}>{checks[h.id]&&"✓"}</div>
            <span className={`habit-lbl${checks[h.id]?" struck":""}`}>{h.name}</span>
          </div>
        ))}
      </div>
      <div style={{marginTop:8,fontSize:12,color:"#e8900a",fontWeight:500,textAlign:"right"}}>
        {done}/{named.length} done today
      </div>
    </div>
  );
});

// ─── HabitsView (Habits tab — manage + streaks) ───────────────────────────────
const HabitsView = memo(({ today, refreshKey }) => {
  const [habits, setHabits] = useState(()=>loadHabits());
  const [tick,   setTick]   = useState(0);

  useEffect(()=>setHabits(loadHabits()),[refreshKey]);

  const addHabit = ()=>{ const h=[...habits,blankHabit()]; setHabits(h); saveHabits(h); };
  const updHabit = (id,name)=>{ const h=habits.map(x=>x.id===id?{...x,name}:x); setHabits(h); saveHabits(h); };
  const delHabit = id=>{ const h=habits.filter(x=>x.id!==id); setHabits(h); saveHabits(h); };

  const named = habits.filter(h=>h.name.trim());

  const HABIT_QUOTES = [
    {q:"We are what we repeatedly do. Excellence, then, is not an act, but a habit.", a:"Aristotle"},
    {q:"Motivation gets you going. Habit keeps you growing.", a:"John C. Maxwell"},
    {q:"You do not rise to the level of your goals. You fall to the level of your systems.", a:"James Clear"},
    {q:"Small daily improvements are the key to staggering long-term results.", a:"Robin Sharma"},
    {q:"Success is the product of daily habits — not once-in-a-lifetime transformations.", a:"James Clear"},
    {q:"The secret of your future is hidden in your daily routine.", a:"Mike Murdock"},
    {q:"Chains of habit are too light to be felt until they are too heavy to be broken.", a:"Warren Buffett"},
  ];
  const hq = HABIT_QUOTES[new Date().getDay() % HABIT_QUOTES.length];

  return (
    <div className="habits-view">
      <div className="eyebrow">Daily &amp; Weekly</div>
      <h1 className="pg-title">My <em>Habits</em></h1>
      <div style={{background:"#fff8ee",border:"1.5px solid #fde0b0",borderRadius:10,padding:"14px 18px",marginBottom:22,marginTop:6}}>
        <div style={{fontSize:13,fontStyle:"italic",color:"#555",lineHeight:1.6}}>"{hq.q}"</div>
        <div style={{fontSize:11,color:"#e8900a",fontWeight:600,marginTop:6}}>— {hq.a}</div>
      </div>

      {/* Manage list */}
      <div className="hv-manage">
        <div className="hv-manage-hd">Your habits</div>
        {habits.map(h=>(
          <div key={h.id} className="habit-edit-row">
            <input className="bf-inp" style={{flex:1}} value={h.name} placeholder="e.g. Morning workout, Read 20 min, Meditate…"
              onChange={e=>updHabit(h.id,e.target.value)}/>
            <button className="book-del" onClick={()=>delHabit(h.id)}>×</button>
          </div>
        ))}
        <button className="add-row" style={{marginTop:4}} onClick={addHabit}>+ Add a habit</button>
      </div>

      {/* Streaks + 7-day history */}
      {named.length>0&&(
        <>
          <div style={{fontSize:10,color:"#bbb",textTransform:"uppercase",letterSpacing:"1.5px",marginBottom:12}}>Streaks &amp; last 7 days</div>
          {named.map(h=>{
            const streak=calcHabitStreak(h.id);
            const dots=getLast7(h.id,today);
            return (
              <div key={h.id} className="habit-stat-card">
                <div className="hsc-hd">
                  <span className="hsc-name">{h.name}</span>
                  <span className="hsc-streak">{streak>0?`🔥 ${streak} day streak`:"—"}</span>
                </div>
                <div className="habit-week">
                  {dots.map(({k,done,isToday,day})=>(
                    <div key={k} className={`hwdot${done?" on":" off"}${isToday?" today-dot":""}`}>
                      <span>{done?"✓":""}</span>
                      <span className="hwdot-day">{day}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
});

// ─── IdeasView ────────────────────────────────────────────────────────────────
const STAR_LABELS = ["","Weak","Maybe","Good","Strong","Must-do"];

const IdeaCard = memo(({ idea, onChange, onDelete }) => {
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  const set  = (f,v) => onChange({...idea,[f]:v});
  return (
    <div className="idea-card">
      <div className="idea-card-head">
        <span className="idea-ts">{fmtTime(idea.createdAt)}{idea.createdAt ? " · " + new Date(idea.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : ""}</span>
        <button className="idea-del" onClick={onDelete}>×</button>
      </div>
      <input className="idea-title-inp" value={idea.title} placeholder="Idea title…"
        onChange={e=>set("title",e.target.value)}/>
      <textarea className="idea-desc-ta" value={idea.description} placeholder="What's the opportunity? Who does it help? Why now?"
        onChange={e=>{set("description",e.target.value);grow(e.target);}}
        onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
      <div className="idea-rank-row">
        <span className="idea-rank-lbl">Conviction</span>
        {[1,2,3,4,5].map(s=>(
          <span key={s} className="idea-star" title={STAR_LABELS[s]}
            onClick={()=>set("rank",idea.rank===s?0:s)}>
            {s<=idea.rank?"★":"☆"}
          </span>
        ))}
        {idea.rank>0&&<span style={{fontSize:10,color:"#C8A96E",marginLeft:4}}>{STAR_LABELS[idea.rank]}</span>}
      </div>
    </div>
  );
});

const IdeasView = memo(({ refreshKey }) => {
  const [ideas, setIdeas]   = useState(()=>loadIdeas());
  const [sort, setSort]     = useState("date");

  useEffect(()=>setIdeas(loadIdeas()),[refreshKey]);

  const persist = useCallback(updated=>{
    setIdeas(updated);
    saveIdeas(updated);
  },[]);

  const addIdea  = useCallback(()=>{
    const idea=blankIdea();
    const updated=[idea,...loadIdeas()];
    persist(updated);
  },[persist]);

  const updIdea  = useCallback((id,updated)=>{
    persist(loadIdeas().map(i=>i.id===id?updated:i));
  },[persist]);

  const delIdea  = useCallback(id=>{
    persist(loadIdeas().filter(i=>i.id!==id));
  },[persist]);

  const sorted = useMemo(()=>{
    const copy=[...ideas];
    if(sort==="rank") return copy.sort((a,b)=>b.rank-a.rank||(b.createdAt-a.createdAt));
    return copy.sort((a,b)=>b.createdAt-a.createdAt);
  },[ideas,sort]);

  return (
    <div className="ideas-view">
      <div className="eyebrow">Entrepreneurship</div>
      <h1 className="pg-title">My <em>Ideas</em></h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:20}}>
        Log ideas as they strike. Timestamp them, rank your conviction, and revisit over time.
      </p>

      <button className="add-row" style={{marginBottom:18}} onClick={addIdea}>+ Log a new idea</button>

      <div className="ideas-sort-bar">
        <button className={`ideas-sort-btn${sort==="date"?" active":""}`} onClick={()=>setSort("date")}>Newest first</button>
        <button className={`ideas-sort-btn${sort==="rank"?" active":""}`} onClick={()=>setSort("rank")}>Highest conviction</button>
        {ideas.length>0&&<span style={{fontSize:11,color:"#bbb",alignSelf:"center",marginLeft:"auto"}}>{ideas.length} idea{ideas.length!==1?"s":""}</span>}
      </div>

      {sorted.length===0&&<div className="empty" style={{marginTop:16}}>No ideas yet. Hit the button above to capture your first one.</div>}

      {sorted.map(idea=>(
        <IdeaCard key={idea.id} idea={idea}
          onChange={updated=>updIdea(idea.id,updated)}
          onDelete={()=>delIdea(idea.id)}/>
      ))}
    </div>
  );
});

// ─── GoalsView (big goals, each broken into smaller steps, on a timeline) ─────
// Set or clear a start date. Same control for a big goal and a smaller one —
// only the date input's styling differs.
const StartControl = memo(({ item, onSet, compact }) => {
  if(!spanOf(item)) return (
    <button className="btn-tiny" title="Track when this starts"
      onClick={()=>onSet("start",todayKey())}>+ start</button>
  );
  return (
    <span className="goal-start">
      <input className={compact?"step-date set":"goal-date"} type="date" value={item.start||""}
        title="Start date" onChange={e=>onSet("start",e.target.value)}/>
      <button className="goal-btn del" title="Remove start date" onClick={()=>onSet("start","")}>×</button>
    </span>
  );
});

// How far through the span we are — a countdown before it starts, a bar once
// it has, or just elapsed days when there is no deadline to measure against.
const SpanLine = memo(({ item, cls }) => {
  const sp = spanOf(item);
  if(!sp) return null;
  return (
    <div className={cls||"goal-span"}>
      {sp.notStarted
        ? <span className="span-lbl pre">starts in {sp.until}d · {fmtDate(sp.start,{month:"short",day:"numeric"})}</span>
        : sp.total>0
          ? <>
              <div className="span-bar"><div className="span-fill" style={{width:`${sp.pct}%`}}/></div>
              <span className="span-lbl">day {sp.elapsed+1} of {sp.total+1}</span>
            </>
          : <span className="span-lbl">
              started {fmtDate(sp.start,{month:"short",day:"numeric"})}
              {sp.until<0?` · ${-sp.until}d in`:" · today"}
            </span>}
    </div>
  );
});

// Timing mode plus whichever input that mode needs. Six modes is past what a
// segmented control can carry, so it's a grouped select.
const TimingSelect = ({ cls, value, onChange }) => (
  <select className={cls} value={value} title="How this is timed" onChange={onChange}>
    <optgroup label="Specific">
      {GOAL_TIMINGS.slice(0,3).map(([k,l])=><option key={k} value={k}>{l}</option>)}
    </optgroup>
    <optgroup label="Recurring">
      {GOAL_TIMINGS.slice(3,5).map(([k,l])=><option key={k} value={k}>{l}</option>)}
    </optgroup>
    <optgroup label="No deadline">
      <option value="ongoing">Ongoing</option>
    </optgroup>
  </select>
);

const TimingPicker = memo(({ item, onSet }) => {
  const t = timingOf(item);
  const set = f => e => onSet(f, e.target.value);
  return (
    <>
      <TimingSelect cls="goal-week tim-sel" value={t} onChange={set("timing")}/>
      {t==="date" &&<input className="goal-date" type="date" value={item.target||""} onChange={set("target")}/>}
      {t==="month"&&<input className="goal-date" type="month" value={item.month||""} onChange={set("month")}/>}
      {t==="week" &&<select className="goal-week" value={item.week||""} onChange={set("week")}>
        <option value="">Pick a week…</option>
        {weekOptions().map(o=><option key={o.key} value={o.key}>{o.label}</option>)}
      </select>}
    </>
  );
});

// Completion over the last few periods, for recurring goals only.
const PeriodStrip = memo(({ item, onToggleKey }) => {
  const t = timingOf(item);
  if(!isRecurring(t)) return null;
  const now = periodKeyOf(t);
  return (
    <div className="pstrip">
      {recentPeriods(t).map(p=>(
        <div key={p.key} className={`pdot${(item.doneP||{})[p.key]?" on":""}${p.key===now?" now":""}`}
          title={`${p.label}${(item.doneP||{})[p.key]?" — done":""}`}
          onClick={()=>onToggleKey&&onToggleKey(p.key)}>
          <span>{(item.doneP||{})[p.key]?"✓":""}</span>
          <span className="pdot-lbl">{p.label}</span>
        </div>
      ))}
    </div>
  );
});

const GoalCard = memo(({ goal, collapsed, canUp, canDown, onToggle, onChange, onDelete, onMove }) => {
  const grow  = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  const set   = (f,v)=>onChange({...goal,[f]:v});
  const steps = goal.steps||[];
  const real  = steps.filter(s=>s.title?.trim());
  const done  = real.filter(periodDone).length;
  const sched = schedOf(goal);
  const gDone = periodDone(goal);
  const pct   = real.length ? Math.round(done/real.length*100) : (gDone?100:0);

  const notes   = Array.isArray(goal.notes)?goal.notes:[];
  const addNote = ()=>set("notes",[...notes,{id:uid(),ts:nowTs(),text:""}]);
  const updNote = (id,text)=>set("notes",notes.map(x=>x.id===id?{...x,text}:x));
  const delNote = id=>set("notes",notes.filter(x=>x.id!==id));

  const setStep  = (id,f,v)=>set("steps",steps.map(s=>s.id===id?{...s,[f]:v}:s));
  const patchStep= (id,patch)=>set("steps",steps.map(s=>s.id===id?{...s,...patch}:s));
  const addStep = ()=>set("steps",[...steps,blankStep()]);
  const delStep = id=>set("steps",steps.filter(s=>s.id!==id));

  return (
    <div className={`goal-card${gDone&&!sched.recurring?" is-done":""}`}>
      <div className="goal-top">
        <button className="goal-caret" onClick={onToggle} title={collapsed?"Expand":"Collapse"}>{collapsed?"▶":"▼"}</button>
        <div className={`ck${gDone?" done":""}`} onClick={()=>onChange({...goal,...togglePatch(goal)})}
          title={sched.recurring?"Mark done for this period":"Mark goal achieved"}>{gDone&&"✓"}</div>
        <input className="goal-title-inp" value={goal.title} placeholder="A big goal…"
          onChange={e=>set("title",e.target.value)}/>
        <div className="goal-actions">
          <button className="goal-btn" disabled={!canUp}   onClick={()=>onMove(-1)} title="Move up">↑</button>
          <button className="goal-btn" disabled={!canDown} onClick={()=>onMove(1)}  title="Move down">↓</button>
          <button className="goal-btn del" onClick={onDelete} title="Delete goal">×</button>
        </div>
      </div>

      <div className="goal-meta">
        <StartControl item={goal} onSet={set}/>
        <TimingPicker item={goal} onSet={set}/>
        <span className={`goal-cd${sched.cls?" "+sched.cls:""}`}>{sched.label}</span>
        {real.length>0&&<>
          <div className="goal-prog"><div className="goal-prog-fill" style={{width:`${pct}%`}}/></div>
          <span className="goal-prog-lbl">{done}/{real.length}</span>
        </>}
      </div>
      <SpanLine item={goal}/>
      <PeriodStrip item={goal} onToggleKey={k=>{
        const dp={...(goal.doneP||{})}; if(dp[k]) delete dp[k]; else dp[k]=true;
        onChange({...goal,doneP:dp});
      }}/>

      {!collapsed&&(
        <div className="goal-body">
          <div className="goal-sec-lbl">Smaller goals</div>
          {steps.map(s=>{
            const ss=schedOf(s);
            return (
              <div key={s.id} className="step-row">
                <div className={`ck${periodDone(s)?" done":""}`}
                  onClick={()=>patchStep(s.id,togglePatch(s))}>{periodDone(s)&&"✓"}</div>
                <input className={`step-inp${periodDone(s)&&!ss.recurring?" struck":""}`} value={s.title} placeholder="A step toward it…"
                  onChange={e=>setStep(s.id,"title",e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addStep();}}}/>
                <div className="step-sched">
                  {timingOf(s)!=="date"&&(
                    <button className="step-cd legacy" title={`Timed "${ss.label}" — tap to switch to plain dates`}
                      onClick={()=>patchStep(s.id,{timing:"date",target:schedEndYmd(s),week:"",month:"",doneP:{}})}>
                      {ss.label} ×
                    </button>
                  )}
                  {!periodDone(s)&&!ss.recurring&&ss.days!==null&&
                    <span className={`step-cd${ss.days<0?" over":""}`}>{fmtCountdown(ss.days)}</span>}
                  <span className="step-dlbl">start</span>
                  <input className={`step-date${s.start?" set":""}`} type="date" value={s.start||""}
                    title="Start date" onChange={e=>setStep(s.id,"start",e.target.value)}/>
                  <span className="step-dlbl">due</span>
                  <input className={`step-date${s.target?" set":""}`} type="date" value={s.target||""}
                    title="Due date" onChange={e=>setStep(s.id,"target",e.target.value)}/>
                </div>
                <button className="goal-btn del" onClick={()=>delStep(s.id)}>×</button>
                <SpanLine item={s} cls="step-span"/>
              </div>
            );
          })}
          <button className="goal-add-step" onClick={addStep}>+ Add a smaller goal</button>

          <div className="goal-sec-lbl" style={{marginTop:16}}>Notes</div>
          <div className="gnote-list">
            {notes.map(nt=>(
              <div key={nt.id} className="gnote">
                <div className="gnote-head">
                  <span className="gnote-ts">{nt.ts?fmtTime(nt.ts):"earlier"}{nt.ts?` · ${fmtDate(dateKey(new Date(nt.ts)),{month:"short",day:"numeric"})}`:""}</span>
                  <button className="goal-btn del" onClick={()=>delNote(nt.id)}>×</button>
                </div>
                <textarea className="gnote-ta" value={nt.text} placeholder="A note on this goal…"
                  onChange={e=>{updNote(nt.id,e.target.value);grow(e.target);}}
                  onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
              </div>
            ))}
          </div>
          <button className="goal-add-step" onClick={addNote}>
            {notes.length===0?"+ Add a note…":`+ Add another note · ${fmtTime(nowTs())}`}
          </button>
        </div>
      )}
    </div>
  );
});

// Pointer-based drag reordering, shared by the tree and the week planner so the
// two behave identically. Pointer events rather than HTML5 drag-and-drop, which
// never fires on touch screens — this works the same with a finger as a mouse.
const useDragReorder = onCommit => {
  const [drag, setDrag] = useState(null);   // {kind:"goal"|"step", id}
  const [over, setOver] = useState(null);   // {kind, id, pos:"before"|"after"|"into"}
  const dragRef = useRef(null), overRef = useRef(null), nodes = useRef(new Map());

  const reg = (id, kind, el) => { if(el) nodes.current.set(id,{el,kind}); else nodes.current.delete(id); };

  const hitTest = y => {
    const d = dragRef.current; if(!d) return null;
    let hit = null;
    nodes.current.forEach((meta,id)=>{
      if(id===d.id || !meta.el) return;
      const r = meta.el.getBoundingClientRect();
      if(y < r.top-3 || y > r.bottom+3) return;
      // A goal dragged over another goal reorders; a step dropped on a goal
      // moves into it, and dropped on another step lands beside it.
      if(d.kind==="goal"){
        if(meta.kind!=="goal") return;
        hit = {kind:meta.kind, id, pos: y < r.top+r.height/2 ? "before" : "after"};
      } else if(meta.kind==="goal"){
        hit = {kind:meta.kind, id, pos:"into"};
      } else {
        hit = {kind:meta.kind, id, pos: y < r.top+r.height/2 ? "before" : "after"};
      }
    });
    return hit;
  };

  const onDown = (e,kind,id) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current={kind,id}; setDrag({kind,id});
  };
  const onMove = e => {
    if(!dragRef.current) return;
    const hit = hitTest(e.clientY);
    overRef.current = hit; setOver(hit);
    // nudge the scroller when dragging near the top or bottom edge
    const sc=document.querySelector(".main"); const m=70;
    if(sc){
      if(e.clientY<m) sc.scrollTop-=14;
      else if(e.clientY>window.innerHeight-m) sc.scrollTop+=14;
    }
  };
  const onUp = () => {
    const d=dragRef.current, o=overRef.current;
    dragRef.current=null; overRef.current=null; setDrag(null); setOver(null);
    if(d&&o&&o.id!==d.id) onCommit(d,o);
  };

  const dropCls = id => {
    if(!over||over.id!==id) return "";
    return over.pos==="into" ? " gt-drop-into" : over.pos==="before" ? " gt-drop-before" : " gt-drop-after";
  };
  const grip = (kind,id) => (
    <span className="gt-grip" title="Drag to move"
      onPointerDown={e=>onDown(e,kind,id)} onPointerMove={onMove}
      onPointerUp={onUp} onPointerCancel={onUp}>⠿</span>
  );

  return { drag, reg, grip, dropCls };
};

// ─── GoalTree ─────────────────────────────────────────────────────────────────
const GoalTree = memo(({ goals, onCommit, onEdit, onDelete }) => {
  const { drag, reg, grip, dropCls } = useDragReorder(onCommit);

  if(!goals.length) return (
    <div className="empty" style={{marginTop:16}}>No goals yet. Add a big one above to start the tree.</div>
  );

  return (
    <div>
      <div className="gt-hint">Drag ⠿ to reorder, or drop a smaller goal onto another big goal to move it there.</div>
      {goals.map(g=>{
        const gs=schedOf(g), steps=g.steps||[];
        return (
          <div key={g.id} className="gt-node">
            <div ref={el=>reg(g.id,"goal",el)}
              className={`gt-row gt-root${drag?.id===g.id?" gt-dragging":""}${dropCls(g.id)}`}>
              {grip("goal",g.id)}
              <div className={`ck${periodDone(g)?" done":""}`} onClick={()=>onEdit(g.id,togglePatch(g))}>{periodDone(g)&&"✓"}</div>
              <input className={`gt-title${goalClosed(g)?" struck":""}`} value={g.title} placeholder="A big goal…"
                onChange={e=>onEdit(g.id,{title:e.target.value})}/>
              {spanOf(g)?.notStarted&&<span className="gt-badge pre">starts in {spanOf(g).until}d</span>}
              <span className={`gt-badge${gs.cls?" "+gs.cls:""}`}>{gs.label}</span>
              <button className="goal-btn del" onClick={()=>onDelete(g.id)}>×</button>
            </div>
            {steps.length>0&&(
              <div className="gt-children">
                {steps.map(s=>{
                  const ss=schedOf(s);
                  return (
                    <div key={s.id} className="gt-child-wrap">
                      <div ref={el=>reg(s.id,"step",el)}
                        className={`gt-row gt-child${drag?.id===s.id?" gt-dragging":""}${dropCls(s.id)}`}>
                        {grip("step",s.id)}
                        <div className={`ck${periodDone(s)?" done":""}`}
                          onClick={()=>onEdit(g.id,{steps:steps.map(x=>x.id===s.id?{...x,...togglePatch(x)}:x)})}>{periodDone(s)&&"✓"}</div>
                        <input className={`gt-title${periodDone(s)&&!ss.recurring?" struck":""}`} value={s.title} placeholder="A smaller goal…"
                          onChange={e=>onEdit(g.id,{steps:steps.map(x=>x.id===s.id?{...x,title:e.target.value}:x)})}/>
                        {spanOf(s)?.notStarted&&<span className="gt-badge pre">starts in {spanOf(s).until}d</span>}
                        <span className={`gt-badge${ss.cls?" "+ss.cls:""}`}>{ss.label}</span>
                        <button className="goal-btn del"
                          onClick={()=>onEdit(g.id,{steps:steps.filter(x=>x.id!==s.id)})}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ─── WeekPlanner (plan one week at a time) ────────────────────────────────────
// Goals scoped to the shown week, each breakable into smaller goals; give a
// smaller goal a day and it becomes that day's goal. Recurring weekly goals and
// anything dated inside the week are listed too, so the week is complete.
const WeekPlanner = memo(({ goals, weekK, newId, onWeek, onEdit, onAdd, onDelete, onCommit }) => {
  const { drag, reg, grip, dropCls } = useDragReorder(onCommit);
  const p       = parseWeekKey(weekK) || parseWeekKey(thisWeekKey());
  const days    = weekDays(weekK);
  const today   = todayKey();
  const isNow   = weekK === thisWeekKey();
  const cy      = isoWeekOf(new Date()).year;
  const dayIn   = days.some(d=>d.ymd===today) ? today : days[0]?.ymd || "";

  const mine  = goals.filter(g=>timingOf(g)==="week" && (g.week||"")===weekK);
  // Ticked against the shown week, not whatever week it is today.
  const recur = goals.filter(g=>timingOf(g)==="weekly");
  const dated = goals.filter(g=>timingOf(g)!=="week" && !isRecurring(timingOf(g)) && effWeekKey(g)===weekK);

  const total = mine.reduce((n,g)=>n+1+(g.steps||[]).filter(s=>s.title?.trim()).length,0);
  const done  = mine.reduce((n,g)=>n+(periodDone(g)?1:0)
                  +(g.steps||[]).filter(s=>s.title?.trim()&&periodDone(s)).length,0);

  const setStep = (g,id,patch)=>onEdit(g.id,{steps:(g.steps||[]).map(s=>s.id===id?{...s,...patch}:s)});
  const addStep = (g,ymd)=>onEdit(g.id,{steps:[...(g.steps||[]),{...blankStep(),target:ymd||""}]});
  const delStep = (g,id)=>onEdit(g.id,{steps:(g.steps||[]).filter(s=>s.id!==id)});

  // How many daily goals sit on each day of this week, and how many are done.
  const perDay = {};
  mine.forEach(g=>(g.steps||[]).forEach(s=>{
    if(!s.title?.trim()||!DATE_RE.test(s.target||"")) return;
    (perDay[s.target] ||= {n:0,d:0}).n++;
    if(periodDone(s)) perDay[s.target].d++;
  }));

  return (
    <div>
      <div className="wp-nav">
        <button className="wp-arrow" onClick={()=>onWeek(shiftWeekKey(weekK,-1))} title="Previous week">◀</button>
        <div className="wp-title">
          <div className={`wp-w${isNow?" now":""}`}>W{p.week}{p.year!==cy?` · ${p.year}`:""}{isNow?" · this week":""}</div>
          <div className="wp-range">{weekRangeLabel(weekK)}</div>
        </div>
        {total>0&&<span className="wp-prog">{done}/{total}</span>}
        <button className="wp-arrow" onClick={()=>onWeek(shiftWeekKey(weekK,1))} title="Next week">▶</button>
      </div>

      {!isNow&&(
        <button className="gv-sort-btn" style={{marginBottom:14}} onClick={()=>onWeek(thisWeekKey())}>← Back to this week</button>
      )}

      <div className="wp-days">
        {days.map(d=>{
          const c=perDay[d.ymd];
          return (
            <div key={d.ymd} className={`wp-day${d.ymd===today?" today":""}`}>
              <span className="wp-day-lbl">{d.lbl}</span>
              <span className="wp-day-num">{d.dom}</span>
              <span className="wp-day-cnt">{c?`${c.d}/${c.n}`:"·"}</span>
            </div>
          );
        })}
      </div>

      {mine.map(g=>{
        const steps=orderedSteps(g.steps);
        return (
          <div key={g.id} className={`wp-goal${periodDone(g)?" done":""}${drag?.id===g.id?" gt-dragging":""}${dropCls(g.id)}`}
            ref={el=>reg(g.id,"goal",el)}>
            <div className="wp-goal-hd">
              {grip("goal",g.id)}
              <div className={`ck${periodDone(g)?" done":""}`} onClick={()=>onEdit(g.id,togglePatch(g))}>{periodDone(g)&&"✓"}</div>
              <input className={`wp-goal-inp${periodDone(g)?" struck":""}`} value={g.title} autoFocus={g.id===newId}
                placeholder={`A goal for W${p.week}…`} onChange={e=>onEdit(g.id,{title:e.target.value})}/>
              <button className="goal-btn del" onClick={()=>onDelete(g.id)} title="Delete goal">×</button>
            </div>
            <div className="wp-steps">
              {steps.map(s=>(
                <div key={s.id} className={`wp-step${drag?.id===s.id?" gt-dragging":""}${dropCls(s.id)}`}
                  ref={el=>reg(s.id,"step",el)}>
                  <div className="wp-step-top">
                    {grip("step",s.id)}
                    <div className={`ck${periodDone(s)?" done":""}`}
                      onClick={()=>setStep(g,s.id,togglePatch(s))}>{periodDone(s)&&"✓"}</div>
                    <input className={`wp-step-inp${periodDone(s)?" struck":""}`} value={s.title}
                      placeholder="A smaller goal — pick a day to make it a daily one…"
                      onChange={e=>setStep(g,s.id,{title:e.target.value})}
                      onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addStep(g,"");}}}/>
                    <StartControl item={s} compact onSet={(f,v)=>setStep(g,s.id,{[f]:v})}/>
                    <button className="goal-btn del" onClick={()=>delStep(g,s.id)}>×</button>
                  </div>
                  <SpanLine item={s} cls="step-span wp-span"/>
                  <div className="wp-chips">
                    {days.map(d=>(
                      <button key={d.ymd}
                        className={`wp-chip${s.target===d.ymd?" on":""}${d.ymd===today?" today-c":""}`}
                        title={s.target===d.ymd?"Remove the day":`Make this ${d.lbl}'s goal`}
                        onClick={()=>setStep(g,s.id, s.target===d.ymd ? {target:""} : {timing:"date",target:d.ymd})}>
                        {d.lbl}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button className="goal-add-step" onClick={()=>addStep(g,"")}>+ Smaller goal</button>
              <button className="goal-add-step" style={{marginTop:5}} onClick={()=>addStep(g,dayIn)}>+ Daily goal</button>
            </div>
          </div>
        );
      })}

      <button className="add-row" onClick={()=>onAdd(weekK)}>+ Add a goal for W{p.week}</button>
      {mine.length>1&&<div className="gt-hint" style={{marginTop:10}}>Drag ⠿ to reorder, or drop a smaller goal onto another goal to move it there.</div>}

      {(recur.length>0||dated.length>0)&&(
        <div className="wp-also">
          <div className="wp-also-hd">Also this week</div>
          {recur.map(g=>(
            <div key={g.id} className="gw-item">
              <div className={`ck${periodDone(g,weekK)?" done":""}`}
                onClick={()=>onEdit(g.id,togglePatch(g,weekK))}>{periodDone(g,weekK)&&"✓"}</div>
              <span className={`gw-txt${periodDone(g,weekK)?" struck":""}`}>{g.title||<em style={{color:"#ccc"}}>Untitled</em>}</span>
              <span className="gw-parent">every week</span>
            </div>
          ))}
          {dated.map(g=>(
            <div key={g.id} className="gw-item">
              <div className={`ck${periodDone(g)?" done":""}`} onClick={()=>onEdit(g.id,togglePatch(g))}>{periodDone(g)&&"✓"}</div>
              <span className={`gw-txt${periodDone(g)?" struck":""}`}>{g.title||<em style={{color:"#ccc"}}>Untitled</em>}</span>
              <span className="gw-parent">{schedOf(g).label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── GoalPeriods (the year broken into weeks or months) ───────────────────────
// Recurring goals are pinned at the top rather than repeated into every period,
// which would bury the one-off goals. Everything else groups by the period it
// falls in — a dated goal still lands in its calendar week and month.
const GoalPeriods = memo(({ goals, unit, onEdit }) => {
  const isWeek = unit==="week";
  const keyOf  = isWeek ? effWeekKey : effMonthKey;
  const recKind = isWeek ? "weekly" : "monthly";

  const { periods, recurring, other, undated } = useMemo(()=>{
    const map=new Map(), recurring=[], other=[], undated=[];
    const push=(k,it)=>{ if(!map.has(k)) map.set(k,[]); map.get(k).push(it); };
    const place=(entry)=>{
      const t=timingOf(entry.item);
      if(t===recKind)            recurring.push(entry);
      else if(isRecurring(t)||t==="ongoing") other.push(entry);
      else {
        const k=keyOf(entry.item);
        if(k) push(k,entry); else if(entry.kind==="goal") undated.push(entry);
      }
    };
    goals.forEach(g=>{
      place({kind:"goal",goal:g,item:g});
      // A smaller goal shows here once it carries its own schedule; otherwise
      // it simply lives under its parent in the list and tree views.
      (g.steps||[]).filter(x=>x.title?.trim()).forEach(x=>place({kind:"step",goal:g,item:x}));
    });
    return { periods:[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])), recurring, other, undated };
  },[goals,unit]);

  const now = isWeek ? thisWeekKey() : thisMonthKey();
  const cy  = isoWeekOf(new Date()).year;
  const hdr = k => {
    if(!isWeek) return { num:monthLabel(k,{month:"long"}), range:monthLabel(k,{year:"numeric"}) };
    const p=parseWeekKey(k);
    return { num:`${p.year!==cy?p.year+" ":""}W${p.week}`, range:weekRangeLabel(k) };
  };

  const toggle = e => {
    if(e.kind==="goal") onEdit(e.goal.id, togglePatch(e.item));
    else onEdit(e.goal.id,{steps:(e.goal.steps||[]).map(x=>x.id===e.item.id?{...x,...togglePatch(x)}:x)});
  };
  const row = (e,i) => (
    <div key={`${e.kind}-${e.item.id}-${i}`} className={`gw-item${e.kind==="step"?" sub":""}`}>
      <div className={`ck${periodDone(e.item)?" done":""}`} onClick={()=>toggle(e)}>{periodDone(e.item)&&"✓"}</div>
      <span className={`gw-txt${periodDone(e.item)?" struck":""}`}>
        {e.item.title||<em style={{color:"#ccc"}}>Untitled</em>}
      </span>
      {e.kind==="step"&&<span className="gw-parent">↳ {e.goal.title||"Untitled goal"}</span>}
    </div>
  );

  if(!periods.length&&!recurring.length&&!other.length&&!undated.length)
    return <div className="empty" style={{marginTop:16}}>Nothing scheduled yet. Give a goal a {unit}, a date, or a recurring cadence.</div>;

  const group = (title, sub, items, cls) => items.length>0&&(
    <div className="gw-week">
      <div className="gw-hd">
        <span className={`gw-num${cls||""}`}>{title}</span>
        <span className="gw-range">{sub}</span>
        <span className="gw-count">{items.length}</span>
      </div>
      {items.map(row)}
    </div>
  );

  return (
    <div>
      {recurring.length>0&&(
        <div className="gw-week gw-recur">
          <div className="gw-hd">
            <span className="gw-num now">Every {unit}</span>
            <span className="gw-range">
              {isWeek?`this week · ${weekRangeLabel(now)}`:`this month · ${monthLabel(now)}`}
            </span>
            <span className="gw-count">{recurring.filter(e=>periodDone(e.item)).length}/{recurring.length} done</span>
          </div>
          {recurring.map(row)}
        </div>
      )}

      {!periods.some(([k])=>k===now)&&(
        <div className="gw-week">
          <div className="gw-hd">
            <span className="gw-num now">{hdr(now).num}</span>
            <span className="gw-range">{hdr(now).range} · this {unit}</span>
          </div>
          <div className="rv-no-notes">Nothing scheduled this {unit}.</div>
        </div>
      )}

      {periods.map(([k,items])=>{
        const h=hdr(k);
        return (
          <div key={k} className="gw-week">
            <div className="gw-hd">
              <span className={`gw-num${k===now?" now":""}`}>{h.num}</span>
              <span className="gw-range">{h.range}{k===now?` · this ${unit}`:""}</span>
              <span className="gw-count">{items.length} item{items.length!==1?"s":""}</span>
            </div>
            {items.map(row)}
          </div>
        );
      })}

      {group(isWeek?"Every month":"Every week", "recurring on the other cadence", other.filter(e=>isRecurring(timingOf(e.item))))}
      {group("Ongoing", "no deadline — kept at continuously", other.filter(e=>timingOf(e.item)==="ongoing"))}
      {group("Unscheduled", `no ${unit} or date yet`, undated)}
    </div>
  );
});

const GoalsView = memo(({ refreshKey }) => {
  const [goals,     setGoals]     = useState(()=>loadGoals());
  const [sort,      setSort]      = useState("mine");
  const [view,      setView]      = useState("list");
  const [weekK,     setWeekK]     = useState(()=>thisWeekKey());
  const [wkMode,    setWkMode]    = useState("plan");
  const [newId,     setNewId]     = useState(null);
  const [collapsed, setCollapsed] = useState({});

  useEffect(()=>setGoals(loadGoals()),[refreshKey]);

  const persist = useCallback(next=>{ setGoals(next); saveGoals(next); },[]);

  // Stamp the edited goal so another device can tell which version is newer.
  const updGoal = useCallback((id,updated)=>{
    persist(loadGoals().map(g=>g.id===id?{...updated,updatedAt:nowTs()}:g));
  },[persist]);

  const addGoal = useCallback(()=>{
    const g=blankGoal();
    persist([g,...loadGoals()]);
    setCollapsed(c=>({...c,[g.id]:false}));
  },[persist]);

  // A goal created from the week planner is scoped to the week on screen.
  const addWeekGoal = useCallback(wk=>{
    const g={...blankGoal(), timing:"week", week:wk};
    persist([g,...loadGoals()]);
    setNewId(g.id);
  },[persist]);

  const delGoal = useCallback(id=>persist(loadGoals().filter(g=>g.id!==id)),[persist]);

  const moveGoal = useCallback((id,dir)=>{
    const arr=loadGoals();
    const i=arr.findIndex(g=>g.id===id), j=i+dir;
    if(i<0||j<0||j>=arr.length) return;
    [arr[i],arr[j]]=[arr[j],arr[i]];
    persist(arr);
  },[persist]);

  // Patch a goal in place — used by the tree and week views.
  const editGoal = useCallback((id,patch)=>{
    persist(loadGoals().map(g=>g.id===id?{...g,...patch,updatedAt:nowTs()}:g));
  },[persist]);

  // Apply a drag. Rejects any move that would change the total item count,
  // so a mis-hit can never silently drop a goal or a step.
  const commitDrag = useCallback((d,o)=>{
    const arr = loadGoals().map(g=>({...g, steps:[...(g.steps||[])]}));
    const count = a => a.length + a.reduce((n,g)=>n+g.steps.length,0);
    const before = count(arr);

    if(d.kind==="goal"){
      if(o.pos==="into") return;
      const from=arr.findIndex(g=>g.id===d.id);
      if(from<0||!arr.some(g=>g.id===o.id)) return;
      const [moved]=arr.splice(from,1);
      let to=arr.findIndex(g=>g.id===o.id);
      if(to<0) return;
      if(o.pos==="after") to+=1;
      arr.splice(to,0,moved);
    } else {
      const src=arr.find(g=>g.steps.some(s=>s.id===d.id));
      if(!src) return;
      const si=src.steps.findIndex(s=>s.id===d.id);
      const moved=src.steps[si];
      let dst,to;
      if(o.pos==="into"){
        dst=arr.find(g=>g.id===o.id);
        if(!dst) return;
        to=dst.steps.length;
      } else {
        dst=arr.find(g=>g.steps.some(s=>s.id===o.id));
        if(!dst) return;
        to=dst.steps.findIndex(s=>s.id===o.id)+(o.pos==="after"?1:0);
      }
      src.steps.splice(si,1);
      if(dst===src && to>si) to-=1;              // index shifted by the removal
      dst.steps.splice(to,0,moved);
    }
    if(count(arr)!==before) return;
    persist(arr.map(g=>({...g,updatedAt:nowTs()})));
  },[persist]);

  // Achieved goals sink to the bottom either way; ongoing and unscheduled last.
  const sorted = useMemo(()=>
    [...goals].sort((a,b)=>(goalClosed(a)?1:0)-(goalClosed(b)?1:0)||(sort==="deadline"?schedRank(a)-schedRank(b):0))
  ,[goals,sort]);

  const open      = goals.filter(g=>!goalClosed(g)).length;
  const overdue   = goals.filter(g=>!goalClosed(g)&&isOverdue(g)).length;
  const recurN    = goals.filter(g=>isRecurring(timingOf(g))).length;
  const ongoingN  = goals.filter(g=>!goalClosed(g)&&timingOf(g)==="ongoing").length;
  const manual    = sort==="mine";

  return (
    <div className="goals-view">
      <div className="eyebrow">Where you're headed</div>
      <h1 className="pg-title">My <em>Goals</em></h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:6}}>
        Big goals first, each broken into smaller ones — on a date, a week of the year, or ongoing with no deadline.
      </p>
      {goals.length>0&&(
        <p style={{fontSize:12,color:overdue?"#c05050":"#5a7fa8",marginBottom:18}}>
          {open} open · {goals.length-open} achieved
          {recurN?` · ${recurN} recurring`:""}{ongoingN?` · ${ongoingN} ongoing`:""}{overdue?` · ${overdue} past due`:""}
        </p>
      )}

      <button className="add-row" style={{marginBottom:16}} onClick={addGoal}>+ Add a big goal</button>

      <div className="gv-sort">
        <button className={`gv-sort-btn${view==="list"?" active":""}`}  onClick={()=>setView("list")}>List</button>
        <button className={`gv-sort-btn${view==="tree"?" active":""}`}  onClick={()=>setView("tree")}>Tree</button>
        <button className={`gv-sort-btn${view==="weeks"?" active":""}`} onClick={()=>setView("weeks")}>By week</button>
        <button className={`gv-sort-btn${view==="months"?" active":""}`} onClick={()=>setView("months")}>By month</button>
      </div>

      {view==="list"&&(
        <div className="gv-sort">
          <button className={`gv-sort-btn${manual?" active":""}`} onClick={()=>setSort("mine")}>My order</button>
          <button className={`gv-sort-btn${!manual?" active":""}`} onClick={()=>setSort("deadline")}>By deadline</button>
          {goals.length>1&&(
            <button className="gv-sort-btn" onClick={()=>{
              const allOpen=goals.every(g=>collapsed[g.id]);
              setCollapsed(allOpen?{}:Object.fromEntries(goals.map(g=>[g.id,true])));
            }}>
              {goals.every(g=>collapsed[g.id])?"Expand all":"Collapse all"}
            </button>
          )}
        </div>
      )}

      {view==="list"&&goals.length===0&&(
        <div className="empty" style={{marginTop:16}}>
          No goals yet. Add a big one above, then break it into smaller goals.
        </div>
      )}

      {view==="list"&&sorted.map(g=>{
        const i=goals.findIndex(x=>x.id===g.id);
        return (
          <GoalCard key={g.id} goal={g} collapsed={!!collapsed[g.id]}
            canUp={manual&&i>0} canDown={manual&&i<goals.length-1}
            onToggle={()=>setCollapsed(c=>({...c,[g.id]:!c[g.id]}))}
            onChange={updated=>updGoal(g.id,updated)}
            onDelete={()=>delGoal(g.id)}
            onMove={dir=>moveGoal(g.id,dir)}/>
        );
      })}

      {view==="tree"&&(
        <GoalTree goals={goals} onCommit={commitDrag} onEdit={editGoal} onDelete={delGoal}/>
      )}

      {view==="weeks"&&(
        <>
          <div className="gv-sort">
            <button className={`gv-sort-btn${wkMode==="plan"?" active":""}`} onClick={()=>setWkMode("plan")}>Plan a week</button>
            <button className={`gv-sort-btn${wkMode==="all"?" active":""}`}  onClick={()=>setWkMode("all")}>All weeks</button>
          </div>
          {wkMode==="plan"
            ?<WeekPlanner goals={goals} weekK={weekK} newId={newId} onWeek={setWeekK}
               onEdit={editGoal} onAdd={addWeekGoal} onDelete={delGoal} onCommit={commitDrag}/>
            :<GoalPeriods goals={goals} unit="week" onEdit={editGoal}/>}
        </>
      )}
      {view==="months"&&<GoalPeriods goals={goals} unit="month" onEdit={editGoal}/>}
    </div>
  );
});

// ─── ReportsView (annual reports — daily read log + reading plan) ─────────────
const RPT_BUCKETS = [
  {key:"overdue", label:"Overdue"},
  {key:"today",   label:"Today"},
  {key:"week",    label:"This Week"},
  {key:"month",   label:"This Month"},
  {key:"later",   label:"Later"},
  {key:"someday", label:"No Date Yet"},
];

const ReportStart = memo(({ r, onSet }) => (
  r.start
    ? <span className="goal-start">
        <input className="rp-date" type="date" value={r.start} title="Started on"
          onChange={e=>onSet({start:e.target.value})}/>
        <button className="goal-btn del" title="Remove start date" onClick={()=>onSet({start:""})}>×</button>
      </span>
    : <button className="btn-tiny" title="Track when you started" onClick={()=>onSet({start:todayKey()})}>+ start</button>
));

const ReportSpan = memo(({ r }) => {
  const sp = reportSpan(r);
  if(!sp) return null;
  if(sp.done) return (
    <div className="rp-span">
      <span className="span-lbl">
        {sp.total===null ? `started ${fmtDate(sp.start,{month:"short",day:"numeric"})}`
          : sp.total===0 ? "same day"
          : `took ${sp.total+1} days`}
      </span>
    </div>
  );
  return (
    <div className="rp-span">
      {sp.notStarted
        ? <span className="span-lbl pre">starts in {sp.until}d · {fmtDate(sp.start,{month:"short",day:"numeric"})}</span>
        : sp.total>0
          ? <>
              <div className="span-bar"><div className="span-fill" style={{width:`${sp.pct}%`}}/></div>
              <span className="span-lbl">day {sp.elapsed+1} of {sp.total+1}</span>
            </>
          : <span className="span-lbl">
              started {fmtDate(sp.start,{month:"short",day:"numeric"})}
              {sp.until<0?` · ${-sp.until}d in`:" · today"}
            </span>}
    </div>
  );
});

const ReportNotes = memo(({ r, open, onSet }) => {
  const notes = Array.isArray(r.notes) ? r.notes : [];
  if(!open) return null;
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  return (
    <div className="rp-notes">
      <div className="gnote-list">
        {notes.map(nt=>(
          <div key={nt.id} className="gnote">
            <div className="gnote-head">
              <span className="gnote-ts">
                {nt.ts?fmtTime(nt.ts):"earlier"}
                {nt.ts?` · ${fmtDate(dateKey(new Date(nt.ts)),{month:"short",day:"numeric"})}`:""}
              </span>
              <button className="goal-btn del"
                onClick={()=>onSet({notes:notes.filter(x=>x.id!==nt.id)})}>×</button>
            </div>
            <textarea className="gnote-ta" value={nt.text} placeholder="What stood out? Numbers, risks, questions…"
              onChange={e=>{onSet({notes:notes.map(x=>x.id===nt.id?{...x,text:e.target.value}:x)});grow(e.target);}}
              onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
          </div>
        ))}
      </div>
      <button className="goal-add-step"
        onClick={()=>onSet({notes:[...notes,{id:uid(),ts:nowTs(),text:""}]})}>
        {notes.length===0?"+ Add a note…":`+ Add another note · ${fmtTime(nowTs())}`}
      </button>
    </div>
  );
});

// Every note ever written about a company, gathered under it — sessions are how
// the work gets logged, but the research itself accumulates per company.
const ResearchByCompany = memo(({ reports, newNoteId, onNoteChange, onNoteDelete, onAddNote }) => {
  const companies = useMemo(()=>{
    const map = new Map();
    // reports is newest-first, so the first spelling seen is the current one
    reports.forEach(r=>{
      const key = normCompany(r.company); if(!key) return;
      if(!map.has(key)) map.set(key,{key,name:r.company.trim(),sessions:0,deep:false,notes:[],first:"",last:""});
      const rec = map.get(key);
      rec.sessions++;
      if(depthOf(r)==="deep") rec.deep = true;
      const d = r.status==="read" ? (r.readOn||"") : (r.due||"");
      if(d){ if(!rec.first||d<rec.first) rec.first=d; if(d>rec.last) rec.last=d; }
      (r.notes||[]).forEach(nt=>rec.notes.push({...nt, entryId:r.id, entryDate:d}));
    });
    return [...map.values()]
      .map(c=>({...c, notes:c.notes.sort((a,b)=>(Number(b.ts)||0)-(Number(a.ts)||0))}))
      .sort((a,b)=>(b.last||"").localeCompare(a.last||"") || b.notes.length-a.notes.length);
  },[reports]);

  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};

  if(!companies.length) return (
    <div className="rv-no-notes" style={{marginTop:12}}>No companies yet. Add one above to start a research log.</div>
  );

  return (
    <div>
      {companies.map(c=>(
        <div key={c.key} className="rc-co">
          <div className="rc-hd">
            <div className="rc-name">
              {c.name}
              {c.deep&&<span className="rc-badge">Deep dive</span>}
            </div>
            <div className="rc-stats">
              <span><strong>{c.sessions}</strong> session{c.sessions!==1?"s":""}</span>
              <span><strong>{c.notes.length}</strong> note{c.notes.length!==1?"s":""}</span>
              {c.first&&<span>first {fmtDate(c.first,{month:"short",day:"numeric"})}</span>}
              {c.last&&c.last!==c.first&&<span>latest {fmtDate(c.last,{month:"short",day:"numeric"})}</span>}
            </div>
          </div>

          {c.notes.map((nt,i)=>(
            <div key={`${nt.entryId}-${nt.id}`} className={`rc-note${i===0?" first":""}`}>
              <div className="rc-note-hd">
                <span className="rc-note-date">
                  {nt.ts
                    ? `${fmtDate(dateKey(new Date(nt.ts)),{month:"short",day:"numeric",year:"numeric"})} · ${fmtTime(nt.ts)}`
                    : nt.entryDate ? fmtDate(nt.entryDate,{month:"short",day:"numeric",year:"numeric"}) : "earlier"}
                </span>
                <button className="goal-btn del" onClick={()=>onNoteDelete(nt.entryId,nt.id)}>×</button>
              </div>
              <textarea className="gnote-ta" value={nt.text} autoFocus={nt.id===newNoteId}
                placeholder="What stood out? Numbers, risks, questions…"
                onChange={e=>{onNoteChange(nt.entryId,nt.id,e.target.value);grow(e.target);}}
                onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
            </div>
          ))}

          <button className="goal-add-step" style={{marginTop:12}} onClick={()=>onAddNote(c.name)}>
            + Add a note on {c.name} · {fmtTime(nowTs())}
          </button>
        </div>
      ))}
    </div>
  );
});

const ReportsView = memo(({ refreshKey }) => {
  const [reports, setReports] = useState(()=>loadReports());
  const [draft,   setDraft]   = useState("");
  const [adding,  setAdding]  = useState("new");   // depth applied to new entries
  const [filter,  setFilter]  = useState("all");
  const [openN,   setOpenN]   = useState({});      // which cards have notes expanded
  const [view,    setView]    = useState("log");   // "log" | "company"
  const [newNote, setNewNote] = useState(null);

  useEffect(()=>setReports(loadReports()),[refreshKey]);

  const persist = next=>{ setReports(next); saveReports(next); };
  const stamp   = r=>({...r, updatedAt:nowTs()});

  // Enter / "Read today" logs it as read now; "Plan" queues it for this week.
  const add = status=>{
    const company=draft.trim(); if(!company) return;
    const base={...blankReport(status, adding), company};
    if(status==="planned") base.due=endOfWeekYmd();
    persist([base, ...loadReports()]);
    setDraft("");
  };
  const upd = (id,patch)=>persist(loadReports().map(r=>r.id===id?stamp({...r,...patch}):r));
  const del = id=>persist(loadReports().filter(r=>r.id!==id));

  // The by-company view edits notes belonging to whichever entry holds them.
  const noteChange = (entryId,noteId,text)=>{
    const e=loadReports().find(x=>x.id===entryId); if(!e) return;
    upd(entryId,{notes:(e.notes||[]).map(nt=>nt.id===noteId?{...nt,text}:nt)});
  };
  const noteDelete = (entryId,noteId)=>{
    const e=loadReports().find(x=>x.id===entryId); if(!e) return;
    upd(entryId,{notes:(e.notes||[]).filter(nt=>nt.id!==noteId)});
  };
  // A note written today is research done today: it joins today's entry for
  // that company, or opens one if there isn't yet, keeping the log honest.
  const addCompanyNote = name=>{
    const list=loadReports(), key=normCompany(name);
    const note={id:uid(),ts:nowTs(),text:""};
    const todays=list.find(r=>normCompany(r.company)===key&&r.status==="read"&&r.readOn===todayKey());
    if(todays) upd(todays.id,{notes:[...(todays.notes||[]),note]});
    else {
      const everDeep=list.some(r=>normCompany(r.company)===key&&depthOf(r)==="deep");
      persist([{...blankReport("read",everDeep?"deep":"new"), company:name, notes:[note]}, ...list]);
    }
    setNewNote(note.id);
  };

  const shown   = filter==="all" ? reports : reports.filter(r=>depthOf(r)===filter);
  const newN    = reports.filter(r=>depthOf(r)==="new").length;
  const deepN   = reports.filter(r=>depthOf(r)==="deep").length;
  const planned = shown.filter(r=>r.status==="planned");
  const readLog = [...shown.filter(r=>r.status==="read")]
    .sort((a,b)=>(b.readOn||"").localeCompare(a.readOn||"")||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
  const byBucket  = k=>planned.filter(r=>reportBucket(r.due)===k)
    .sort((a,b)=>(a.due||"9999").localeCompare(b.due||"9999"));
  const readDates = [...new Set(readLog.map(r=>r.readOn||""))];
  const sow       = startOfWeekYmd();
  // Counted across everything, not the filtered slice, so narrowing the view
  // doesn't appear to change how much research you've actually done.
  const allRead    = reports.filter(r=>r.status==="read");
  const allPlanned = reports.filter(r=>r.status==="planned");
  const thisWeek   = allRead.filter(r=>r.readOn&&r.readOn>=sow).length;
  const overdue    = allPlanned.filter(r=>reportBucket(r.due)==="overdue").length;
  const filtered   = filter!=="all";

  return (
    <div className="reports-view">
      <div className="eyebrow">Companies</div>
      <h1 className="pg-title">Company <em>Research</em></h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:6}}>
        Log the companies you look at each day, marked as a first look or a deep dive, and queue what to research next.
      </p>
      {reports.length>0&&(
        <p style={{fontSize:12,color:overdue?"#c05050":"#5a9a60",marginBottom:18}}>
          {allRead.length} researched · {thisWeek} this week · {allPlanned.length} planned
          {newN?` · ${newN} new`:""}{deepN?` · ${deepN} deep ${deepN===1?"dive":"dives"}`:""}
          {overdue?` · ${overdue} overdue`:""}
        </p>
      )}

      <div className="gv-sort" style={{marginBottom:14}}>
        <button className={`gv-sort-btn${view==="log"?" active":""}`} onClick={()=>setView("log")}>Plan &amp; log</button>
        <button className={`gv-sort-btn${view==="company"?" active":""}`} onClick={()=>setView("company")}>By company</button>
      </div>

      <div className="rp-add">
        <input className="rp-add-inp" value={draft} placeholder="Company — e.g. Apple (AAPL)"
          onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();add("read");}}}/>
        <button className="rp-btn solid" onClick={()=>add("read")} title="Log it as researched today">✓ Did today</button>
        <button className="rp-btn" onClick={()=>add("planned")} title="Queue it to research later">+ Plan</button>
      </div>

      <div className="rp-rows">
        <span className="rp-rlbl">Add as</span>
        <span className="rp-depth">
          {REPORT_DEPTHS.map(([k,l])=>(
            <button key={k} className={`${adding===k?"on":""}${k==="deep"?" deep":""}`}
              onClick={()=>setAdding(k)}>{l}</button>
          ))}
        </span>
        {(newN>0||deepN>0)&&<>
          <span className="rp-rlbl" style={{marginLeft:8}}>Show</span>
          <span className="rp-depth">
            <button className={filter==="all"?"on":""} onClick={()=>setFilter("all")}>All</button>
            {REPORT_DEPTHS.map(([k,l])=>(
              <button key={k} className={`${filter===k?"on":""}${k==="deep"?" deep":""}`}
                onClick={()=>setFilter(k)}>{l}</button>
            ))}
          </span>
        </>}
      </div>

      {view==="company"
        ?<ResearchByCompany reports={shown} newNoteId={newNote}
           onNoteChange={noteChange} onNoteDelete={noteDelete} onAddNote={addCompanyNote}/>
        :<>
      <div className="rp-sec-hd">Research Plan</div>
      {planned.length===0&&<div className="rv-no-notes" style={{marginTop:8}}>
        {filtered&&allPlanned.length>0 ? "No planned companies match this filter."
          : 'Nothing queued. Type a company above and hit "+ Plan".'}
      </div>}
      {RPT_BUCKETS.map(b=>{
        const list=byBucket(b.key);
        if(!list.length) return null;
        return (
          <div key={b.key}>
            <div className={`rp-bucket${b.key==="overdue"?" over":""}`}>{b.label}</div>
            {list.map(r=>(
              <div key={r.id} className="rp-card">
                <div className="ck" onClick={()=>upd(r.id,{status:"read",readOn:todayKey()})} title="Log as researched today"/>
                <div className="rp-card-main">
                  <input className="rp-co-inp" value={r.company} placeholder="Company…"
                    onChange={e=>upd(r.id,{company:e.target.value})}/>
                  <div className="rp-meta">
                    <span className="rp-depth">
                      {REPORT_DEPTHS.map(([k,l])=>(
                        <button key={k} className={`${depthOf(r)===k?"on":""}${k==="deep"?" deep":""}`}
                          title={k==="new"?"A first look at this company":"A thorough dig into this company"}
                          onClick={()=>upd(r.id,{depth:k})}>{l}</button>
                      ))}
                    </span>
                    <ReportStart r={r} onSet={patch=>upd(r.id,patch)}/>
                    <button className={`rp-chip${r.due===todayKey()?" on":""}`} onClick={()=>upd(r.id,{due:todayKey()})}>Today</button>
                    <button className={`rp-chip${r.due===endOfWeekYmd()?" on":""}`} onClick={()=>upd(r.id,{due:endOfWeekYmd()})}>This wk</button>
                    <button className={`rp-chip${r.due===endOfMonthYmd()?" on":""}`} onClick={()=>upd(r.id,{due:endOfMonthYmd()})}>This mo</button>
                    <input className="rp-date" type="date" value={r.due||""} title="Target date"
                      onChange={e=>upd(r.id,{due:e.target.value})}/>
                    <button className={`rp-chip${openN[r.id]?" on":""}`} title="Notes"
                      onClick={()=>setOpenN(o=>({...o,[r.id]:!o[r.id]}))}>
                      ✎{(r.notes||[]).length?` ${r.notes.length}`:""}
                    </button>
                  </div>
                  <ReportSpan r={r}/>
                  <ReportNotes r={r} open={!!openN[r.id]} onSet={patch=>upd(r.id,patch)}/>
                </div>
                <button className="goal-btn del" onClick={()=>del(r.id)}>×</button>
              </div>
            ))}
          </div>
        );
      })}

      <div className="rp-sec-hd" style={{marginTop:30}}>Research Log</div>
      {readLog.length===0&&<div className="rv-no-notes" style={{marginTop:8}}>
        {filtered&&allRead.length>0 ? "No logged companies match this filter."
          : 'Nothing logged yet. Type a company above and hit "✓ Did today".'}
      </div>}
      {readDates.map(d=>(
        <div key={d||"undated"}>
          <div className="rp-bucket">{d?fmtDate(d,{weekday:"short",month:"long",day:"numeric",year:"numeric"}):"Undated"}</div>
          {readLog.filter(r=>(r.readOn||"")===d).map(r=>(
            <div key={r.id} className="rp-card read">
              <div className="ck done" onClick={()=>upd(r.id,{status:"planned",readOn:""})} title="Move back to the plan">✓</div>
              <div className="rp-card-main">
                <input className="rp-co-inp" value={r.company} placeholder="Company…"
                  onChange={e=>upd(r.id,{company:e.target.value})}/>
                <div className="rp-meta">
                  <span className="rp-depth">
                    {REPORT_DEPTHS.map(([k,l])=>(
                      <button key={k} className={`${depthOf(r)===k?"on":""}${k==="deep"?" deep":""}`}
                        title={k==="new"?"A first look at this company":"A thorough dig into this company"}
                        onClick={()=>upd(r.id,{depth:k})}>{l}</button>
                    ))}
                  </span>
                  <ReportStart r={r} onSet={patch=>upd(r.id,patch)}/>
                  <input className="rp-date" type="date" value={r.readOn||""} title="Finished on"
                    onChange={e=>upd(r.id,{readOn:e.target.value})}/>
                  <button className={`rp-chip${openN[r.id]?" on":""}`} title="Notes"
                    onClick={()=>setOpenN(o=>({...o,[r.id]:!o[r.id]}))}>
                    ✎{(r.notes||[]).length?` ${r.notes.length}`:""}
                  </button>
                </div>
                <ReportSpan r={r}/>
                <ReportNotes r={r} open={!!openN[r.id]} onSet={patch=>upd(r.id,patch)}/>
              </div>
              <button className="goal-btn del" onClick={()=>del(r.id)}>×</button>
            </div>
          ))}
        </div>
      ))}
        </>}
    </div>
  );
});

// ─── ReadingView (all book notes across all days, grouped by book) ────────────
const BookNoteCard = memo(({ note, first, autoFocus, onSave, onDelete, onOpenDay }) => {
  const [text, setText] = useState(note.text);
  const timer = useRef(null);
  const grow  = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};

  // keep in sync if the underlying note changes (e.g. after a Drive pull)
  useEffect(()=>setText(note.text),[note.id,note.text]);
  useEffect(()=>()=>clearTimeout(timer.current),[]);

  const handleChange = val => {
    setText(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(()=>onSave(val),700);
  };

  return (
    <div className={`rv-note${first?" first":""}`}>
      <div className="rv-note-hd">
        <span className="rv-note-date" onClick={onOpenDay} title="Open this day">
          {fmtDate(note.date,{month:"short",day:"numeric",year:"numeric"})}{note.ts?` · ${fmtTime(note.ts)}`:""}
        </span>
        <button className="book-del" onClick={onDelete}>×</button>
      </div>
      <textarea className="bnote-ta" value={text} placeholder="Reading note…" autoFocus={autoFocus}
        onChange={e=>{handleChange(e.target.value);grow(e.target);}}
        onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
    </div>
  );
});

const ReadingView = memo(({ refreshKey, today, onSelectDay, onEntriesChanged }) => {
  const [tick, setTick]           = useState(0);
  // A just-added note is still empty, so it would be filtered out — keep it visible.
  const [newNoteId, setNewNoteId] = useState(null);

  const books = useMemo(()=>{
    const map = new Map();
    allEntries().forEach(e=>{
      (e.books||[]).forEach(b=>{
        const key = normTitle(b.title);
        if(!key) return;
        if(!map.has(key)) map.set(key,{key,title:b.title.trim(),author:"",mins:0,sessions:0,days:new Set(),notes:[],lastDate:e.date});
        const rec = map.get(key);
        if(!rec.author && b.author?.trim()) rec.author = b.author.trim();
        rec.mins     += bookMins(b);
        rec.sessions += (b.sessions||[]).filter(s=>s.startTime).length;
        rec.days.add(e.date);
        if(e.date > rec.lastDate) rec.lastDate = e.date;
        bookNotes(b).filter(n=>n.text?.trim()||n.id===newNoteId)
          .forEach(n=>rec.notes.push({...n, date:e.date, bookId:b.id}));
      });
    });
    return [...map.values()]
      .map(r=>({...r, days:r.days.size,
        notes:r.notes.sort((a,b)=>b.date.localeCompare(a.date)||(b.ts||0)-(a.ts||0))}))
      .sort((a,b)=>b.lastDate.localeCompare(a.lastDate));
  },[refreshKey, tick, newNoteId]);

  // Notes live inside the daily entries — these write straight through to the
  // day they belong to, so both views stay in sync either way you enter them.
  const saveNote = useCallback((date,bookId,noteId,text)=>{
    const e = load(date);
    save(date,{...e, books:(e.books||[]).map(b=>b.id!==bookId?b:{...b,notes:bookNotes(b).map(n=>n.id===noteId?{...n,text}:n)})});
    onEntriesChanged?.();
  },[onEntriesChanged]);

  const deleteNote = useCallback((date,bookId,noteId)=>{
    const e = load(date);
    save(date,{...e, books:(e.books||[]).map(b=>b.id!==bookId?b:{...b,notes:bookNotes(b).filter(n=>n.id!==noteId)})});
    setTick(t=>t+1);
    onEntriesChanged?.();
  },[onEntriesChanged]);

  // A note added here is stamped now, so it lands in today's entry. If the book
  // wasn't opened today it's added to today with no reading session — just the note.
  const addNote = useCallback((title,author)=>{
    const e    = load(today);
    const key  = normTitle(title);
    const note = blankBookNote();
    const list = e.books||[];
    const idx  = list.findIndex(b=>normTitle(b.title)===key);
    const books = idx>=0
      ? list.map((b,i)=>i!==idx?b:{...b, notes:[...bookNotes(b), note]})
      : [...list, {id:uid(), title, author:author||"", sessions:[], notes:[note]}];
    save(today,{...e, books});
    setNewNoteId(note.id);
    setTick(t=>t+1);
    onEntriesChanged?.();
  },[today, onEntriesChanged]);

  const totalMins  = books.reduce((a,b)=>a+b.mins,0);
  const totalNotes = books.reduce((a,b)=>a+b.notes.length,0);

  return (
    <div className="reading-view">
      <div className="eyebrow">All Entries</div>
      <h1 className="pg-title">Reading <em>Notes</em></h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:6}}>
        Every note you've taken, grouped by book — editable here or in the daily entry.
      </p>
      {books.length>0&&(
        <p style={{fontSize:12,color:"#4a9a9a",marginBottom:20}}>
          {books.length} book{books.length!==1?"s":""} · {totalNotes} note{totalNotes!==1?"s":""}
          {totalMins>0?` · ${fmtMins(totalMins)} read`:""}
        </p>
      )}

      {books.length===0&&(
        <div className="empty" style={{marginTop:24}}>
          No books yet. Add one in the Reading section of today's entry.
        </div>
      )}

      {books.map(b=>(
        <div key={b.key} className="rv-book">
          <div className="rv-book-hd">
            <div className="rv-book-title">📖 {b.title}</div>
            {b.author&&<div className="rv-book-author">{b.author}</div>}
            <div className="rv-book-stats">
              {b.mins>0&&<span><strong>{fmtMins(b.mins)}</strong> read</span>}
              {b.sessions>0&&<span><strong>{b.sessions}</strong> session{b.sessions!==1?"s":""}</span>}
              <span><strong>{b.days}</strong> day{b.days!==1?"s":""}</span>
              <span><strong>{b.notes.length}</strong> note{b.notes.length!==1?"s":""}</span>
            </div>
          </div>
          {b.notes.length===0
            ?<div className="rv-no-notes">No notes for this book yet.</div>
            :b.notes.map((n,i)=>(
              <BookNoteCard key={`${n.date}-${n.id}`} note={n} first={i===0}
                autoFocus={n.id===newNoteId}
                onSave={text=>saveNote(n.date,n.bookId,n.id,text)}
                onDelete={()=>deleteNote(n.date,n.bookId,n.id)}
                onOpenDay={()=>onSelectDay(n.date)}/>
            ))}
          <button className="bnote-add" style={{marginTop:13}} onClick={()=>addNote(b.title,b.author)}>
            + Add a note · {fmtTime(nowTs())}
          </button>
        </div>
      ))}
    </div>
  );
});

// ─── FocusView (all todos across all days) ────────────────────────────────────
const FocusView = memo(({ today, refreshKey, onSelectDay }) => {
  const [localTick, setLocalTick] = useState(0);

  const groups = useMemo(()=>
    allEntries()
      .map(e=>({ date:e.date, todos:(e.todos||[]).filter(t=>getTxt(t)) }))
      .filter(e=>e.todos.length>0)
  ,[refreshKey, localTick]);

  const toggle = useCallback((date, idx)=>{
    const e=load(date);
    const todos=(e.todos||[]).map((t,i)=>i===idx?{text:getTxt(t),done:!getDone(t)}:t);
    save(date,{...e,todos});
    setLocalTick(t=>t+1);
  },[]);

  const total   = groups.reduce((a,g)=>a+g.todos.length,0);
  const done    = groups.reduce((a,g)=>a+g.todos.filter(t=>getDone(t)).length,0);

  return (
    <div className="focus-view">
      <div className="eyebrow">All Entries</div>
      <h1 className="pg-title">Focus <em>List</em></h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:6}}>
        Every focus item across all days — check off here or in the daily entry.
      </p>
      {total>0&&<p style={{fontSize:12,color:"#C8A96E",marginBottom:4}}>{done} / {total} done</p>}

      {groups.length===0&&<div className="empty" style={{marginTop:24}}>No focus items yet. Add them in today's entry.</div>}

      {groups.map(({date,todos})=>{
        const doneCnt=todos.filter(t=>getDone(t)).length;
        const isToday=date===today;
        return (
          <div key={date}>
            <div className="focus-date-hd">
              <span className={`focus-date-lbl${isToday?" today-lbl":""}`}
                style={{cursor:"pointer"}} onClick={()=>onSelectDay(date)} title="Open this day">
                {isToday?"Today":fmtDate(date,{weekday:"short",month:"short",day:"numeric",year:"numeric"})}
              </span>
              <span className="focus-date-stat">{doneCnt}/{todos.length} done</span>
            </div>
            {todos.map((t,i)=>(
              <div key={i} className={`focus-todo${getDone(t)?" done-row":""}`} onClick={()=>toggle(date,i)}>
                <div className={`ck${getDone(t)?" done":""}`}>{getDone(t)&&"✓"}</div>
                <span className={`focus-todo-txt${getDone(t)?" struck":""}`}>{getTxt(t)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});

// ─── WriteView ────────────────────────────────────────────────────────────────
const WriteView = memo(({ entry, setEntry, selectedDate, today, isEdit, setEditMode, stats, habitsRefreshKey }) => {
  const isToday = selectedDate === today;
  const show    = isEdit || isToday;

  const [locLoading,     setLocLoading]     = useState(false);
  const [locSuggestions, setLocSuggestions] = useState([]);
  const locTimerRef = useRef(null);

  const setTodos         = useCallback(todos=>setEntry(e=>({...e,todos})),[setEntry]);
  const setBlocks        = useCallback(diaryBlocks=>setEntry(e=>({...e,diaryBlocks})),[setEntry]);
  const setGrat          = useCallback(gratitude=>setEntry(e=>({...e,gratitude})),[setEntry]);
  const setLoc           = useCallback(location=>setEntry(e=>({...e,location})),[setEntry]);
  const setReflect       = useCallback(v=>setEntry(e=>({...e,weeklyReflection:v})),[setEntry]);
  const setBooks         = useCallback(books=>setEntry(e=>({...e,books})),[setEntry]);
  const setMyQuotes      = useCallback(myQuotes=>setEntry(e=>({...e,myQuotes})),[setEntry]);
  const setNotes         = useCallback(notes=>setEntry(e=>({...e,notes})),[setEntry]);
  const setHabitChecks   = useCallback(habitChecks=>setEntry(e=>({...e,habitChecks})),[setEntry]);

  const handleLocChange = useCallback(val=>{
    setLoc(val);
    setLocSuggestions([]);
    if(val.length<3) return;
    clearTimeout(locTimerRef.current);
    locTimerRef.current=setTimeout(async()=>{
      try{
        const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`);
        const data=await res.json();
        const seen=new Set();
        const suggs=data.map(r=>{
          const addr=r.address||{};
          const city=addr.city||addr.town||addr.village||addr.county||"";
          const state=addr.state||addr.province||"";
          const country=addr.country||"";
          return [city,state||country].filter(Boolean).join(", ")||r.display_name.split(",")[0];
        }).filter(v=>{if(!v||seen.has(v))return false;seen.add(v);return true;});
        setLocSuggestions(suggs);
      }catch{}
    },400);
  },[setLoc]);

  const detectLoc = useCallback(()=>{
    if(!navigator.geolocation){return;}
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async pos=>{
        try{
          const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10&accept-language=en`);
          const d=await r.json();
          const city=d.address?.city||d.address?.town||d.address?.village||d.address?.county||"";
          const region=d.address?.state||d.address?.country||"";
          setLoc([city,region].filter(Boolean).join(", ")||"Location found");
        }catch{setLoc("Location found");}
        setLocLoading(false);
      },
      ()=>setLocLoading(false),
      {timeout:8000}
    );
  },[setLoc]);

  // ── past read-only view ────────────────────────────────────────────────────
  if (!show) {
    const todos   = entry.todos||[];
    const blocks  = entry.diaryBlocks||[];
    const grat    = entry.gratitude||[];
    const books   = entry.books||[];
    const quotes  = entry.myQuotes||[];
    const entNotes= entry.notes||[];
    return (
      <>
        <div className="pg-head">
          <div className="eyebrow">Past Entry</div>
          <h1 className="pg-title">{fmtDate(selectedDate,{weekday:"long",month:"long",day:"numeric"})}</h1>
          <div className="pg-subtitle">{fmtDate(selectedDate,{year:"numeric"})}</div>
        </div>
        <div className="past-wrap">
          <button className="edit-lnk" onClick={()=>setEditMode(true)}>Edit this entry ↗</button>

          {entry.location&&<div className="past-sec"><div className="past-loc"><span className="past-loc-pin">📍</span>{entry.location}</div></div>}

          <div className="past-sec">
            <div className="past-lbl">Focus</div>
            {todos.filter(t=>getTxt(t)).length
              ?todos.filter(t=>getTxt(t)).map((t,i)=><div key={i} className={`past-todo${getDone(t)?" di":""}`}><div className="past-dot" style={{opacity:getDone(t)?.4:1}}/>{getTxt(t)}</div>)
              :<div className="empty">Nothing noted.</div>}
          </div>

          <div className="past-sec">
            <div className="past-lbl">Journal</div>
            {blocks.filter(b=>b.text?.trim()).length
              ?blocks.filter(b=>b.text?.trim()).map(b=><div key={b.id} className="past-diary-block">{b.ts&&<div className="past-ts">{fmtTime(b.ts)}</div>}<div className="past-diary-txt">{b.text}</div></div>)
              :<div className="empty">No journal entry.</div>}
          </div>

          {entNotes.filter(n=>n.text?.trim()).length>0&&<div className="past-sec">
            <div className="past-lbl">Notes</div>
            {entNotes.filter(n=>n.text?.trim()).map(n=>(
              <div key={n.id} className="past-note-block">
                {n.source&&<div className="past-note-src">{n.source}</div>}
                <div className="past-note-txt">{n.text}</div>
              </div>
            ))}
          </div>}

          {books.filter(b=>b.title).length>0&&<div className="past-sec">
            <div className="past-lbl">Reading</div>
            {books.filter(b=>b.title).map(b=>{
              const m=bookMins(b);
              const sess=(b.sessions||[]).filter(s=>s.startTime);
              return (
                <div key={b.id} className="past-book">
                  <div className="past-book-title">📖 {b.title}{b.author?` — ${b.author}`:""}</div>
                  {sess.map(s=>{const sm=calcMins(s.startTime,s.endTime);return(
                    <div key={s.id} className="past-book-meta">
                      <span>{s.startTime}{s.endTime?` → ${s.endTime}`:" → in progress"}</span>
                      {sm>0&&<span style={{marginLeft:8,color:"#4a9a9a",fontWeight:500}}>{fmtMins(sm)}</span>}
                    </div>
                  );})}
                  {m>0&&sess.length>1&&<div className="past-book-meta" style={{color:"#4a9a9a",fontWeight:500}}>Total: {fmtMins(m)}</div>}
                  {bookNotes(b).filter(n=>n.text?.trim()).map(n=>(
                    <div key={n.id} className="past-book-note">
                      <div className="past-book-note-ts">{n.ts?fmtTime(n.ts):"earlier"}</div>
                      <div className="past-book-note-txt">{n.text}</div>
                    </div>
                  ))}
                </div>
              );
            })}
            {(()=>{const t=books.filter(b=>b.title).reduce((a,b)=>a+bookMins(b),0);return t>0&&books.filter(b=>b.title).length>1&&<div style={{fontSize:12,color:"#4a9a9a",fontWeight:500,marginTop:6}}>Total reading: {fmtMins(t)}</div>;})()}
          </div>}

          {quotes.filter(q=>q.text?.trim()).length>0&&<div className="past-sec">
            <div className="past-lbl">Quotes Collected</div>
            {quotes.filter(q=>q.text?.trim()).map(q=>(
              <div key={q.id} className="past-my-quote">
                <div className="pmq-text">"{q.text}"</div>
                {q.source&&<div className="pmq-src">— {q.source}</div>}
              </div>
            ))}
          </div>}

          <div className="past-sec">
            <div className="past-lbl">Grateful For</div>
            {grat.filter(g=>g?.trim()).length
              ?grat.filter(g=>g?.trim()).map((g,i)=><div key={i} className="past-grat"><span className="pgn">{i+1}</span>{g}</div>)
              :<div className="empty">Nothing noted.</div>}
          </div>

          {entry.weeklyReflection?.trim()&&<div className="past-sec">
            <div className="past-lbl">Weekly Reflection</div>
            <div className="past-diary-txt" style={{fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontStyle:"italic",fontSize:14}}>{entry.weeklyReflection}</div>
          </div>}
        </div>
      </>
    );
  }

  // ── editable view ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="pg-head">
        <div className="eyebrow">{isToday?"Today's Entry":fmtDate(selectedDate,{weekday:"long"})}</div>
        <h1 className="pg-title">
          {isToday?<>What's on your <em>mind?</em></>:fmtDate(selectedDate,{month:"long",day:"numeric"})}
        </h1>
        <div className="pg-subtitle">{fmtDate(selectedDate,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
      </div>

      {isToday&&<InspirationBar/>}

      <div className="loc-bar" style={{margin:"10px 52px 0"}}>
        <span style={{color:"#C8A96E",flexShrink:0}}>📍</span>
        <input className="loc-inp" value={entry.location??""} placeholder={DEFAULT_LOCATION}
          onChange={e=>handleLocChange(e.target.value)}
          onBlur={()=>setTimeout(()=>setLocSuggestions([]),200)}/>
        <button className="loc-gps-btn" onClick={detectLoc} disabled={locLoading} title="Detect my location automatically">
          {locLoading?"…":"⌖ GPS"}
        </button>
        <span className="loc-hint">location</span>
        {locSuggestions.length>0&&(
          <div className="loc-dropdown">
            {locSuggestions.map((s,i)=>(
              <div key={i} className="loc-sugg" onMouseDown={()=>{setLoc(s);setLocSuggestions([]);}}>
                <span style={{color:"#C8A96E",fontSize:11}}>📍</span>{s}
              </div>
            ))}
          </div>
        )}
      </div>

      {isToday&&<div className="stats-row">
        <div className="stat"><strong>{stats.totalDays}</strong><span>days logged</span></div>
        <div className="stat"><strong>{stats.diaryDays}</strong><span>entries</span></div>
        <div className="stat"><strong>{stats.streak}</strong><span>day streak</span></div>
        <div className="stat"><strong>{stats.doneTodayCount}</strong><span>done today</span></div>
      </div>}

      <div className="content">
        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-todo">✓</div><div className="sec-ttl">Today's Focus</div><div className="sec-hint">keep it short</div></div>
          <TodoList todos={entry.todos} onChange={setTodos}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-habit">◐</div><div className="sec-ttl">Habits</div><div className="sec-hint">daily routine</div></div>
          <DailyHabits checks={entry.habitChecks||{}} onChange={setHabitChecks} refreshKey={habitsRefreshKey}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-diary">✦</div><div className="sec-ttl">Today's Journal</div><div className="sec-hint">timestamped</div></div>
          <JournalBlocks blocks={entry.diaryBlocks} onChange={setBlocks}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-notes">✎</div><div className="sec-ttl">Notes</div><div className="sec-hint">takeaways · sources · ideas</div></div>
          <NotesSection notes={entry.notes||[]} onChange={setNotes}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-read">📖</div><div className="sec-ttl">Reading</div><div className="sec-hint">all books today</div></div>
          <ReadingTracker books={entry.books||[]} onChange={setBooks}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-quote">"</div><div className="sec-ttl">Quotes</div><div className="sec-hint">capture what resonates</div></div>
          <MyQuotes quotes={entry.myQuotes||[]} onChange={setMyQuotes}/>
        </div>

        <div className="section">
          <div className="sec-hd"><div className="sec-ic ic-grat">♡</div><div className="sec-ttl">Grateful For</div><div className="sec-hint">1–2 things</div></div>
          <GratList items={entry.gratitude} onChange={setGrat}/>
        </div>

        {isSun(selectedDate)&&<div className="section">
          <div className="sec-hd"><div className="sec-ic ic-ref">↻</div><div className="sec-ttl">Weekly Reflection</div></div>
          <div className="ref-badge">Sunday check-in</div>
          <textarea className="ref-ta" value={entry.weeklyReflection||""} placeholder="How was this week? What did you learn? What do you want to do differently?" onChange={e=>setReflect(e.target.value)}/>
        </div>}
      </div>
    </>
  );
});

// ─── MonthView ────────────────────────────────────────────────────────────────
const MonthView = memo(({ calMonth, setCalMonth, entrySet, selectedDate, today, streak, totalDays, onSelect }) => {
  const {y,m} = calMonth;
  const mn    = new Date(y,m,1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const dows  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const first = new Date(y,m,1).getDay();
  const days  = new Date(y,m+1,0).getDate();
  const cells = [...Array(first).fill(null),...Array.from({length:days},(_,i)=>i+1)];
  return (
    <div className="month-view">
      <div className="eyebrow">Your Story</div>
      <div className="month-nav">
        <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m-1,1);return{y:d.getFullYear(),m:d.getMonth()};})}>← Prev</button>
        <div className="month-nm">{mn}</div>
        <button onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m+1,1);return{y:d.getFullYear(),m:d.getMonth()};})}>Next →</button>
      </div>
      <div className="cal-grid">
        {dows.map(d=><div key={d} className="cal-dow">{d}</div>)}
        {cells.map((d,i)=>{
          if(!d) return <div key={`e${i}`} className="cal-day empty"/>;
          const k=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const has=entrySet.has(k);
          let hasDiary=false,hasGrat=false,hasRead=false,hasQuote=false;
          if(has){try{const e=JSON.parse(localStorage.getItem(KEY+k)||"{}");hasDiary=!!(e.diaryBlocks?.some(b=>b.text?.trim())||e.diary?.trim());hasGrat=e.gratitude?.some(g=>g?.trim());hasRead=(e.books||[]).some(b=>b.title);hasQuote=(e.myQuotes||[]).some(q=>q.text?.trim());}catch{}}
          return (
            <div key={k} className={`cal-day${has?" has":""}${k===today?" today":""}${k===selectedDate?" sel":""}`} onClick={()=>{if(has)onSelect(k);}}>
              {d}
              {has&&<div className="cal-dots">
                {hasDiary&&<div className="cal-dot dot-d"/>}
                {hasGrat&&<div className="cal-dot dot-g"/>}
                {hasRead&&<div className="cal-dot dot-r"/>}
                {hasQuote&&<div className="cal-dot dot-q"/>}
              </div>}
            </div>
          );
        })}
      </div>
      <div style={{marginTop:14,fontSize:11,color:"#bbb",display:"flex",gap:16,flexWrap:"wrap"}}>
        <span><span style={{color:"#C8A96E"}}>●</span> journal</span>
        <span><span style={{color:"#c0b0d0"}}>●</span> gratitude</span>
        <span><span style={{color:"#8ababa"}}>●</span> reading</span>
        <span><span style={{color:"#e8c878"}}>●</span> quotes</span>
      </div>
      <div className="streak-note">Current streak: <strong>{streak} {streak===1?"day":"days"}</strong> · Total: <strong>{totalDays} {totalDays===1?"entry":"entries"}</strong></div>
    </div>
  );
});

// ─── SearchView ───────────────────────────────────────────────────────────────
const SearchView = memo(({ entries, onSelect }) => {
  const [q,setQ] = useState("");
  const results  = q.trim()
    ? entries.filter(e=>{
        const blob=[...(e.diaryBlocks||[]).map(b=>b.text||""),e.diary||"",...(e.todos||[]).map(getTxt),...(e.gratitude||[]),e.location||"",...(e.books||[]).map(b=>`${b.title} ${b.author} ${bookNotes(b).map(n=>n.text||"").join(" ")}`),...(e.myQuotes||[]).map(q=>`${q.text} ${q.source}`),...(e.notes||[]).map(n=>`${n.source||""} ${n.text||""}`)].join(" ").toLowerCase();
        return blob.includes(q.toLowerCase());
      }).slice(0,20)
    : [];
  const hi=(text,q)=>{
    if(!q||!text) return text?.slice(0,100)||"";
    const idx=text.toLowerCase().indexOf(q.toLowerCase());
    if(idx<0) return text.slice(0,100);
    const start=Math.max(0,idx-40);
    const snip=(start>0?"…":"")+text.slice(start,idx+q.length+60)+(text.length>idx+q.length+60?"…":"");
    return snip.split(new RegExp(`(${q})`,"gi")).map((p,i)=>p.toLowerCase()===q.toLowerCase()?<mark key={i}>{p}</mark>:p);
  };
  const blob=(e)=>[...(e.diaryBlocks||[]).map(b=>b.text||""),e.diary||"",...(e.todos||[]).map(getTxt),...(e.gratitude||[]),...(e.myQuotes||[]).map(q=>q.text||""),...(e.notes||[]).map(n=>n.text||""),...(e.books||[]).flatMap(b=>[b.title||"",...bookNotes(b).map(n=>n.text||"")])].join(" ");
  return (
    <div className="search-view">
      <div className="eyebrow">Search</div>
      <h1 className="pg-title">Find a <em>moment</em></h1>
      <div style={{height:20}}/>
      <div className="sb-wrap">
        <input className="sb-inp" value={q} placeholder="Search journal, investing notes, books, quotes, locations…" onChange={e=>setQ(e.target.value)} autoFocus/>
        <span className="sb-ico">⌕</span>
      </div>
      {q&&!results.length&&<div className="no-res">Nothing found for "{q}"</div>}
      {results.map(e=>(
        <div key={e.date} className="sr" onClick={()=>onSelect(e.date)}>
          <div className="sr-date">{fmtDate(e.date,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}{e.location?` · ${e.location}`:""}</div>
          <div className="sr-snip">{hi(blob(e),q)}</div>
        </div>
      ))}
    </div>
  );
});

// ─── ExportView ───────────────────────────────────────────────────────────────
const ExportView = memo(({ entries, onImport, driveStatus, driveLoading, driveConnected, onSyncDrive, onRestoreDrive, onPullDrive, onDisconnect }) => {
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef();
  const configured = GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID_HERE";

  const dl = (content,name,type) => {
    const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([content],{type})),download:name});
    a.click();
  };

  const dlJson = () => dl(JSON.stringify(entries,null,2),"my-journal.json","application/json");

  const dlMd = () => {
    const lines = entries.map(e=>{
      const todos  =(e.todos||[]).filter(t=>getTxt(t)).map(t=>`- [${getDone(t)?"x":" "}] ${getTxt(t)}`).join("\n");
      const story  =(e.diaryBlocks||[]).filter(b=>b.text?.trim()).map(b=>`${b.ts?`*${fmtTime(b.ts)}*\n\n`:""}${b.text}`).join("\n\n---\n\n");
      const entNotes=(e.notes||[]).filter(n=>n.text?.trim()).map(n=>`${n.source?`**${n.source}**\n\n`:""}${n.text}`).join("\n\n---\n\n");
      const books  =(e.books||[]).filter(b=>b.title).map(b=>{const m=bookMins(b);const sess=(b.sessions||[]).filter(s=>s.startTime).map(s=>`${s.startTime}${s.endTime?`→${s.endTime}`:" (in progress)"}`).join(", ");return `📖 **${b.title}**${b.author?` — ${b.author}`:""}${sess?` · ${sess}`:""}${m>0?` (${fmtMins(m)})`:""}${bookNotes(b).filter(n=>n.text?.trim()).map(n=>`\n\n> ${n.ts?`*${fmtTime(n.ts)}* — `:""}${n.text.replace(/\n/g,"\n> ")}`).join("")}`}).join("\n\n");
      const quotes =(e.myQuotes||[]).filter(q=>q.text?.trim()).map(q=>`> "${q.text}"${q.source?`\n> — ${q.source}`:""}`).join("\n\n");
      const grat   =(e.gratitude||[]).filter(g=>g?.trim()).map((g,i)=>`${i+1}. ${g}`).join("\n");
      const loc    = e.location?`📍 ${e.location}\n\n`:"";
      return `# ${fmtDate(e.date)}\n\n${loc}## Focus\n${todos||"—"}\n\n## Journal\n${story||"—"}\n\n## Notes\n${entNotes||"—"}\n\n## Reading\n${books||"—"}\n\n## Quotes\n${quotes||"—"}\n\n## Grateful For\n${grat||"—"}\n\n---`;
    }).join("\n\n");
    dl(lines,"my-journal.md","text/markdown");
  };

  const dlSub = () => {
    const lines = entries.filter(e=>(e.diaryBlocks||[]).some(b=>b.text?.trim())||e.diary?.trim()).map(e=>{
      const loc  = e.location?`*${e.location}*\n\n`:"";
      const story= (e.diaryBlocks||[]).filter(b=>b.text?.trim()).map(b=>b.text).join("\n\n")||e.diary||"";
      const quotes=(e.myQuotes||[]).filter(q=>q.text?.trim()).map(q=>`\n\n> "${q.text}"${q.source?`\n> — ${q.source}`:""}`).join("");
      return `**${fmtDate(e.date)}**\n\n${loc}${story}${quotes}`;
    }).join("\n\n---\n\n");
    dl(lines,"journal-for-substack.txt","text/plain");
  };

  const handleImport = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error("Invalid format");
        let count = 0;
        data.forEach(entry => {
          if (entry.date) {
            localStorage.setItem(KEY + entry.date, JSON.stringify(migrate({...entry})));
            count++;
          }
        });
        onImport();
        setImportMsg(`✓ Restored ${count} entries successfully.`);
      } catch {
        setImportMsg("✗ Could not read that file. Make sure it's a journal JSON backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="export-view">
      <div className="eyebrow">Backup & Sync</div>
      <h1 className="pg-title">Keep your <em>words</em> safe</h1>
      <div style={{height:20}}/>

      {/* ── Drive sync card ── */}
      {configured&&(driveConnected?(
        <div className="ex-card" style={{background:"#f0f8f0",border:"1.5px solid #b0d8b0"}}>
          <h3 style={{color:"#2a6a2a"}}>✓ Auto-sync is on</h3>
          <p style={{color:"#3a5a3a"}}>
            Your journal saves to Google Drive on every write and auto-pulls when you switch to the Write tab.<br/>
            Use <strong>↓ Pull latest</strong> any time to grab updates from another device.
          </p>
          <div className="drive-btns">
            <button className="ex-btn goog" onClick={onPullDrive} disabled={driveLoading} style={{fontWeight:700}}>↓ Pull latest</button>
            <button className="ex-btn goog" onClick={onSyncDrive} disabled={driveLoading}>☁↑ Push now</button>
            <button className="ex-btn goog-o" onClick={onRestoreDrive} disabled={driveLoading}>↓ Full restore</button>
            <button className="ex-btn sec" onClick={onDisconnect} style={{fontSize:11}}>Disconnect</button>
          </div>
          {driveStatus&&<div className="drive-status">{driveStatus}</div>}
        </div>
      ):(
        <div className="drive-card">
          <h3>☁️ Connect Google Drive — automatic sync</h3>
          <p>
            Connect once and your journal saves to Drive automatically on every write. Open the app on your phone or laptop and your entries are always there — no manual steps.<br/><br/>
            <strong>One click below</strong> → pick your Google account → done forever.
          </p>
          <button className="ex-btn goog" onClick={onSyncDrive} disabled={driveLoading} style={{marginBottom:8}}>
            {driveLoading?"Connecting…":"☁ Connect Google Drive"}
          </button>
          {driveStatus&&<div className="drive-status" style={{marginTop:8}}>{driveStatus}</div>}
        </div>
      ))}

      {/* ── Restore from file ── */}
      <div className="ex-card" style={{border:"1.5px solid #C8A96E40"}}>
        <h3>📂 Restore from file</h3>
        <p>Have a JSON backup? Load it here and all your entries come back instantly.</p>
        <input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={handleImport}/>
        <button className="ex-btn pri" onClick={()=>fileRef.current.click()}>↑ Load backup file</button>
        {importMsg&&<div style={{marginTop:10,fontSize:12,color:importMsg.startsWith("✓")?"#4a9a4a":"#c05050",padding:"8px 12px",background:"white",borderRadius:6,border:"1px solid #e0e0e0"}}>{importMsg}</div>}
      </div>

      {/* ── Download options ── */}
      <div className="ex-card">
        <h3>💾 Download JSON backup</h3>
        <p>Download your full journal as a file you can load on another device.</p>
        <button className="ex-btn pri" onClick={dlJson}>Download .json</button>
      </div>
      <div className="ex-card"><h3>Markdown</h3><p>All entries — journal, books, quotes, gratitude — as a .md file. Great for Obsidian or Notion.</p><button className="ex-btn sec" onClick={dlMd}>Download .md</button></div>
      <div className="ex-card"><h3>Substack / Blog</h3><p>Journal entries + quotes, formatted for Substack.</p><button className="ex-btn sec" onClick={dlSub}>Download for Substack</button></div>
    </div>
  );
});

// ─── App ──────────────────────────────────────────────────────────────────────
const NAVS = [
  {key:"write",  icon:"✦",  label:"Write"},
  {key:"focus",  icon:"◎",  label:"Focus"},
  {key:"goals",  icon:"◈",  label:"Goals"},
  {key:"ideas",  icon:"✧",  label:"Ideas"},
  {key:"reading",icon:"❧",  label:"Books"},
  {key:"reports",icon:"▤",  label:"Research"},
  {key:"month",  icon:"◫",  label:"Month"},
  {key:"search", icon:"⌕",  label:"Search"},
  {key:"habits", icon:"◐",  label:"Habits"},
  {key:"export", icon:"↗",  label:"Export"},
];

export default function App() {
  const today = todayKey();
  const [sidebarOpen,   setSidebarOpen] = useState(false);
  const [tab,           setTab]         = useState("write");
  const [selDate,       setSelDate]     = useState(today);
  const [editMode,      setEditMode]    = useState(true);
  const [entry,         setEntry]       = useState(()=>load(today));
  const [entries,       setEntries]     = useState(()=>allEntries());
  const [savedShow,     setSavedShow]   = useState(false);
  const [calMonth,      setCalMonth]    = useState(()=>{const d=new Date();return{y:d.getFullYear(),m:d.getMonth()};});
  const [focusTick,     setFocusTick]   = useState(0);
  const [habitsTick,    setHabitsTick]  = useState(0);
  const [ideasTick,     setIdeasTick]   = useState(0);
  const [readingTick,   setReadingTick] = useState(0);
  const [goalsTick,     setGoalsTick]   = useState(0);
  const [reportsTick,   setReportsTick] = useState(0);
  const [driveStatus,   setDS]          = useState("");
  const [driveLoading,  setDL]          = useState(false);
  const [lastSync,      setLastSync]    = useState("");
  // driveConnected: user has authorized Drive at least once (persisted in localStorage)
  const [driveConnected,setDriveConn]  = useState(()=>!!localStorage.getItem(DRIVE_CONNECTED_KEY));
  const [driveNeedsReauth, setNeedsReauth] = useState(false);
  const saveTimer  = useRef(null);
  const autoSTimer = useRef(null);
  const entryRef   = useRef(entry);   // latest entry, for flushing on tab switch
  entryRef.current = entry;
  const mainRef    = useRef(null);
  const configured = GOOGLE_CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID_HERE";

  // On mount: if Drive was previously connected, try silent restore then enable auto-save
  useEffect(()=>{
    if(!configured||!driveConnected) return;
    (async()=>{
      const token=await getTokenSilent();
      if(!token){ setNeedsReauth(true); return; }
      try{
        const driveData=await loadFromDrive(token);
        if(!driveData) return;
        const data=Array.isArray(driveData.entries)?driveData.entries:[];
        const count=applyDriveEntries(data);
        const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
        if(driveHabits.length){
          const local=loadHabits();
          const localIds=new Set(local.map(h=>h.id));
          const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
          if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
        }
        const driveIdeas=Array.isArray(driveData.ideas)?driveData.ideas:[];
        if(driveIdeas.length){
          const local=loadIdeas();
          const localIds=new Set(local.map(i=>i.id));
          const extraI=driveIdeas.filter(i=>i.id&&!localIds.has(i.id));
          if(extraI.length){saveIdeas([...local,...extraI]);setIdeasTick(t=>t+1);}
        }
        const driveGoals=Array.isArray(driveData.goals)?driveData.goals:[];
        if(driveGoals.length){
          const local=loadGoals();
          const mergedG=mergeByNewer(local,driveGoals);
          if(stableStr(mergedG)!==stableStr(local)){saveGoals(mergedG);setGoalsTick(t=>t+1);}
        }
        const driveReports=Array.isArray(driveData.reports)?driveData.reports:[];
        if(driveReports.length){
          const local=loadReports();
          const mergedR=mergeByNewer(local,driveReports);
          if(stableStr(mergedR)!==stableStr(local)){saveReports(mergedR);setReportsTick(t=>t+1);}
        }
        if(count>0){
          setEntries(allEntries());
          setEntry(load(selDate));
          const t=new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
          setLastSync(t);
          setDS(`✓ Auto-restored ${count} entries — ${t}`);
        }
      }catch{}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    setEntry(load(selDate));
    setEditMode(selDate===today);
    if(mainRef.current) mainRef.current.scrollTop=0;
  },[selDate]);

  // Save to localStorage on every change; if Drive connected + token cached, also auto-push
  useEffect(()=>{
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{
      save(selDate,entry);
      const updated=allEntries();
      setEntries(updated);
      setSavedShow(true);
      setTimeout(()=>setSavedShow(false),2000);
      // Auto-push to Drive (never prompts). The token is fetched inside the
      // timer and falls back to a silent grant: the in-memory cache is empty
      // after every reload, and without the fallback this push would silently
      // never run while the pull still did — local work would then be
      // overwritten by an older Drive copy it had never been sent to.
      if(configured&&driveConnected){
        {
          clearTimeout(autoSTimer.current);
          autoSTimer.current=setTimeout(async()=>{
            try{
              const token=getCachedToken()||await getTokenSilent();
              if(!token) return;
              const merged=await mergeAndSaveToDrive(updated,token);
              // Bring down whatever Drive won — a date this device lacks, or a
              // newer copy of one it has. Skips anything local already wins.
              if(applyDriveEntries(merged)) setEntries(allEntries());
              const t=new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
              setLastSync(t);
              setDS(`✓ Auto-saved — ${t}`);
            }catch{}
          },1500); // slight delay so rapid typing doesn't spam Drive
        }
      }
    },700);
    return()=>clearTimeout(saveTimer.current);
  },[entry,selDate,driveConnected,configured]);

  const selectDay = useCallback(date=>{setSelDate(date);setTab("write");setSidebarOpen(false);},[]);
  const onToday   = useCallback(()=>selectDay(today),[selectDay,today]);

  const lastPullRef = useRef(0);

  // Pull latest from Drive (silent=true skips loading indicator + has 5-min cooldown)
  const doPullFromDrive = useCallback(async(silent=false)=>{
    if(!configured||!driveConnected) return;
    if(silent && Date.now()-lastPullRef.current < 5*60*1000) return;
    const token = getCachedToken() || await getTokenSilent();
    if(!token){ setNeedsReauth(true); return; }
    if(!silent){ setDL(true); setDS("Pulling latest…"); }
    try{
      const driveData=await loadFromDrive(token);
      if(!driveData){ if(!silent) setDS("No backup found in Drive."); return; }
      const data=Array.isArray(driveData.entries)?driveData.entries:[];
      const count=applyDriveEntries(data);
      const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
      }
      const driveIdeas=Array.isArray(driveData.ideas)?driveData.ideas:[];
      if(driveIdeas.length){
        const local=loadIdeas();
        const localIds=new Set(local.map(i=>i.id));
        const extraI=driveIdeas.filter(i=>i.id&&!localIds.has(i.id));
        if(extraI.length){saveIdeas([...local,...extraI]);setIdeasTick(t=>t+1);}
      }
      const driveGoals=Array.isArray(driveData.goals)?driveData.goals:[];
      if(driveGoals.length){
        const local=loadGoals();
        const mergedG=mergeByNewer(local,driveGoals);
        if(stableStr(mergedG)!==stableStr(local)){saveGoals(mergedG);setGoalsTick(t=>t+1);}
      }
      const driveReports=Array.isArray(driveData.reports)?driveData.reports:[];
      if(driveReports.length){
        const local=loadReports();
        const mergedR=mergeByNewer(local,driveReports);
        if(stableStr(mergedR)!==stableStr(local)){saveReports(mergedR);setReportsTick(t=>t+1);}
      }
      lastPullRef.current=Date.now();
      setEntries(allEntries());
      setEntry(load(selDate));
      if(!silent){
        const t=new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
        setLastSync(t);
        setDS(`✓ Pulled latest — ${t}`);
      }
    }catch(e){ if(!silent) setDS("✗ Pull failed."); }
    finally{ if(!silent) setDL(false); }
  },[configured,driveConnected,selDate]);

  const switchTab = useCallback(newTab=>{
    // Flush the debounced save before leaving Write, so views that read straight
    // from localStorage (Books, Focus) never see a stale entry.
    if(tab==="write"&&newTab!=="write"){ clearTimeout(saveTimer.current); save(selDate,entryRef.current); }
    if(newTab==="write"&&tab!=="write"){ setEntry(load(selDate)); doPullFromDrive(true); }
    if(newTab==="focus") setFocusTick(t=>t+1);
    if(newTab==="habits") setHabitsTick(t=>t+1);
    if(newTab==="ideas") setIdeasTick(t=>t+1);
    if(newTab==="reading") setReadingTick(t=>t+1);
    if(newTab==="goals") setGoalsTick(t=>t+1);
    if(newTab==="reports") setReportsTick(t=>t+1);
    setTab(newTab);
  },[tab,selDate,doPullFromDrive]);

  // Interactive sync — called manually; also gets/caches token so auto-save kicks in after
  const doSyncDrive = useCallback(async()=>{
    setDL(true); setDS("Syncing…");
    try{
      const merged=await mergeAndSaveToDrive(entries); // getToken() called inside, caches token; also syncs habits
      if(applyDriveEntries(merged)){ setEntries(allEntries()); setEntry(load(selDate)); }
      setHabitsTick(t=>t+1);
      localStorage.setItem(DRIVE_CONNECTED_KEY,"1");
      setDriveConn(true);
      setNeedsReauth(false);
      const t=new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
      setDS(`✓ Saved to Drive — ${t}`);
      setLastSync(t);
    }catch(e){setDS("✗ "+(e.error_description||e.message||"Sync failed."));}
    finally{setDL(false);}
  },[entries]);

  const doRestoreDrive = useCallback(async()=>{
    setDL(true); setDS("Restoring from Drive…");
    try{
      const driveData=await loadFromDrive(); // interactive token
      if(!driveData){setDS("No backup found in Drive.");return;}
      const data=Array.isArray(driveData.entries)?driveData.entries:[];
      const count=applyDriveEntries(data);
      const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
      }
      const driveIdeas=Array.isArray(driveData.ideas)?driveData.ideas:[];
      if(driveIdeas.length){
        const local=loadIdeas();
        const localIds=new Set(local.map(i=>i.id));
        const extraI=driveIdeas.filter(i=>i.id&&!localIds.has(i.id));
        if(extraI.length){saveIdeas([...local,...extraI]);setIdeasTick(t=>t+1);}
      }
      const driveGoals=Array.isArray(driveData.goals)?driveData.goals:[];
      if(driveGoals.length){
        const local=loadGoals();
        const mergedG=mergeByNewer(local,driveGoals);
        if(stableStr(mergedG)!==stableStr(local)){saveGoals(mergedG);setGoalsTick(t=>t+1);}
      }
      const driveReports=Array.isArray(driveData.reports)?driveData.reports:[];
      if(driveReports.length){
        const local=loadReports();
        const mergedR=mergeByNewer(local,driveReports);
        if(stableStr(mergedR)!==stableStr(local)){saveReports(mergedR);setReportsTick(t=>t+1);}
      }
      setEntries(allEntries());
      setEntry(load(selDate));
      localStorage.setItem(DRIVE_CONNECTED_KEY,"1");
      setDriveConn(true);
      const t=new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true});
      setDS(`✓ Restored ${count} entries — ${t}`);
      setLastSync(t);
    }catch(e){setDS("✗ "+(e.error_description||e.message||"Restore failed."));}
    finally{setDL(false);}
  },[selDate]);

  const disconnectDrive = useCallback(()=>{
    localStorage.removeItem(DRIVE_CONNECTED_KEY);
    setDriveConn(false);
    setDS("");
    setLastSync("");
    _tok=null; _tokExp=0;
  },[]);

  const totalDays      = entries.length;
  const diaryDays      = entries.filter(e=>(e.diaryBlocks||[]).some(b=>b.text?.trim())||e.diary?.trim()).length;
  const todayL         = load(today);
  const doneTodayCount = (todayL.todos||[]).filter(t=>getDone(t)).length;
  const streak = (()=>{
    let s=0;const d=new Date();
    while(true){
      const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const e=load(k);
      const has=(e.diaryBlocks||[]).some(b=>b.text?.trim())||e.diary?.trim()||(e.todos||[]).some(t=>getTxt(t))||(e.gratitude||[]).some(g=>g?.trim());
      if(has){s++;d.setDate(d.getDate()-1);}else break;
    }
    return s;
  })();

  const entrySet = new Set(entries.map(e=>e.date));
  const stats    = {totalDays,diaryDays,streak,doneTodayCount};
  const syncBtnClass = driveConnected?"connected":driveStatus.startsWith("✓")?"synced":driveStatus.startsWith("✗")?"error":"";

  return (
    <ErrorBoundary>
      <style>{css}</style>
      <div className="app">
        <div className={`overlay${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)}/>
        <Sidebar open={sidebarOpen} entries={entries} selectedDate={selDate} today={today} onSelect={selectDay} onToday={onToday} lastSync={lastSync}/>

        <div className="main" ref={mainRef}>
          <div className="topbar">
            <button className="hbg" onClick={()=>setSidebarOpen(o=>!o)}><span/><span/><span/></button>
            <span className="tb-title">My Journal</span>
            <span className="tb-date">{fmtDate(today,{weekday:"short",month:"short",day:"numeric"})}</span>
            {configured&&(
              driveConnected
                ?<div style={{display:"flex",gap:4}}>
                    <button className="tb-sync" onClick={()=>doPullFromDrive(false)} disabled={driveLoading} title="Pull latest from Drive" style={{fontSize:15}}>
                      {driveLoading?"…":"↓☁"}
                    </button>
                    <button className={`tb-sync${syncBtnClass?" "+syncBtnClass:""}`} onClick={doSyncDrive} disabled={driveLoading} title={driveStatus||"Push to Drive"}>
                      {driveLoading?"…":"☁↑"}
                    </button>
                  </div>
                :<button className="tb-sync" onClick={doSyncDrive} disabled={driveLoading} title="Connect Google Drive for auto-sync">
                    {driveLoading?"…":"Connect Drive"}
                  </button>
            )}
          </div>
          <div className="desk-nav">
            {NAVS.map(n=><button key={n.key} className={`npill${tab===n.key?" active":""}`} onClick={()=>switchTab(n.key)}>{n.icon} {n.label}</button>)}
            {configured&&(
              driveConnected
                ?<button className={`npill sync-pill${syncBtnClass?" "+syncBtnClass:""}`} onClick={doSyncDrive} disabled={driveLoading} title={driveStatus||"Auto-syncing to Drive"}>
                    {driveLoading?"…":"☁"} {driveStatus?driveStatus.slice(0,26):"Auto-sync on"}
                  </button>
                :<button className={`npill sync-pill`} onClick={doSyncDrive} disabled={driveLoading} title="Connect Google Drive for auto-sync">
                    {driveLoading?"…":"☁ Connect Drive"}
                  </button>
            )}
          </div>

          {driveNeedsReauth&&(
            <div style={{background:"#fff8e1",borderBottom:"1.5px solid #ffe082",padding:"10px 20px",display:"flex",alignItems:"center",gap:12,fontSize:13}}>
              <span>☁ Drive sync needs a quick reconnect on this device.</span>
              <button onClick={doSyncDrive} disabled={driveLoading}
                style={{background:"#e8900a",color:"#fff",border:"none",borderRadius:6,padding:"5px 14px",fontWeight:600,cursor:"pointer",fontSize:12}}>
                {driveLoading?"…":"Reconnect"}
              </button>
            </div>
          )}

          <div style={{display:tab==="write"?"block":"none"}}>
            <WriteView entry={entry} setEntry={setEntry} selectedDate={selDate} today={today} isEdit={editMode} setEditMode={setEditMode} stats={stats} habitsRefreshKey={habitsTick}/>
          </div>
          <div style={{display:tab==="focus"?"block":"none"}}>
            <FocusView today={today} refreshKey={focusTick} onSelectDay={date=>{selectDay(date);switchTab("write");}}/>
          </div>
          <div style={{display:tab==="goals"?"block":"none"}}>
            <GoalsView refreshKey={goalsTick}/>
          </div>
          <div style={{display:tab==="ideas"?"block":"none"}}>
            <IdeasView refreshKey={ideasTick}/>
          </div>
          <div style={{display:tab==="reading"?"block":"none"}}>
            <ReadingView refreshKey={readingTick} today={today}
              onSelectDay={date=>{selectDay(date);switchTab("write");}}
              onEntriesChanged={()=>{setEntries(allEntries());setEntry(load(selDate));}}/>
          </div>
          <div style={{display:tab==="reports"?"block":"none"}}>
            <ReportsView refreshKey={reportsTick}/>
          </div>
          <div style={{display:tab==="month"?"block":"none"}}>
            <MonthView calMonth={calMonth} setCalMonth={setCalMonth} entrySet={entrySet} selectedDate={selDate} today={today} streak={streak} totalDays={totalDays} onSelect={selectDay}/>
          </div>
          <div style={{display:tab==="search"?"block":"none"}}>
            <SearchView entries={entries} onSelect={selectDay}/>
          </div>
          <div style={{display:tab==="habits"?"block":"none"}}>
            <HabitsView today={today} refreshKey={habitsTick}/>
          </div>
          <div style={{display:tab==="export"?"block":"none"}}>
            <ExportView entries={entries} onImport={()=>{setEntries(allEntries());setEntry(load(selDate));}}
              driveStatus={driveStatus} driveLoading={driveLoading} driveConnected={driveConnected}
              onSyncDrive={doSyncDrive} onRestoreDrive={doRestoreDrive} onPullDrive={()=>doPullFromDrive(false)} onDisconnect={disconnectDrive}/>
          </div>
        </div>

        <div className="bot-nav">
          <div className="bn-items">
            {NAVS.map(n=><button key={n.key} className={`bn-item${tab===n.key?" active":""}`} onClick={()=>switchTab(n.key)}><span className="bn-ico">{n.icon}</span>{n.label}</button>)}
          </div>
        </div>

        <div className={`toast${savedShow?" show":""}`}>✓ Saved</div>
      </div>
    </ErrorBoundary>
  );
}
