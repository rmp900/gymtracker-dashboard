import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie
} from "recharts";

const API_BASE = "https://gymtracker-api-production-bc16.up.railway.app";

const DEVICE_NAMES = {
  device_001: "Leg Press",
  device_002: "Pulley",
  device_003: "Peck Deck",
};
const DEVICE_COLORS = {
  device_001: "#5DCAA5",
  device_002: "#378ADD",
  device_003: "#D85A30",
};

// Horario de funcionamento
const HOR = {
  0: { open: false },
  1: { p: [[6,12],[13,23]] }, 2: { p: [[6,12],[13,23]] },
  3: { p: [[6,12],[13,23]] }, 4: { p: [[6,12],[13,23]] },
  5: { p: [[6,12],[13,23]] }, 6: { p: [[8,12]] },
};
const FERIADOS = ['01-01','21-04','01-05','07-09','12-10','02-11','15-11','25-12','20-11','20-04'];

function isAberto(d) {
  const k = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (FERIADOS.includes(k)) return false;
  const dia = HOR[d.getDay()];
  if (!dia || !dia.p) return false;
  const h = d.getHours() + d.getMinutes() / 60;
  return dia.p.some(([s, e]) => h >= s && h < e);
}

function proxHorario(d) {
  const nomes = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  const h = d.getHours() + d.getMinutes() / 60;
  const dia = HOR[d.getDay()];
  if (dia && dia.p) {
    for (const [s] of dia.p) { if (h < s) return `Abre hoje às ${s}h`; }
  }
  for (let i = 1; i <= 7; i++) {
    const idx = (d.getDay() + i) % 7;
    const prox = HOR[idx];
    if (prox && prox.p && prox.p.length) {
      return `Abre ${i === 1 ? 'amanhã' : nomes[idx]} às ${prox.p[0][0]}h`;
    }
  }
  return '';
}

const O = "#ea580c"; const OL = "#fff7ed"; const OD = "#9a3412";
const BG = "#f5f4f0"; const WHITE = "#ffffff";
const DARK = "#1c1917"; const MID = "#78716c"; const BORDER = "#e7e5e4";

function todayBRT() {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  const pad = x => String(x).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function fmtDateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long"
  });
}

function parseSession(s) {
  const deviceId = s.device_id || s.deviceId || s.device || "";
  const start = s.inicio || s.start_time || s.started_at || s.created_at;
  const end = s.fim || s.end_time || s.ended_at;
  let duracao = s.duracao_segundos || s.duracao || s.duration;
  if (!duracao && start && end) duracao = Math.round((new Date(end) - new Date(start)) / 1000);
  return {
    id: s.id, deviceId,
    deviceName: DEVICE_NAMES[deviceId] || deviceId || "Aparelho",
    start: start ? new Date(start) : null,
    end: end ? new Date(end) : null,
    duracao: duracao ? Math.round(Number(duracao)) : null,
  };
}

function calcOcupacao(sessions) {
  const corte = new Date(Date.now() - 5 * 60 * 1000);
  const ativos = new Set(sessions.filter(s => s.start && s.start >= corte).map(s => s.deviceId));
  const n = ativos.size;
  if (n >= 3) return { label: "Academia cheia",        cor: "#dc2626", badge: "🔴" };
  if (n === 2) return { label: "Bem movimentada",       cor: "#d97706", badge: "🟡" };
  if (n === 1) return { label: "Tranquila",             cor: "#16a34a", badge: "🟢" };
  return              { label: "Sem atividade recente", cor: MID,       badge: "⚪" };
}

function computeStats(sessions) {
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hora: `${String(h).padStart(2, "0")}h`, sessoes: 0,
  }));
  sessions.forEach(s => { if (s.start) byHour[s.start.getHours()].sessoes++; });
  const peakSlot = byHour.reduce((mx, cur) => cur.sessoes > mx.sessoes ? cur : mx, byHour[0]);
  const withDur = sessions.filter(s => s.duracao && s.duracao > 0);
  const avgDur = withDur.length ? Math.round(withDur.reduce((a, s) => a + s.duracao, 0) / withDur.length) : 0;
  const deviceMap = {};
  sessions.forEach(s => { deviceMap[s.deviceName] = (deviceMap[s.deviceName] || 0) + 1; });
  const ranking = Object.entries(deviceMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return {
    sessoesNoDia: sessions.length, totalDevices: Object.keys(DEVICE_NAMES).length,
    horarioPico: peakSlot.sessoes > 0 ? peakSlot.hora : "—", avgDurSegundos: avgDur,
    byHour, ranking, maxRank: ranking[0]?.count || 1,
    ultimas: [...sessions].reverse().slice(0, 10),
  };
}

