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
const blankBook    = () => ({ id:uid(), title:"", author:"", sessions:[blankSession()], notes:"" });
const bookMins     = b => (b.sessions||[]).reduce((acc,s)=>acc+calcMins(s.startTime,s.endTime),0);

// blank personal quote
const blankMyQuote = () => ({ id:uid(), text:"", source:"", ts:nowTs() });
const blankNote    = () => ({ id:uid(), ts:nowTs(), source:"", text:"" });

// ─── Habits helpers ───────────────────────────────────────────────────────────
const HABITS_KEY  = "myjournal_habits";
const blankHabit  = () => ({ id:uid(), name:"" });
const loadHabits  = () => { try{const r=localStorage.getItem(HABITS_KEY);if(r){const d=JSON.parse(r);if(Array.isArray(d))return d;}}catch{} return []; };
const saveHabits  = h => localStorage.setItem(HABITS_KEY, JSON.stringify(h));
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
  investingNotes:   [],
});

const migrate = p => {
  if (!p || typeof p !== "object") return blankEntry();
  // Ensure all array fields are actually arrays (guard against corrupted/old data)
  if (!Array.isArray(p.todos))         p.todos         = [{text:"",done:false}];
  if (!Array.isArray(p.diaryBlocks))   p.diaryBlocks   = [];
  if (!Array.isArray(p.notes))         p.notes         = [];
  if (!Array.isArray(p.myQuotes))      p.myQuotes      = [];
  if (!Array.isArray(p.investingNotes))p.investingNotes= [];
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
  // migrate old books to sessions array format
  p.books = p.books.map(b => {
    if (!b || typeof b !== "object") return null;
    if (!b.sessions) {
      const session = { id:uid(), startTime:b.startTime||"", endTime:b.endTime||"" };
      return { id:b.id||uid(), title:b.title||"", author:b.author||"", sessions:[session], notes:b.notes||"" };
    }
    return b;
  }).filter(Boolean);
  return p;
};

