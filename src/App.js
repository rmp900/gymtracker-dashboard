import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

const API_BASE = "https://gymtracker-api-production-bc16.up.railway.app";

const DEVICE_NAMES  = { device_001: "Leg Press",  device_002: "Pulley Remada", device_003: "Supino Máquina", device_004: "Esteira B",  device_005: "Pulley Alto", device_007: "Cadeira Extensora" };
const DEVICE_COLORS = { device_001: "#5DCAA5",     device_002: "#378ADD",      device_003: "#D85A30",       device_004: "#9B6DD8",   device_005: "#2563C9",    device_007: "#3DA882" };

// Devices excluídos do dashboard — apenas aparecem no diagnóstico
const DEVICES_TESTE = new Set(["device_006", "device_008"]);

const DURACAO_MAX_S = 3600; // padrão 1h
const DURACAO_MAX_POR_DEVICE = { device_004: 14400 }; // esteira: até 4h é normal
const O = "#ea580c", OL = "#fff7ed", OD = "#9a3412", BG = "#f5f4f0";
const WHITE = "#ffffff", DARK = "#1c1917", MID = "#78716c", BORDER = "#e7e5e4";

function toYMD(d) { return d.toLocaleDateString("sv-SE"); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isToday(d) { return toYMD(d) === toYMD(new Date()); }

function parseSession(s) {
  const deviceId = s.device_id || s.deviceId || s.device || "";
  const start = s.inicio || s.start_time || s.started_at || s.created_at;
  const end   = s.fim   || s.end_time   || s.ended_at;
  // duracao pode ser 0 (heartbeat) — não usar || aqui, senão 0 vira "ausente"
  let dur = [s.duracao_segundos, s.duracao, s.duration].find(v => v !== null && v !== undefined);
  if (dur === undefined && start && end) dur = Math.round((new Date(end) - new Date(start)) / 1000);
  const tz = (str) => str && (str.includes("+") || str.endsWith("Z")) ? "" : "-03:00";
  return {
    id: s.id, deviceId,
    deviceName: DEVICE_NAMES[deviceId] || deviceId || "Aparelho",
    start: start ? new Date(start + tz(start)) : null,
    end:   end   ? new Date(end   + tz(end))   : null,
    duracao: dur !== undefined && dur !== null ? Math.round(Number(dur)) : null,
  };
}

function deduplicar(arr) {
  const seen = new Map();
  return arr.filter(s => {
    if (!s.start || !s.deviceId) return true;
    const k = `${s.deviceId}|${Math.floor(s.start.getTime() / 2000)}|${s.duracao}`;
    if (seen.has(k)) return false;
    seen.set(k, true);
    return true;
  });
}

function limpar(raw) {
  // heartbeats (duracao === 0) nunca entram em nenhuma contagem do dashboard — só no diagnóstico
  const parsed = raw.map(parseSession).filter(s => !DEVICES_TESTE.has(s.deviceId) && s.duracao !== 0);
  const dedup = deduplicar(parsed);
  return {
    normais:  dedup.filter(s => !s.duracao || s.duracao <= (DURACAO_MAX_POR_DEVICE[s.deviceId] || DURACAO_MAX_S)),
    anomalas: dedup.filter(s => s.duracao  &&  s.duracao >  (DURACAO_MAX_POR_DEVICE[s.deviceId] || DURACAO_MAX_S)),
    dupCount: parsed.length - dedup.length,
  };
}

function calcDonut(sessions) {
  const map = {};
  sessions.forEach(s => { map[s.deviceId] = (map[s.deviceId] || 0) + 1; });
  return Object.entries(map).map(([id, value]) => ({
    id, value, name: DEVICE_NAMES[id] || id, color: DEVICE_COLORS[id] || "#ccc",
  }));
}

function computeStats(sessions) {
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hora: `${String(h).padStart(2,"0")}h`, sessoes: 0 }));
  sessions.forEach(s => { if (s.start) byHour[s.start.getHours()].sessoes++; });
  const peak = byHour.reduce((mx, c) => c.sessoes > mx.sessoes ? c : mx, byHour[0]);
  const withDur = sessions.filter(s => s.duracao && s.duracao > 0);
  const avgDur = withDur.length ? Math.round(withDur.reduce((a, s) => a + s.duracao, 0) / withDur.length) : 0;
  const deviceMap = {};
  sessions.forEach(s => { deviceMap[s.deviceName] = (deviceMap[s.deviceName] || 0) + 1; });
  const ranking = Object.entries(deviceMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { total: sessions.length, horarioPico: peak.sessoes > 0 ? peak.hora : "—", duracaoMedia: avgDur, byHour, ranking, maxRank: ranking[0]?.count || 1, ultimas: [...sessions].reverse().slice(0, 10) };
}