function toPieData(sessions) {
  const counts = {};
  Object.keys(DEVICE_NAMES).forEach(id => { counts[id] = 0; });
  sessions.forEach(s => { if (s.deviceId in counts) counts[s.deviceId]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    total,
    data: Object.entries(counts).map(([id, value]) => ({
      name: DEVICE_NAMES[id],
      short: DEVICE_NAMES[id].split(' ')[0],
      value,
      pct: total > 0 ? Math.round(value / total * 100) : 0,
      color: DEVICE_COLORS[id],
    })),
  };
}

function fmtDur(s) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 1) return `${s}s`;
  if (m < 60) return sec > 0 ? `${m}min ${sec}s` : `${m}min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
function fmtHora(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDataHora(d) {
  if (!d) return "—";
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) return `Hoje ${fmtHora(d)}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${fmtHora(d)}`;
}

async function safeFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { mode: "cors", signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } catch(e) { clearTimeout(t); throw e; }
}

const CustomBarTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: DARK, color: WHITE, padding: "6px 12px", borderRadius: 6, fontSize: 13 }}>
      <strong style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15 }}>{payload[0].value}</strong>{" sessões"}
    </div>
  );
};

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: WHITE, borderRadius: 12, padding: "20px 22px", border: `1px solid ${BORDER}`, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, fontWeight: 700, color: DARK, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MID, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function OcupacaoCard({ sessions, agora }) {
  const aberto = isAberto(agora);
  const ocupacao = calcOcupacao(sessions);
  const bg = aberto ? `${ocupacao.cor}11` : WHITE;
  const borderColor = aberto ? `${ocupacao.cor}33` : BORDER;

  return (
    <div style={{
      background: bg, border: `1.5px solid ${borderColor}`,
      borderRadius: 12, padding: "18px 22px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, flex: "1 1 100%",
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          Ocupação agora
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>{aberto ? ocupacao.badge : "🔒"}</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700, color: aberto ? ocupacao.cor : DARK }}>
            {aberto ? ocupacao.label : "Academia fechada"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: MID, marginTop: 4 }}>
          {aberto ? "Baseado em atividade nos últimos 5 min" : proxHorario(agora)}
        </div>
      </div>
      <a href="/status.html" target="_blank" rel="noreferrer" style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        background: O, color: WHITE, borderRadius: 10, padding: "12px 18px",
        textDecoration: "none", flexShrink: 0,
      }}>
        <span style={{ fontSize: 20 }}>📺</span>
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Barlow', sans-serif", letterSpacing: "0.04em" }}>
          Ver ao vivo
        </span>
      </a>
    </div>
  );
}

function DonutChart({ sessions, label, loading }) {
  const { total, data } = toPieData(sessions);
  const emptySlice = [{ value: 1, color: "#e7e5e4" }];

  return (
    <div style={{
      flex: 1, background: WHITE, border: `1px solid ${BORDER}`,
      borderRadius: 12, padding: "16px 14px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", minWidth: 160,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ position: "relative", width: 130, height: 130 }}>
        <PieChart width={130} height={130}>
          <Pie data={total > 0 ? data : emptySlice}
            cx={60} cy={60} innerRadius={38} outerRadius={56}
            dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
            {(total > 0 ? data : emptySlice).map((e, i) => <Cell key={i} fill={e.color} />)}
          </Pie>
        </PieChart>
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none",
        }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 700, color: total > 0 ? DARK : "#c4bfbb", lineHeight: 1 }}>
            {loading ? "·" : total}
          </div>
          <div style={{ fontSize: 9, color: MID, marginTop: 2 }}>sessões</div>
        </div>
      </div>
      {total > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10, width: "100%" }}>
          {data.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: MID, flex: 1, textAlign: "left" }}>{d.short}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: DARK }}>{d.pct}%</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#c4bfbb", marginTop: 10 }}>
          {loading ? "Carregando..." : "Sem dados"}
        </div>
      )}
    </div>
  );
}

export default function GymTracker() {
  const [sessions, setSessions]         = useState([]);
  const [sessions7, setSessions7]       = useState([]);
  const [sessions30, setSessions30]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [loadingPeriod, setLoadingPeriod] = useState(true);
  const [offline, setOffline]           = useState(false);
  const [lastUpdate, setLastUpdate]     = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayBRT());

  const isToday = selectedDate === todayBRT();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadingPeriod(true);
    setSessions([]); setSessions7([]); setSessions30([]);

    // Dia
    try {
      const d = await safeFetch(`${API_BASE}/sessoes/dia?data=${selectedDate}`);
      setSessions((Array.isArray(d) ? d : []).map(parseSession));
      setOffline(false);
      setLastUpdate(new Date());
    } catch(e) {
      setOffline(true);
    } finally {
      setLoading(false);
    }

    // 7 dias
    try {
      const d7 = await safeFetch(`${API_BASE}/sessoes/periodo?inicio=${addDays(selectedDate,-6)}&fim=${selectedDate}`);
      setSessions7((Array.isArray(d7) ? d7 : []).map(parseSession));
    } catch(e) { setSessions7([]); }

    // 30 dias
    try {
      const d30 = await safeFetch(`${API_BASE}/sessoes/periodo?inicio=${addDays(selectedDate,-29)}&fim=${selectedDate}`);
      setSessions30((Array.isArray(d30) ? d30 : []).map(parseSession));
    } catch(e) { setSessions30([]); }

    setLoadingPeriod(false);
  }, [selectedDate]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(loadAll, 30000);
    return () => clearInterval(t);
  }, [loadAll, isToday]);

  const stats = computeStats(sessions);
  const agora = new Date();

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: BG, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${BG}; }
        .gt-row { display: flex; gap: 16px; flex-wrap: wrap; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        .fade-up { animation: fadeUp 0.35s ease both; }
        @keyframes barGrow { from { width: 0 } to { width: var(--w) } }
        .rank-bar-fill { animation: barGrow 0.6s ease both; }
        tr:hover td { background: #fafaf8 !important; }
        .gt-subheader { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 28px; background:${OD}; flex-wrap:wrap; }
        @media (max-width:480px) { .gt-subheader { padding:6px 16px; } }
        .date-nav-btn { background:rgba(255,255,255,0.15); border:none; color:white; width:26px; height:26px; border-radius:6px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; transition:background 0.15s; }
        .date-nav-btn:hover { background:rgba(255,255,255,0.28); }
        .date-nav-btn:disabled { opacity:0.35; cursor:default; }
        .date-input { background:rgba(255,255,255,0.15); border:none; font-family:'Barlow',sans-serif; font-size:12px; font-weight:600; border-radius:6px; padding:3px 8px; cursor:pointer; color:white; color-scheme:dark; }
        .date-input::-webkit-calendar-picker-indicator { filter:invert(1); opacity:0.7; cursor:pointer; }
        .today-btn { background:rgba(255,255,255,0.18); border:none; color:white; font-family:'Barlow',sans-serif; font-size:11px; font-weight:600; border-radius:6px; padding:3px 10px; cursor:pointer; text-transform:uppercase; letter-spacing:0.06em; transition:background 0.15s; }
        .today-btn:hover { background:rgba(255,255,255,0.28); }
        .today-btn:disabled { opacity:0.4; cursor:default; }
      `}</style>

      <header style={{ background:O, backgroundImage:"repeating-linear-gradient(135deg,transparent,transparent 20px,rgba(0,0,0,0.04) 20px,rgba(0,0,0,0.04) 22px)", padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56 }}>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:800, color:WHITE, letterSpacing:"0.03em" }}>GYMTRACKER</div>
        <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.18)", borderRadius:20, padding:"4px 12px" }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:WHITE, opacity:offline?0.4:1 }} />
          <span style={{ fontSize:12, fontWeight:600, color:WHITE }}>
            {offline ? "FORA DO AR" : loading ? "CONECTANDO" : isToday ? "AO VIVO" : "HISTÓRICO"}
          </span>
        </div>
      </header>

      <div className="gt-subheader">
        <span style={{ fontSize:12, color:"rgba(255,255,255,0.8)", fontWeight:500, textTransform:"capitalize" }}>
          {fmtDateLabel(selectedDate)}
        </span>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <button className="date-nav-btn" onClick={() => {
            const [y,m,d] = selectedDate.split("-").map(Number);
            const p = new Date(y,m-1,d-1), pad = n => String(n).padStart(2,"0");
            setSelectedDate(`${p.getFullYear()}-${pad(p.getMonth()+1)}-${pad(p.getDate())}`);
          }}>&#8249;</button>
          <input type="date" className="date-input" value={selectedDate} max={todayBRT()}
            onChange={e => e.target.value && setSelectedDate(e.target.value)} />
          <button className="date-nav-btn" disabled={isToday} onClick={() => {
            const [y,m,d] = selectedDate.split("-").map(Number);
            const n = new Date(y,m-1,d+1), pad = x => String(x).padStart(2,"0");
            const s = `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`;
            if (s <= todayBRT()) setSelectedDate(s);
          }}>&#8250;</button>
          <button className="today-btn" disabled={isToday} onClick={() => setSelectedDate(todayBRT())}>Hoje</button>
          {isToday && lastUpdate && (
            <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)", whiteSpace:"nowrap" }}>{fmtHora(lastUpdate)}</span>
          )}
        </div>
      </div>

      <main style={{ padding:"24px 28px", maxWidth:1200, margin:"0 auto" }}>

        {isToday && !loading && (
          <div className="gt-row fade-up" style={{ marginBottom:20 }}>
            <OcupacaoCard sessions={sessions} agora={agora} />
          </div>
        )}

        <div className="gt-row fade-up" style={{ marginBottom:20, animationDelay:"0.05s" }}>
          <StatCard label="Aparelhos" value={stats.totalDevices} sub="monitorados" />
          <StatCard label={isToday?"Sessões hoje":"Sessões no dia"} value={loading&&!sessions.length?"—":stats.sessoesNoDia} sub={stats.sessoesNoDia>0?`${stats.sessoesNoDia} registradas`:"nenhuma sessão"} />
          <StatCard label="Horário de pico" value={stats.horarioPico} sub="mais movimentado" />
          <StatCard label="Duração média" value={stats.avgDurSegundos>0?fmtDur(stats.avgDurSegundos):"—"} sub="por sessão" />
        </div>

        <div className="gt-row fade-up" style={{ marginBottom:20, animationDelay:"0.08s" }}>
          <div style={{ background:WHITE, borderRadius:12, border:`1px solid ${BORDER}`, padding:"22px 22px 16px", flex:"2 1 380px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:600, color:O, textTransform:"uppercase", letterSpacing:"0.08em" }}>Uso por horário</div>
                <div style={{ fontSize:13, color:MID, marginTop:2 }}>Sessões iniciadas — {isToday?"hoje":fmtDateLabel(selectedDate).replace(/^[^,]+,\s*/,"")}</div>
              </div>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:28, fontWeight:700, color:DARK }}>{stats.sessoesNoDia}</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.byHour} barSize={14} margin={{ top:0, right:4, bottom:0, left:-28 }}>
                <XAxis dataKey="hora" tick={{ fontSize:11, fill:MID }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize:11, fill:MID }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill:OL }} />
                <Bar dataKey="sessoes" radius={[4,4,0,0]}>
                  {stats.byHour.map((e,i) => {
                    const mx = Math.max(...stats.byHour.map(h => h.sessoes));
                    return <Cell key={i} fill={e.sessoes===mx&&e.sessoes>0?O:"#fcd9b6"} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background:WHITE, borderRadius:12, border:`1px solid ${BORDER}`, padding:"22px", flex:"1 1 220px" }}>
            <div style={{ fontSize:12, fontWeight:600, color:O, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Ranking</div>
            <div style={{ fontSize:13, color:MID, marginBottom:20 }}>Mais usados — {isToday?"hoje":"no dia"}</div>
            {stats.ranking.length===0 ? (
              <div style={{ color:MID, fontSize:13, textAlign:"center", paddingTop:40 }}>{loading?"Carregando...":"Sem sessões neste dia"}</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {stats.ranking.map((item,i) => (
                  <div key={item.name}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:22, height:22, borderRadius:4, background:i===0?O:OL, color:i===0?WHITE:OD, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed',sans-serif", fontSize:12, fontWeight:700 }}>{i+1}</div>
                        <span style={{ fontSize:14, fontWeight:500, color:DARK }}>{item.name}</span>
                      </div>
                      <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:18, fontWeight:700, color:i===0?O:DARK }}>{item.count}</span>
                    </div>
                    <div style={{ background:OL, borderRadius:20, height:8, overflow:"hidden" }}>
                      <div className="rank-bar-fill" style={{ "--w":`${Math.round(item.count/stats.maxRank*100)}%`, width:`${Math.round(item.count/stats.maxRank*100)}%`, height:"100%", background:i===0?O:"#fdba74", borderRadius:20, animationDelay:`${i*0.1+0.2}s` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Graficos de pizza */}
        <div className="gt-row fade-up" style={{ marginBottom:20, animationDelay:"0.12s" }}>
          <DonutChart sessions={sessions}   label={isToday?"Hoje":"Dia selecionado"} loading={loading} />
          <DonutChart sessions={sessions7}  label="Últimos 7 dias"                  loading={loadingPeriod} />
          <DonutChart sessions={sessions30} label="Últimos 30 dias"                 loading={loadingPeriod} />
        </div>

        <div className="fade-up" style={{ background:WHITE, borderRadius:12, border:`1px solid ${BORDER}`, overflow:"hidden", animationDelay:"0.16s" }}>
          <div style={{ padding:"18px 22px 14px", borderBottom:`1px solid ${BORDER}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:O, textTransform:"uppercase", letterSpacing:"0.08em" }}>{isToday?"Últimas sessões":"Sessões do dia"}</div>
              <div style={{ fontSize:13, color:MID, marginTop:2 }}>{sessions.length>0?`${sessions.length} sessão${sessions.length!==1?"ões":""} registrada${sessions.length!==1?"s":""}` : "nenhuma sessão"}</div>
            </div>
            {isToday && (
              <button onClick={loadAll} style={{ background:"transparent", border:`1px solid ${BORDER}`, borderRadius:8, padding:"5px 14px", fontSize:12, fontWeight:500, color:MID, cursor:"pointer", fontFamily:"'Barlow',sans-serif" }}>
                ↺ Atualizar
              </button>
            )}
          </div>
          {loading&&!sessions.length ? (
            <div style={{ padding:"40px", textAlign:"center", color:MID, fontSize:14 }}>Carregando...</div>
          ) : stats.ultimas.length===0 ? (
            <div style={{ padding:"40px", textAlign:"center", color:MID, fontSize:14 }}>Nenhuma sessão neste dia.</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"#fafaf8" }}>
                  {["Aparelho","Início","Fim","Duração","Device ID"].map(h => (
                    <th key={h} style={{ padding:"10px 22px", textAlign:"left", fontSize:11, fontWeight:600, color:MID, textTransform:"uppercase", letterSpacing:"0.07em", borderBottom:`1px solid ${BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.ultimas.map((s,i) => (
                  <tr key={s.id||i}>
                    <td style={{ padding:"12px 22px", borderBottom:`1px solid ${BORDER}` }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:O, flexShrink:0 }} />
                        <span style={{ fontSize:14, fontWeight:500, color:DARK }}>{s.deviceName}</span>
                      </div>
                    </td>
                    <td style={{ padding:"12px 22px", fontSize:13, color:DARK, borderBottom:`1px solid ${BORDER}` }}>{fmtDataHora(s.start)}</td>
                    <td style={{ padding:"12px 22px", fontSize:13, color:MID, borderBottom:`1px solid ${BORDER}` }}>
                      {s.end?fmtDataHora(s.end):<span style={{ color:O, fontWeight:500 }}>Em uso</span>}
                    </td>
                    <td style={{ padding:"12px 22px", borderBottom:`1px solid ${BORDER}` }}>
                      <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:15, fontWeight:600, color:s.duracao&&s.duracao>0?DARK:O }}>{fmtDur(s.duracao)}</span>
                    </td>
                    <td style={{ padding:"12px 22px", fontSize:12, color:MID, fontFamily:"monospace", borderBottom:`1px solid ${BORDER}` }}>{s.deviceId||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ textAlign:"center", padding:"20px 0 8px", fontSize:11, color:"#c4bfbb" }}>
          {isToday?"GymTracker — atualiza automaticamente a cada 30s":`GymTracker — histórico de ${fmtDateLabel(selectedDate)}`}
        </div>
      </main>
    </div>
  );
}