const load  = dk => { try { const r=localStorage.getItem(KEY+dk); if(r) return migrate(JSON.parse(r)); } catch {} return blankEntry(); };
const save  = (dk,data) => localStorage.setItem(KEY+dk, JSON.stringify(data));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  const content=JSON.stringify({v:2,entries,habits:loadHabits()},null,2);
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
// Local entry wins for any date that exists locally; Drive fills in dates missing locally.
const mergeAndSaveToDrive = async (localEntries, token) => {
  if(!token) token=await getToken();
  let toSave = localEntries;
  try {
    const driveData = await loadFromDrive(token);
    if(driveData){
      const driveEntries = Array.isArray(driveData.entries)?driveData.entries:[];
      const localDates = new Set(localEntries.map(e=>e.date));
      const extra = driveEntries.filter(e=>e.date && DATE_RE.test(e.date) && !localDates.has(e.date));
      if(extra.length) toSave = [...localEntries, ...extra];
      const driveHabits = Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length) saveHabits([...local,...extraH]);
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
.ic-invest{background:#E2F0E3;}
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

/* ── investing notes ── */
.inv-block{background:white;border-radius:8px;border:1.5px solid transparent;transition:border-color .2s,box-shadow .2s;overflow:hidden;}
.inv-block:focus-within{border-color:#5a9a6030;box-shadow:0 2px 14px rgba(90,154,96,.08);}
.inv-db-ts{font-size:10px;color:#5a9a60;font-weight:500;letter-spacing:.3px;}
.inv-ta{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;line-height:1.75;}

/* ── investing consolidated view ── */
.invest-view{padding:28px 52px 80px;max-width:760px;}
.invest-entry-card{background:white;border-radius:10px;padding:18px;margin-bottom:16px;border:1.5px solid #e8f0e8;}
.invest-entry-hd{margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #f0f6f0;}
.invest-entry-date{font-family:'Playfair Display',serif;font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:2px;}
.invest-entry-loc{font-size:11px;color:#8ababa;margin-top:2px;}
.invest-note-card{padding-top:12px;margin-top:12px;border-top:1px solid #f0f6f0;}
.invest-note-card:first-child{padding-top:0;margin-top:0;border-top:none;}

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
.bn-ta{width:100%;border:none;outline:none;border-bottom:1.5px solid #e8e2d8;padding:4px 0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-style:italic;font-size:13px;color:#555;background:transparent;resize:none;min-height:38px;transition:border-color .2s;}
.bn-ta:focus{border-color:#8ababa;}
.bn-ta::placeholder{color:#ddd;}
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
.past-invest-txt{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif;font-size:14px;font-weight:300;line-height:1.75;color:#333;white-space:pre-wrap;}
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
.past-book-notes{font-size:13px;color:#666;font-style:italic;margin-top:6px;}
.past-my-quote{border-left:2px solid #C8A96E;padding:8px 0 8px 14px;margin-bottom:10px;}
.pmq-text{font-family:'Playfair Display',serif;font-style:italic;font-size:14px;color:#333;line-height:1.7;margin-bottom:4px;}
.pmq-src{font-size:11px;color:#aaa;}
.past-invest-block{border-left:2px solid #5a9a60;padding:6px 0 6px 14px;margin-bottom:10px;}
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
  .pg-head,.insp-bar,.loc-bar,.stats-row,.content,.past-wrap,.month-view,.search-view,.export-view,.invest-view{padding-left:18px;padding-right:18px;}
  .insp-bar,.loc-bar{margin-left:18px;margin-right:18px;}
  .pg-head{padding-top:18px;}
  .pg-title{font-size:26px;}
  .main{padding-bottom:64px;}
  .toast{bottom:80px;right:16px;}
  .book-fields{grid-template-columns:1fr;}
  /* Prevent iOS auto-zoom on input focus (triggered when font-size < 16px) */
  .ti,.loc-inp,.db-ta,.inv-ta,.bf-inp,.mq-ta,.gi{font-size:16px;}
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
  const sessions   = book.sessions||[];
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
      <textarea className="bn-ta" value={book.notes} placeholder="Any highlights, quotes, or thoughts from this book…"
        onChange={e=>{set("notes",e.target.value);grow(e.target);}}
        onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
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

// ─── InvestingNotes (daily write section) ─────────────────────────────────────
const InvestingNotes = memo(({ notes, onChange }) => {
  const add = useCallback(()=>onChange([...notes,{id:uid(),ts:nowTs(),text:""}]),[notes,onChange]);
  const upd = useCallback((id,text)=>onChange(notes.map(n=>n.id===id?{...n,text}:n)),[notes,onChange]);
  const del = useCallback(id=>onChange(notes.filter(n=>n.id!==id)),[notes,onChange]);
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  return (
    <div className="diary-blocks">
      {notes.map(n=>(
        <div key={n.id} className="inv-block">
          <div className="db-meta">
            <span className="inv-db-ts">{n.ts?fmtTime(n.ts):"earlier"}</span>
            <button className="db-del" onClick={()=>del(n.id)}>×</button>
          </div>
          <textarea className="db-ta inv-ta" value={n.text} placeholder="Investment thesis, market observations, stock notes…"
            onChange={e=>{upd(n.id,e.target.value);grow(e.target);}}
            onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}/>
        </div>
      ))}
      <button className="add-row" onClick={add}>
        {notes.length===0?"+ Add an investing note…":`+ Add another · ${new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`}
      </button>
    </div>
  );
});

// ─── InvestNoteCard (editable card in consolidated view) ──────────────────────
const InvestNoteCard = memo(({ note, date, onSave, onDelete }) => {
  const [text, setText] = useState(note.text);
  const timer = useRef(null);
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};

  const handleChange = val => {
    setText(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(()=>onSave(date,note.id,val),700);
  };

  return (
    <div className="invest-note-card">
      <div className="db-meta" style={{padding:"0 0 6px"}}>
        <span className="inv-db-ts">{note.ts?fmtTime(note.ts):"earlier"}</span>
        <button className="db-del" onClick={()=>onDelete(date,note.id)}>×</button>
      </div>
      <textarea className="db-ta inv-ta" value={text}
        onChange={e=>{handleChange(e.target.value);grow(e.target);}}
        onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}
        placeholder="Investment thoughts…"/>
    </div>
  );
});

// ─── Investor Profiles (multiple, persistent, stored outside daily entries) ───
const INVESTOR_KEY    = "myjournal_investor";
const blankInvestor   = () => ({ id:uid(), name:"", strategy:"", website:"" });
const loadInvestors   = () => {
  try {
    const r=localStorage.getItem(INVESTOR_KEY);
    if(r){
      const d=JSON.parse(r);
      if(Array.isArray(d)) return d.length?d:[blankInvestor()];
      if(d&&typeof d==="object") return [{id:uid(),...d}]; // migrate single→array
    }
  } catch {}
  return [blankInvestor()];
};
const saveInvestors = d => localStorage.setItem(INVESTOR_KEY, JSON.stringify(d));

const InvestorProfile = memo(() => {
  const [profiles, setProfiles] = useState(()=>loadInvestors());
  const grow = el=>{if(!el)return;el.style.height="auto";el.style.height=el.scrollHeight+"px";};
  const upd = useCallback((id,f,v)=>{const u=profiles.map(p=>p.id===id?{...p,[f]:v}:p);setProfiles(u);saveInvestors(u);},[profiles]);
  const add = useCallback(()=>{const u=[...profiles,blankInvestor()];setProfiles(u);saveInvestors(u);},[profiles]);
  const del = useCallback(id=>{const u=profiles.filter(p=>p.id!==id);const f=u.length?u:[blankInvestor()];setProfiles(f);saveInvestors(f);},[profiles]);
  return (
    <div style={{marginBottom:14}}>
      {profiles.map((p,i)=>(
        <div key={p.id} style={{background:"white",borderRadius:10,padding:"16px 18px",border:"1.5px solid #d8eed8",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{fontSize:10,color:"#5a9a60",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:500}}>
              {profiles.length>1?`Investor ${i+1}`:"Investor Profile"}
            </div>
            {profiles.length>1&&<button className="db-del" onClick={()=>del(p.id)}>×</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:12}}>
            <div className="bf">
              <div className="bf-lbl">Name</div>
              <input className="bf-inp" value={p.name} placeholder="Your name…" onChange={e=>upd(p.id,"name",e.target.value)}/>
            </div>
            <div className="bf">
              <div className="bf-lbl">Website / Reference</div>
              <input className="bf-inp" value={p.website} placeholder="e.g. https://example.com" onChange={e=>upd(p.id,"website",e.target.value)}/>
            </div>
          </div>
          <div className="bf">
            <div className="bf-lbl">Investment Strategy</div>
            <textarea className="bn-ta" value={p.strategy}
              placeholder="Describe your investment strategy — philosophy, focus areas, time horizon…"
              onChange={e=>{upd(p.id,"strategy",e.target.value);grow(e.target);}}
              onFocus={e=>grow(e.target)} ref={el=>{if(el)grow(el);}}
              style={{marginTop:4,minHeight:52}}/>
          </div>
        </div>
      ))}
      <button className="add-row" onClick={add}>+ Add another investor profile</button>
    </div>
  );
});

// ─── InvestingView (consolidated all-notes view) ──────────────────────────────
const InvestingView = memo(({ onAddToday }) => {
  const [tick, setTick] = useState(0);
  const entriesWithNotes = useMemo(()=>
    allEntries().filter(e=>(e.investingNotes||[]).some(n=>n.text?.trim()))
  ,[tick]);

  const saveNote = useCallback((date,noteId,text)=>{
    const e = load(date);
    save(date,{...e,investingNotes:(e.investingNotes||[]).map(n=>n.id===noteId?{...n,text}:n)});
  },[]);

  const deleteNote = useCallback((date,noteId)=>{
    const e = load(date);
    save(date,{...e,investingNotes:(e.investingNotes||[]).filter(n=>n.id!==noteId)});
    setTick(t=>t+1);
  },[]);

  return (
    <div className="invest-view">
      <div className="eyebrow">Investing</div>
      <h1 className="pg-title">My <em>Investing</em> Notes</h1>
      <p style={{fontSize:13,color:"#aaa",fontWeight:300,marginTop:6,marginBottom:20}}>
        All your investing notes in one place — editable here or from any daily entry.
      </p>

      <InvestorProfile/>

      <button className="add-row" style={{marginBottom:24}} onClick={onAddToday}>
        📈 Add investing note for today
      </button>

      {entriesWithNotes.length===0&&(
        <div className="empty">No investing notes yet. Use the button above to start tracking your investment thoughts.</div>
      )}

      {entriesWithNotes.map(entry=>(
        <div key={entry.date} className="invest-entry-card">
          <div className="invest-entry-hd">
            <div className="invest-entry-date">
              {fmtDate(entry.date,{weekday:"short",month:"long",day:"numeric",year:"numeric"})}
            </div>
            {entry.location&&<div className="invest-entry-loc">📍 {entry.location}</div>}
          </div>
          {(entry.investingNotes||[]).filter(n=>n.text?.trim()).map(note=>(
            <InvestNoteCard key={note.id} note={note} date={entry.date} onSave={saveNote} onDelete={deleteNote}/>
          ))}
        </div>
      ))}
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
  const setInvestNotes   = useCallback(investingNotes=>setEntry(e=>({...e,investingNotes})),[setEntry]);

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
    const invNotes= entry.investingNotes||[];
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

          {invNotes.filter(n=>n.text?.trim()).length>0&&<div className="past-sec">
            <div className="past-lbl">Investing Notes</div>
            {invNotes.filter(n=>n.text?.trim()).map(n=>(
              <div key={n.id} className="past-invest-block">
                {n.ts&&<div className="past-inv-ts">{fmtTime(n.ts)}</div>}
                <div className="past-invest-txt">{n.text}</div>
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
                  {b.notes&&<div className="past-book-notes">{b.notes}</div>}
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
          <div className="sec-hd"><div className="sec-ic ic-invest">📈</div><div className="sec-ttl">Investing Notes</div><div className="sec-hint">thesis · ideas · observations</div></div>
          <InvestorProfile/>
          <InvestingNotes notes={entry.investingNotes||[]} onChange={setInvestNotes}/>
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
          let hasDiary=false,hasGrat=false,hasRead=false,hasQuote=false,hasInvest=false;
          if(has){try{const e=JSON.parse(localStorage.getItem(KEY+k)||"{}");hasDiary=!!(e.diaryBlocks?.some(b=>b.text?.trim())||e.diary?.trim());hasGrat=e.gratitude?.some(g=>g?.trim());hasRead=(e.books||[]).some(b=>b.title);hasQuote=(e.myQuotes||[]).some(q=>q.text?.trim());hasInvest=(e.investingNotes||[]).some(n=>n.text?.trim());}catch{}}
          return (
            <div key={k} className={`cal-day${has?" has":""}${k===today?" today":""}${k===selectedDate?" sel":""}`} onClick={()=>{if(has)onSelect(k);}}>
              {d}
              {has&&<div className="cal-dots">
                {hasDiary&&<div className="cal-dot dot-d"/>}
                {hasGrat&&<div className="cal-dot dot-g"/>}
                {hasRead&&<div className="cal-dot dot-r"/>}
                {hasQuote&&<div className="cal-dot dot-q"/>}
                {hasInvest&&<div className="cal-dot dot-i"/>}
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
        <span><span style={{color:"#5a9a60"}}>●</span> investing</span>
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
        const blob=[...(e.diaryBlocks||[]).map(b=>b.text||""),e.diary||"",...(e.todos||[]).map(getTxt),...(e.gratitude||[]),e.location||"",...(e.books||[]).map(b=>`${b.title} ${b.author} ${b.notes}`),...(e.myQuotes||[]).map(q=>`${q.text} ${q.source}`),...(e.investingNotes||[]).map(n=>n.text||""),...(e.notes||[]).map(n=>`${n.source||""} ${n.text||""}`)].join(" ").toLowerCase();
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
  const blob=(e)=>[...(e.diaryBlocks||[]).map(b=>b.text||""),e.diary||"",...(e.todos||[]).map(getTxt),...(e.gratitude||[]),...(e.myQuotes||[]).map(q=>q.text||""),...(e.investingNotes||[]).map(n=>n.text||""),...(e.notes||[]).map(n=>n.text||"")].join(" ");
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
      const invest =(e.investingNotes||[]).filter(n=>n.text?.trim()).map(n=>`${n.ts?`*${fmtTime(n.ts)}*\n\n`:""}${n.text}`).join("\n\n---\n\n");
      const books  =(e.books||[]).filter(b=>b.title).map(b=>{const m=bookMins(b);const sess=(b.sessions||[]).filter(s=>s.startTime).map(s=>`${s.startTime}${s.endTime?`→${s.endTime}`:" (in progress)"}`).join(", ");return `📖 **${b.title}**${b.author?` — ${b.author}`:""}${sess?` · ${sess}`:""}${m>0?` (${fmtMins(m)})`:""}${b.notes?`\n\n> ${b.notes}`:""}`}).join("\n\n");
      const quotes =(e.myQuotes||[]).filter(q=>q.text?.trim()).map(q=>`> "${q.text}"${q.source?`\n> — ${q.source}`:""}`).join("\n\n");
      const grat   =(e.gratitude||[]).filter(g=>g?.trim()).map((g,i)=>`${i+1}. ${g}`).join("\n");
      const loc    = e.location?`📍 ${e.location}\n\n`:"";
      return `# ${fmtDate(e.date)}\n\n${loc}## Focus\n${todos||"—"}\n\n## Journal\n${story||"—"}\n\n## Notes\n${entNotes||"—"}\n\n## Investing Notes\n${invest||"—"}\n\n## Reading\n${books||"—"}\n\n## Quotes\n${quotes||"—"}\n\n## Grateful For\n${grat||"—"}\n\n---`;
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
      <div className="ex-card"><h3>Markdown</h3><p>All entries — journal, investing notes, books, quotes, gratitude — as a .md file. Great for Obsidian or Notion.</p><button className="ex-btn sec" onClick={dlMd}>Download .md</button></div>
      <div className="ex-card"><h3>Substack / Blog</h3><p>Journal entries + quotes, formatted for Substack.</p><button className="ex-btn sec" onClick={dlSub}>Download for Substack</button></div>
    </div>
  );
});

// ─── App ──────────────────────────────────────────────────────────────────────
const NAVS = [
  {key:"write",  icon:"✦",  label:"Write"},
  {key:"focus",  icon:"◎",  label:"Focus"},
  {key:"month",  icon:"◫",  label:"Month"},
  {key:"search", icon:"⌕",  label:"Search"},
  {key:"invest", icon:"◈",  label:"Invest"},
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
  const [driveStatus,   setDS]          = useState("");
  const [driveLoading,  setDL]          = useState(false);
  const [lastSync,      setLastSync]    = useState("");
  // driveConnected: user has authorized Drive at least once (persisted in localStorage)
  const [driveConnected,setDriveConn]  = useState(()=>!!localStorage.getItem(DRIVE_CONNECTED_KEY));
  const [driveNeedsReauth, setNeedsReauth] = useState(false);
  const saveTimer  = useRef(null);
  const autoSTimer = useRef(null);
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
        let count=0;
        data.forEach(e=>{if(e.date && DATE_RE.test(e.date)){const {date,...rest}=e;localStorage.setItem(KEY+date,JSON.stringify(migrate(rest)));count++;}});
        const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
        if(driveHabits.length){
          const local=loadHabits();
          const localIds=new Set(local.map(h=>h.id));
          const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
          if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
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
      // Auto-push to Drive if we have a cached token (no prompt)
      if(configured&&driveConnected){
        const token=getCachedToken();
        if(token){
          clearTimeout(autoSTimer.current);
          autoSTimer.current=setTimeout(async()=>{
            try{
              const merged=await mergeAndSaveToDrive(updated,token);
              // Persist any Drive-only entries into local storage
              const localDates=new Set(updated.map(e=>e.date));
              merged.filter(e=>!localDates.has(e.date)).forEach(({date,...rest})=>
                localStorage.setItem(KEY+date,JSON.stringify(migrate(rest))));
              if(merged.length>updated.length) setEntries(allEntries());
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
      let count=0;
      data.forEach(e=>{if(e.date && DATE_RE.test(e.date)){const {date,...rest}=e;localStorage.setItem(KEY+date,JSON.stringify(migrate(rest)));count++;}});
      const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
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
    if(newTab==="write"&&tab!=="write"){ setEntry(load(selDate)); doPullFromDrive(true); }
    if(newTab==="focus") setFocusTick(t=>t+1);
    if(newTab==="habits") setHabitsTick(t=>t+1);
    setTab(newTab);
  },[tab,selDate,doPullFromDrive]);

  // Interactive sync — called manually; also gets/caches token so auto-save kicks in after
  const doSyncDrive = useCallback(async()=>{
    setDL(true); setDS("Syncing…");
    try{
      const merged=await mergeAndSaveToDrive(entries); // getToken() called inside, caches token; also syncs habits
      const localDates=new Set(entries.map(e=>e.date));
      merged.filter(e=>!localDates.has(e.date)).forEach(e=>
        localStorage.setItem(KEY+e.date,JSON.stringify(migrate({...e}))));
      if(merged.length>entries.length){ setEntries(allEntries()); setEntry(load(selDate)); }
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
      let count=0;
      data.forEach(e=>{if(e.date && DATE_RE.test(e.date)){const {date,...rest}=e;localStorage.setItem(KEY+date,JSON.stringify(migrate(rest)));count++;}});
      const driveHabits=Array.isArray(driveData.habits)?driveData.habits:[];
      if(driveHabits.length){
        const local=loadHabits();
        const localIds=new Set(local.map(h=>h.id));
        const extraH=driveHabits.filter(h=>h.id&&!localIds.has(h.id));
        if(extraH.length){saveHabits([...local,...extraH]);setHabitsTick(t=>t+1);}
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

  const onAddInvestingToday = useCallback(()=>selectDay(today),[selectDay,today]);

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
          <div style={{display:tab==="month"?"block":"none"}}>
            <MonthView calMonth={calMonth} setCalMonth={setCalMonth} entrySet={entrySet} selectedDate={selDate} today={today} streak={streak} totalDays={totalDays} onSelect={selectDay}/>
          </div>
          <div style={{display:tab==="search"?"block":"none"}}>
            <SearchView entries={entries} onSelect={selectDay}/>
          </div>
          <div style={{display:tab==="invest"?"block":"none"}}>
            <InvestingView onAddToday={onAddInvestingToday}/>
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