function fmtDur(s) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}min ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}
function fmtHora(d) { return d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function fmtDataHora(d) {
  if (!d) return "—";
  if (d.toDateString() === new Date().toDateString()) return `Hoje ${fmtHora(d)}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${fmtHora(d)}`;
}
function fmtDateLabel(date) {
  if (isToday(date)) return "Hoje";
  return date.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
}

// ── Componentes ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: WHITE, borderRadius: 12, padding: "20px 22px", border: `1px solid ${BORDER}`, flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 42, fontWeight: 700, color: DARK, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MID, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function BatIcon({ pct }) {
  if (pct === null || pct === undefined) return null;
  const cor = pct > 50 ? "#16a34a" : pct > 20 ? "#d97706" : "#dc2626";
  const emoji = pct > 50 ? "🔋" : pct > 20 ? "🪫" : "⚠️";
  return <span title={`Bateria: ${pct}%`} style={{ fontSize: 11, color: cor, marginLeft: 6, fontWeight: 600 }}>{emoji} {pct}%</span>;
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: DARK, color: WHITE, padding: "6px 12px", borderRadius: 6, fontSize: 13 }}>
      <strong style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15 }}>{payload[0].value}</strong> sessões
    </div>
  );
}

function DonutCard({ title, data, total }) {
  const isEmpty = !data || data.length === 0 || total === 0;
  const chartData = isEmpty ? [{ name: "vazio", value: 1, color: "#e7e5e4" }] : data;
  return (
    <div style={{ background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "20px 16px", flex: "1 1 200px", textAlign: "center" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: O, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 12 }}>{title}</div>
      <div style={{ position: "relative", display: "inline-block" }}>
        <PieChart width={140} height={140}>
          <Pie data={chartData} cx={65} cy={65} innerRadius={44} outerRadius={62} dataKey="value" strokeWidth={0}>
            {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Pie>
        </PieChart>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", lineHeight: 1.2 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26, fontWeight: 700, color: isEmpty ? MID : DARK }}>{isEmpty ? 0 : total}</div>
          <div style={{ fontSize: 10, color: MID }}>sessões</div>
        </div>
      </div>
      {isEmpty ? (
        <div style={{ fontSize: 12, color: MID, marginTop: 8 }}>Sem dados</div>
      ) : (
        <div style={{ marginTop: 12, textAlign: "left", display: "flex", flexDirection: "column", gap: 5 }}>
          {data.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                <span style={{ color: MID }}>{d.name}</span>
              </div>
              <span style={{ fontWeight: 600, color: DARK }}>{Math.round((d.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DateSelector({ selectedDate, onChange }) {
  const canFwd = !isToday(selectedDate);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "6px 12px" }}>
      <button onClick={() => onChange(addDays(selectedDate, -1))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: DARK, padding: "0 4px" }}>‹</button>
      <input type="date" value={toYMD(selectedDate)} max={toYMD(new Date())}
        onChange={e => { const d = new Date(e.target.value + "T12:00:00"); if (!isNaN(d)) onChange(d); }}
        style={{ border: "none", background: "transparent", fontSize: 13, fontWeight: 600, color: DARK, cursor: "pointer", fontFamily: "'Barlow',sans-serif", outline: "none" }} />
      <button onClick={() => canFwd && onChange(addDays(selectedDate, 1))} style={{ background: "none", border: "none", cursor: canFwd ? "pointer" : "default", fontSize: 16, color: canFwd ? DARK : BORDER, padding: "0 4px" }}>›</button>
      {!isToday(selectedDate) && (
        <button onClick={() => onChange(new Date())} style={{ background: O, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: WHITE, borderRadius: 6, padding: "3px 8px", fontFamily: "'Barlow',sans-serif" }}>Hoje</button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GymTracker() {
  const [sessions,     setSessions]     = useState([]);
  const [anomalas,     setAnomalas]     = useState([]);
  const [dupCount,     setDupCount]     = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [lastUpdate,   setLastUpdate]   = useState(null);
  const [devStatus,    setDevStatus]    = useState({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAnomalas, setShowAnomalas] = useState(false);
  const [dados7,       setDados7]       = useState([]);
  const [total7,       setTotal7]       = useState(0);
  const [dados30,      setDados30]      = useState([]);
  const [total30,      setTotal30]      = useState(0);

  const fetchDia = useCallback(async (date) => {
    try {
      const res = await fetch(`${API_BASE}/sessoes/dia?data=${toYMD(date)}`, { mode: "cors" });
      if (!res.ok) return;
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : raw.sessoes || [];
      const { normais, anomalas: anom, dupCount: dup } = limpar(arr);
      setSessions(normais);
      setAnomalas(anom);
      setDupCount(dup);
      setLastUpdate(new Date());
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPeriodo = useCallback(async (dias, setDados, setTotal) => {
    try {
      const fim    = new Date();
      const inicio = addDays(fim, -dias);
      const res = await fetch(`${API_BASE}/sessoes/periodo?inicio=${toYMD(inicio)}&fim=${toYMD(fim)}`);
      if (!res.ok) return;
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : raw.sessoes || [];
      const { normais } = limpar(arr);
      setDados(calcDonut(normais));
      setTotal(normais.length);
    } catch (_) {}
  }, []);

  const fetchDiag = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/dispositivos/status`);
      if (!res.ok) return;
      const data = await res.json();
      const idx  = {};
      data.forEach(d => { idx[d.device_id] = d; });
      setDevStatus(idx);
    } catch (_) {}
  }, []);

  useEffect(() => {
    setLoading(true);
    setSessions([]);
    setAnomalas([]);
    setDupCount(0);
    fetchDia(selectedDate);
  }, [selectedDate, fetchDia]);

  useEffect(() => {
    if (!isToday(selectedDate)) return;
    const t = setInterval(() => fetchDia(selectedDate), 30000);
    return () => clearInterval(t);
  }, [selectedDate, fetchDia]);

  useEffect(() => {
    fetchDiag();
    fetchPeriodo(7,  setDados7,  setTotal7);
    fetchPeriodo(30, setDados30, setTotal30);
    const t = setInterval(fetchDiag, 60000);
    return () => clearInterval(t);
  }, [fetchDiag, fetchPeriodo]);

  const stats    = computeStats(sessions);
  const maxBar   = Math.max(...stats.byHour.map(h => h.sessoes), 1);
  const temAlert = anomalas.length > 0 || dupCount > 0;

  return (
    <div style={{ fontFamily: "'Barlow',sans-serif", background: BG, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .gt-row{display:flex;gap:16px;flex-wrap:wrap}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp .35s ease both}
        tr:hover td{background:#fafaf8!important}
        input[type="date"]::-webkit-calendar-picker-indicator{opacity:.5;cursor:pointer}
      `}</style>

      <header style={{ background: O, backgroundImage: "repeating-linear-gradient(135deg,transparent,transparent 20px,rgba(0,0,0,.04) 20px,rgba(0,0,0,.04) 22px)", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 800, color: WHITE, letterSpacing: "0.03em" }}>GYMTRACKER</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/diagnostico.html" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: WHITE, textDecoration: "none", background: "rgba(0,0,0,.20)", border: "1px solid rgba(255,255,255,.35)", borderRadius: 8, padding: "5px 12px" }}>🔧 Diagnóstico</a>
          <a href="/instalacao.html" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: WHITE, textDecoration: "none", background: "rgba(0,0,0,.20)", border: "1px solid rgba(255,255,255,.35)", borderRadius: 8, padding: "5px 12px" }}>🛠️ Instalação</a>
          <a href="/status.html" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", borderRadius: 20, padding: "4px 12px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: WHITE }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: WHITE }}>AO VIVO</span>
            </div>
          </a>
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 28px", background: OD, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,.8)", fontWeight: 500, textTransform: "capitalize" }}>
          {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </span>
        {lastUpdate && <span style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>Atualizado {fmtHora(lastUpdate)}</span>}
      </div>

      <main style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>

        <div className="fade-up" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <DateSelector selectedDate={selectedDate} onChange={d => setSelectedDate(d)} />
          <span style={{ fontSize: 13, color: MID }}>
            {loading ? "Carregando..." : sessions.length === 0 ? "Nenhuma sessão neste dia" : `${sessions.length} sessões válidas`}
          </span>
          {temAlert && !loading && (
            <button onClick={() => setShowAnomalas(v => !v)} style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#92400e", cursor: "pointer", fontFamily: "'Barlow',sans-serif", fontWeight: 600 }}>
              ⚠️ {dupCount > 0 ? `${dupCount} dup` : ""}{dupCount > 0 && anomalas.length > 0 ? " · " : ""}{anomalas.length > 0 ? `${anomalas.length} anomalia${anomalas.length > 1 ? "s" : ""}` : ""} — ver detalhes
            </button>
          )}
        </div>

        {showAnomalas && temAlert && (
          <div className="fade-up" style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#92400e" }}>
            {dupCount > 0 && <div style={{ marginBottom: 4 }}>• <strong>{dupCount} sessões duplicadas</strong> removidas (buffer reenviado pelo firmware)</div>}
            {anomalas.map(s => (
              <div key={s.id}>• ID {s.id} · {s.deviceName} · {fmtDataHora(s.start)} · duração: {fmtDur(s.duracao)} — sessão fantasma excluída</div>
            ))}
            <div style={{ marginTop: 6, color: "#78350f" }}>Dados excluídos das métricas. Para detalhes, acesse <a href="/diagnostico.html" style={{ color: OD }}>Diagnóstico</a>.</div>
          </div>
        )}

        <div className="gt-row fade-up" style={{ marginBottom: 20 }}>
          <StatCard label="Aparelhos" value={Object.keys(DEVICE_NAMES).length} sub="monitorados" />
          <StatCard label={isToday(selectedDate) ? "Sessões hoje" : "Sessões no dia"} value={loading ? "—" : stats.total} sub={fmtDateLabel(selectedDate)} />
          <StatCard label="Horário de pico" value={stats.horarioPico} sub="mais movimentado" />
          <StatCard label="Duração média" value={stats.duracaoMedia ? fmtDur(stats.duracaoMedia) : "—"} sub="por sessão" />
        </div>

        <div className="gt-row fade-up" style={{ marginBottom: 20, animationDelay: ".08s" }}>
          <div style={{ background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "22px 22px 16px", flex: "2 1 380px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em" }}>Uso por horário</div>
                <div style={{ fontSize: 13, color: MID, marginTop: 2 }}>Sessões válidas — {fmtDateLabel(selectedDate)}</div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, fontWeight: 700, color: DARK }}>{stats.total}</div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.byHour} barSize={14} margin={{ top: 0, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="hora" tick={{ fontFamily: "'Barlow',sans-serif", fontSize: 11, fill: MID }} axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontFamily: "'Barlow',sans-serif", fontSize: 11, fill: MID }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: OL }} />
                <Bar dataKey="sessoes" radius={[4, 4, 0, 0]}>
                  {stats.byHour.map((entry, i) => <Cell key={i} fill={entry.sessoes === maxBar && entry.sessoes > 0 ? O : "#fcd9b6"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "22px", flex: "1 1 220px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Ranking</div>
            <div style={{ fontSize: 13, color: MID, marginBottom: 20 }}>Aparelhos mais usados — {fmtDateLabel(selectedDate)}</div>
            {stats.ranking.length === 0 ? (
              <div style={{ color: MID, fontSize: 13, textAlign: "center", paddingTop: 40 }}>{loading ? "Carregando..." : "Sem sessões neste dia"}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {stats.ranking.map((item, i) => {
                  const devId = Object.keys(DEVICE_NAMES).find(k => DEVICE_NAMES[k] === item.name);
                  const batPct = devId ? devStatus[devId]?.bat_pct : undefined;
                  return (
                    <div key={item.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 22, height: 22, borderRadius: 4, background: i === 0 ? O : OL, color: i === 0 ? WHITE : OD, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 12, fontWeight: 700 }}>{i + 1}</div>
                          <span style={{ fontSize: 14, fontWeight: 500, color: DARK }}>{item.name}</span>
                          <BatIcon pct={batPct} />
                        </div>
                        <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 700, color: i === 0 ? O : DARK }}>{item.count}</span>
                      </div>
                      <div style={{ background: OL, borderRadius: 20, height: 8, overflow: "hidden" }}>
                        <div style={{ width: `${Math.round((item.count / stats.maxRank) * 100)}%`, height: "100%", background: i === 0 ? O : "#fdba74", borderRadius: 20 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="gt-row fade-up" style={{ marginBottom: 20, animationDelay: ".16s" }}>
          <DonutCard title={isToday(selectedDate) ? "Hoje" : fmtDateLabel(selectedDate)} data={calcDonut(sessions)} total={sessions.length} />
          <DonutCard title="Últimos 7 dias" data={dados7} total={total7} />
          <DonutCard title="Últimos 30 dias" data={dados30} total={total30} />
        </div>

        <div className="fade-up" style={{ background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: "hidden", animationDelay: ".24s" }}>
          <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em" }}>Últimas Sessões — {fmtDateLabel(selectedDate)}</div>
              <div style={{ fontSize: 13, color: MID, marginTop: 2 }}>
                {sessions.length} válidas{dupCount > 0 ? ` · ${dupCount} dup. removidas` : ""}{anomalas.length > 0 ? ` · ${anomalas.length} anomalias excluídas` : ""} · exibindo as 10 mais recentes
              </div>
            </div>
            <button onClick={() => fetchDia(selectedDate)} style={{ background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 14px", fontSize: 12, fontWeight: 500, color: MID, cursor: "pointer", fontFamily: "'Barlow',sans-serif" }}>↺ Atualizar</button>
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: MID }}>Carregando...</div>
          ) : stats.ultimas.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: MID }}>Nenhuma sessão registrada neste dia.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafaf8" }}>
                  {["Aparelho", "Início", "Fim", "Duração", "Device ID"].map(h => (
                    <th key={h} style={{ padding: "10px 22px", textAlign: "left", fontSize: 11, fontWeight: 600, color: MID, textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.ultimas.map((s, i) => (
                  <tr key={s.id || i}>
                    <td style={{ padding: "12px 22px", borderBottom: `1px solid ${BORDER}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: O, flexShrink: 0 }} />
                        <span style={{ fontSize: 14, fontWeight: 500, color: DARK }}>{s.deviceName}</span>
                        <BatIcon pct={devStatus[s.deviceId]?.bat_pct} />
                      </div>
                    </td>
                    <td style={{ padding: "12px 22px", fontSize: 13, color: DARK, borderBottom: `1px solid ${BORDER}` }}>{fmtDataHora(s.start)}</td>
                    <td style={{ padding: "12px 22px", fontSize: 13, color: MID, borderBottom: `1px solid ${BORDER}` }}>
                      {s.end ? fmtDataHora(s.end) : <span style={{ color: O, fontWeight: 500 }}>Em uso</span>}
                    </td>
                    <td style={{ padding: "12px 22px", borderBottom: `1px solid ${BORDER}` }}>
                      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 600, color: DARK }}>{fmtDur(s.duracao)}</span>
                    </td>
                    <td style={{ padding: "12px 22px", fontSize: 12, color: MID, fontFamily: "monospace", borderBottom: `1px solid ${BORDER}` }}>{s.deviceId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ textAlign: "center", padding: "20px 0 8px", fontSize: 11, color: "#c4bfbb" }}>
          GymTracker {isToday(selectedDate) ? "— atualiza automaticamente a cada 30s" : "— dados históricos"}
        </div>
      </main>
    </div>
  );
}
