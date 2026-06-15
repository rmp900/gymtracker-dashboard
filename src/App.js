import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const API_BASE = "https://gymtracker-api-production-bc16.up.railway.app";

const DEVICE_NAMES = {
  device_001: "Leg Press",
  device_002: "Pulley",
  device_003: "Peck Deck",
};

const DEVICES_TESTE = new Set(["device_004"]);
const DURACAO_MAX_S  = 3600; // sessões > 1h são anomalia
const O      = "#ea580c";
const OL     = "#fff7ed";
const OD     = "#9a3412";
const BG     = "#f5f4f0";
const WHITE  = "#ffffff";
const DARK   = "#1c1917";
const MID    = "#78716c";
const BORDER = "#e7e5e4";

// ── Data helpers ─────────────────────────────────────────────────────────────

function toYMD(date) { return date.toLocaleDateString("sv-SE"); }

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isToday(date) { return toYMD(date) === toYMD(new Date()); }

// ── Session helpers ───────────────────────────────────────────────────────────

function parseSession(s) {
  const deviceId = s.device_id || s.deviceId || s.device || "";
  const start    = s.inicio || s.start_time || s.started_at || s.created_at;
  const end      = s.fim || s.end_time || s.ended_at;
  let duracao    = s.duracao_segundos || s.duracao || s.duration;
  if (!duracao && start && end)
    duracao = Math.round((new Date(end) - new Date(start)) / 1000);
  return {
    id:         s.id,
    deviceId,
    deviceName: DEVICE_NAMES[deviceId] || deviceId || "Aparelho",
    start:      start ? new Date(start + (start.includes("+") || start.endsWith("Z") ? "" : "-03:00")) : null,
    end:        end   ? new Date(end   + (end.includes("+")   || end.endsWith("Z")   ? "" : "-03:00")) : null,
    duracao:    duracao ? Math.round(Number(duracao)) : null,
  };
}

// Remove duplicatas: mesmo device + mesmo início (tolerância 2s) + mesma duração
function deduplicar(sessions) {
  const seen = new Map();
  const result = [];
  for (const s of sessions) {
    if (!s.start || !s.deviceId) { result.push(s); continue; }
    const bucket = Math.floor(s.start.getTime() / 2000); // janela 2s
    const key = `${s.deviceId}|${bucket}|${s.duracao}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(s);
    }
  }
  return result;
}

// Separa normais de anômalas (duração > 1h)
function particionarSessoes(sessions) {
  const normais   = sessions.filter(s => !s.duracao || s.duracao <= DURACAO_MAX_S);
  const anomalas  = sessions.filter(s => s.duracao  && s.duracao > DURACAO_MAX_S);
  return { normais, anomalas };
}

function computeStats(sessions) {
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hora: `${String(h).padStart(2, "0")}h`,
    sessoes: 0,
  }));
  sessions.forEach(s => { if (s.start) byHour[s.start.getHours()].sessoes++; });

  const peakSlot = byHour.reduce((mx, c) => c.sessoes > mx.sessoes ? c : mx, byHour[0]);
  const withDur  = sessions.filter(s => s.duracao && s.duracao > 0);
  const avgDur   = withDur.length
    ? Math.round(withDur.reduce((a, s) => a + s.duracao, 0) / withDur.length)
    : 0;

  const deviceMap = {};
  sessions.forEach(s => { deviceMap[s.deviceName] = (deviceMap[s.deviceName] || 0) + 1; });
  const ranking = Object.entries(deviceMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    sessoesHoje: sessions.length,
    totalDevices: Object.keys(DEVICE_NAMES).length,
    horarioPico: peakSlot.sessoes > 0 ? peakSlot.hora : "—",
    duracaoMedia: avgDur,
    byHour,
    ranking,
    maxRank: ranking[0]?.count || 1,
    ultimas: [...sessions].reverse().slice(0, 10),
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtDur(s) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  if (m < 1)  return `${s}s`;
  if (m < 60) return `${m}min ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

function fmtHora(d) {
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDataHora(d) {
  if (!d) return "—";
  if (d.toDateString() === new Date().toDateString()) return `Hoje ${fmtHora(d)}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${fmtHora(d)}`;
}

function fmtDatePtBR(date) {
  if (isToday(date)) return "Hoje";
  return date.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BatIcon({ pct }) {
  if (pct === null || pct === undefined) return null;
  const cor   = pct > 50 ? "#16a34a" : pct > 20 ? "#d97706" : "#dc2626";
  const emoji = pct > 50 ? "🔋" : pct > 20 ? "🪫" : "⚠️";
  return (
    <span title={`Bateria: ${pct}%`}
          style={{ fontSize: 11, color: cor, marginLeft: 6, fontWeight: 600, whiteSpace: "nowrap" }}>
      {emoji} {pct}%
    </span>
  );
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: DARK, color: WHITE, padding: "6px 12px",
      borderRadius: 6, fontSize: 13, fontFamily: "'Barlow', sans-serif",
    }}>
      <strong style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15 }}>
        {payload[0].value}
      </strong>{" sessões"}
    </div>
  );
};

function StatCard({ label, value, sub, alert }) {
  return (
    <div style={{
      background: alert ? "#fff1f2" : WHITE, borderRadius: 12, padding: "20px 22px",
      border: `1px solid ${alert ? "#fca5a5" : BORDER}`,
      flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: alert ? "#dc2626" : O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 42, fontWeight: 700, color: DARK, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: MID, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function DateSelector({ selectedDate, onChange }) {
  const canGoForward = !isToday(selectedDate);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: WHITE, border: `1px solid ${BORDER}`,
      borderRadius: 10, padding: "6px 12px",
    }}>
      <button
        onClick={() => onChange(addDays(selectedDate, -1))}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: DARK, padding: "0 4px", lineHeight: 1 }}
      >‹</button>
      <input
        type="date"
        value={toYMD(selectedDate)}
        max={toYMD(new Date())}
        onChange={e => {
          const d = new Date(e.target.value + "T12:00:00");
          if (!isNaN(d)) onChange(d);
        }}
        style={{
          border: "none", background: "transparent", fontSize: 13,
          fontWeight: 600, color: DARK, cursor: "pointer",
          fontFamily: "'Barlow', sans-serif", outline: "none",
        }}
      />
      <button
        onClick={() => canGoForward && onChange(addDays(selectedDate, 1))}
        style={{
          background: "none", border: "none", cursor: canGoForward ? "pointer" : "default",
          fontSize: 16, color: canGoForward ? DARK : BORDER, padding: "0 4px", lineHeight: 1,
        }}
      >›</button>
      {!isToday(selectedDate) && (
        <button
          onClick={() => onChange(new Date())}
          style={{
            background: O, border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 600, color: WHITE,
            borderRadius: 6, padding: "3px 8px", fontFamily: "'Barlow', sans-serif",
          }}
        >Hoje</button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GymTracker() {
  const [sessions,           setSessions]           = useState([]);
  const [anomalas,           setAnomalas]           = useState([]);
  const [dupCount,           setDupCount]           = useState(0);
  const [loading,            setLoading]            = useState(true);
  const [_error,             setError]              = useState(null); // eslint-disable-line no-unused-vars
  const [lastUpdate,         setLastUpdate]         = useState(null);
  const [corsError,          setCorsError]          = useState(false);
  const [dispositivosStatus, setDispositivosStatus] = useState({});
  const [selectedDate,       setSelectedDate]       = useState(new Date());
  const [showAnomalas,       setShowAnomalas]       = useState(false);

  const fetchData = useCallback(async (date) => {
    try {
      const ymd = toYMD(date || selectedDate);
      const res = await fetch(`${API_BASE}/sessoes/dia?data=${ymd}`, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw = Array.isArray(data) ? data : data.sessoes || data.data || [];
      const parsed = raw.map(parseSession).filter(s => !DEVICES_TESTE.has(s.deviceId));

      const semDup = deduplicar(parsed);
      setDupCount(parsed.length - semDup.length);

      const { normais, anomalas: anom } = particionarSessoes(semDup);
      setSessions(normais);
      setAnomalas(anom);

      setError(null);
      setCorsError(false);
      setLastUpdate(new Date());
    } catch (e) {
      if (e.message.includes("Failed to fetch") || e.message.includes("CORS"))
        setCorsError(true);
      else
        setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const fetchDiagnostico = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/dispositivos/status`);
      if (!res.ok) return;
      const data = await res.json();
      const idx = {};
      data.forEach(d => { idx[d.device_id] = d; });
      setDispositivosStatus(idx);
    } catch (_) {}
  }, []);

  useEffect(() => {
    setLoading(true);
    setSessions([]);
    setAnomalas([]);
    setDupCount(0);
    fetchData(selectedDate);
  }, [selectedDate]); // eslint-disable-line

  useEffect(() => {
    if (!isToday(selectedDate)) return;
    const t = setInterval(() => fetchData(selectedDate), 30000);
    return () => clearInterval(t);
  }, [selectedDate, fetchData]);

  useEffect(() => {
    fetchDiagnostico();
    const t = setInterval(fetchDiagnostico, 60000);
    return () => clearInterval(t);
  }, [fetchDiagnostico]);

  const stats     = computeStats(sessions);
  const maxBar    = Math.max(...stats.byHour.map(h => h.sessoes), 1);
  const temAlertas = dupCount > 0 || anomalas.length > 0;

  return (
    <div style={{ fontFamily: "'Barlow', sans-serif", background: BG, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${BG}; }
        .gt-row { display: flex; gap: 16px; flex-wrap: wrap; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        .fade-up { animation: fadeUp 0.35s ease both; }
        tr:hover td { background: #fafaf8 !important; }
        .gt-subheader { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 28px; background: ${OD}; flex-wrap: wrap; }
        @media (max-width: 600px) { .gt-subheader { padding: 6px 16px; } }
        input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0.5; cursor: pointer; }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        background: O,
        backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 20px, rgba(0,0,0,0.04) 20px, rgba(0,0,0,0.04) 22px)",
        padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 56,
      }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 800, color: WHITE, letterSpacing: "0.03em" }}>
          GYMTRACKER
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/diagnostico.html" style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 600, color: WHITE, textDecoration: "none",
            background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: 8, padding: "5px 12px", whiteSpace: "nowrap",
          }}>
            🔧 Diagnóstico
          </a>
          <a href="/status.html" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.18)", borderRadius: 20, padding: "4px 12px", whiteSpace: "nowrap",
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: WHITE }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: WHITE }}>AO VIVO</span>
            </div>
          </a>
        </div>
      </header>

      {/* ── Sub-header ── */}
      <div className="gt-subheader">
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 500, textTransform: "capitalize" }}>
          {isToday(selectedDate) ? `Hoje — ${selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}` : selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        {lastUpdate && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
            Atualizado {fmtHora(lastUpdate)}
          </span>
        )}
      </div>

      <main style={{ padding: "24px 28px", maxWidth: 1200, margin: "0 auto" }}>

        {corsError && (
          <div className="fade-up" style={{
            background: "#fff7ed", border: `1px solid #fdba74`, borderRadius: 10,
            padding: "16px 20px", marginBottom: 24, color: OD, fontSize: 13,
          }}>
            <strong>⚠️ Erro de CORS</strong> — O navegador bloqueou a requisição à API.
          </div>
        )}

        {/* ── Alerta de anomalias de firmware ── */}
        {temAlertas && !loading && (
          <div className="fade-up" style={{
            background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 10,
            padding: "14px 18px", marginBottom: 20, fontSize: 13, color: "#92400e",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠️ Anomalias de firmware detectadas neste dia</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {dupCount > 0 && (
                <span>• <strong>{dupCount} sessão{dupCount > 1 ? "ões" : ""} duplicada{dupCount > 1 ? "s" : ""}</strong> removida{dupCount > 1 ? "s" : ""} (buffer reenviado)</span>
              )}
              {anomalas.length > 0 && (
                <span>• <strong>{anomalas.length} sessão{anomalas.length > 1 ? "ões" : ""} anômala{anomalas.length > 1 ? "s" : ""}</strong> excluída{anomalas.length > 1 ? "s" : ""} (duração {anomalas.length === 1 ? fmtDur(anomalas[0].duracao) : "> 1h"})</span>
              )}
            </div>
            {anomalas.length > 0 && (
              <button
                onClick={() => setShowAnomalas(v => !v)}
                style={{
                  marginTop: 8, background: "none", border: "1px solid #d97706",
                  borderRadius: 6, padding: "3px 10px", fontSize: 11,
                  color: "#92400e", cursor: "pointer", fontFamily: "'Barlow', sans-serif",
                }}
              >
                {showAnomalas ? "Ocultar" : "Ver"} sessões anômalas
              </button>
            )}
            {showAnomalas && anomalas.length > 0 && (
              <div style={{ marginTop: 10, background: "rgba(0,0,0,0.05)", borderRadius: 6, padding: "8px 12px" }}>
                {anomalas.map(s => (
                  <div key={s.id} style={{ fontSize: 12, color: "#78350f", marginBottom: 3 }}>
                    ID {s.id} · {s.deviceName} · {fmtDataHora(s.start)} → {fmtDur(s.duracao)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Seletor de data ── */}
        <div className="fade-up" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <DateSelector selectedDate={selectedDate} onChange={d => { setSelectedDate(d); }} />
          <span style={{ fontSize: 13, color: MID }}>
            {loading
              ? "Carregando..."
              : sessions.length === 0
              ? "Nenhuma sessão neste dia"
              : `${sessions.length} sessão${sessions.length > 1 ? "ões" : ""} válida${sessions.length > 1 ? "s" : ""}`
            }
          </span>
        </div>

        {/* ── Stats ── */}
        <div className="gt-row fade-up" style={{ marginBottom: 20 }}>
          <StatCard label="Aparelhos" value={stats.totalDevices} sub="monitorados" />
          <StatCard
            label={isToday(selectedDate) ? "Sessões hoje" : "Sessões no dia"}
            value={loading ? "—" : stats.sessoesHoje}
            sub={fmtDatePtBR(selectedDate)}
          />
          <StatCard label="Horário de pico" value={stats.horarioPico} sub="mais movimentado" />
          <StatCard
            label="Duração média"
            value={stats.duracaoMedia ? fmtDur(stats.duracaoMedia) : "—"}
            sub="por sessão (sem anomalias)"
          />
        </div>

        {/* ── Charts ── */}
        <div className="gt-row fade-up" style={{ marginBottom: 20, animationDelay: "0.08s" }}>

          <div style={{
            background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
            padding: "22px 22px 16px", flex: "2 1 380px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Uso por horário
                </div>
                <div style={{ fontSize: 13, color: MID, marginTop: 2 }}>
                  Sessões válidas — {fmtDatePtBR(selectedDate)}
                </div>
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700, color: DARK }}>
                {stats.sessoesHoje}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.byHour} barSize={14} margin={{ top: 0, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="hora"
                  tick={{ fontFamily: "'Barlow', sans-serif", fontSize: 11, fill: MID }}
                  axisLine={false} tickLine={false} interval={2} />
                <YAxis allowDecimals={false}
                  tick={{ fontFamily: "'Barlow', sans-serif", fontSize: 11, fill: MID }}
                  axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: OL }} />
                <Bar dataKey="sessoes" radius={[4, 4, 0, 0]}>
                  {stats.byHour.map((entry, i) => (
                    <Cell key={i} fill={entry.sessoes === maxBar && entry.sessoes > 0 ? O : "#fcd9b6"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{
            background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
            padding: "22px", flex: "1 1 220px",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Ranking
            </div>
            <div style={{ fontSize: 13, color: MID, marginBottom: 20 }}>
              Aparelhos mais usados — {fmtDatePtBR(selectedDate)}
            </div>

            {stats.ranking.length === 0 ? (
              <div style={{ color: MID, fontSize: 13, textAlign: "center", paddingTop: 40 }}>
                {loading ? "Carregando..." : "Sem sessões neste dia"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {stats.ranking.map((item, i) => {
                  const devId  = Object.keys(DEVICE_NAMES).find(k => DEVICE_NAMES[k] === item.name);
                  const batPct = devId ? dispositivosStatus[devId]?.bat_pct : undefined;
                  return (
                    <div key={item.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 22, height: 22, borderRadius: 4,
                            background: i === 0 ? O : OL,
                            color: i === 0 ? WHITE : OD,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700,
                          }}>
                            {i + 1}
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 500, color: DARK }}>{item.name}</span>
                          <BatIcon pct={batPct} />
                        </div>
                        <span style={{
                          fontFamily: "'Barlow Condensed', sans-serif",
                          fontSize: 18, fontWeight: 700, color: i === 0 ? O : DARK,
                        }}>
                          {item.count}
                        </span>
                      </div>
                      <div style={{ background: OL, borderRadius: 20, height: 8, overflow: "hidden" }}>
                        <div style={{
                          width: `${Math.round((item.count / stats.maxRank) * 100)}%`,
                          height: "100%",
                          background: i === 0 ? O : "#fdba74",
                          borderRadius: 20,
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Tabela ── */}
        <div className="fade-up" style={{
          background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
          overflow: "hidden", animationDelay: "0.16s",
        }}>
          <div style={{
            padding: "18px 22px 14px", borderBottom: `1px solid ${BORDER}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: O, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Últimas Sessões — {fmtDatePtBR(selectedDate)}
              </div>
              <div style={{ fontSize: 13, color: MID, marginTop: 2 }}>
                {sessions.length} válidas
                {dupCount > 0 ? ` · ${dupCount} duplicata${dupCount > 1 ? "s" : ""} removida${dupCount > 1 ? "s" : ""}` : ""}
                {anomalas.length > 0 ? ` · ${anomalas.length} anômala${anomalas.length > 1 ? "s" : ""} excluída${anomalas.length > 1 ? "s" : ""}` : ""}
                {" · exibindo as 10 mais recentes"}
              </div>
            </div>
            <button
              onClick={() => fetchData(selectedDate)}
              style={{
                background: "transparent", border: `1px solid ${BORDER}`,
                borderRadius: 8, padding: "5px 14px", fontSize: 12,
                fontWeight: 500, color: MID, cursor: "pointer", fontFamily: "'Barlow', sans-serif",
              }}
            >
              ↺ Atualizar
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: MID, fontSize: 14 }}>Carregando sessões...</div>
          ) : stats.ultimas.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: MID, fontSize: 14 }}>
              Nenhuma sessão válida registrada neste dia.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafaf8" }}>
                  {["Aparelho", "Início", "Fim", "Duração", "Device ID"].map(h => (
                    <th key={h} style={{
                      padding: "10px 22px", textAlign: "left",
                      fontSize: 11, fontWeight: 600, color: MID,
                      textTransform: "uppercase", letterSpacing: "0.07em",
                      borderBottom: `1px solid ${BORDER}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.ultimas.map((s, i) => {
                  const batPct = dispositivosStatus[s.deviceId]?.bat_pct;
                  return (
                    <tr key={s.id || i}>
                      <td style={{ padding: "12px 22px", borderBottom: `1px solid ${BORDER}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: O, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 500, color: DARK }}>{s.deviceName}</span>
                          <BatIcon pct={batPct} />
                        </div>
                      </td>
                      <td style={{ padding: "12px 22px", fontSize: 13, color: DARK, borderBottom: `1px solid ${BORDER}` }}>
                        {fmtDataHora(s.start)}
                      </td>
                      <td style={{ padding: "12px 22px", fontSize: 13, color: MID, borderBottom: `1px solid ${BORDER}` }}>
                        {s.end ? fmtDataHora(s.end) : <span style={{ color: O, fontWeight: 500 }}>Em uso</span>}
                      </td>
                      <td style={{ padding: "12px 22px", borderBottom: `1px solid ${BORDER}` }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 15, fontWeight: 600, color: s.duracao ? DARK : O }}>
                          {fmtDur(s.duracao)}
                        </span>
                      </td>
                      <td style={{ padding: "12px 22px", fontSize: 12, color: MID, fontFamily: "monospace", borderBottom: `1px solid ${BORDER}` }}>
                        {s.deviceId || "—"}
                      </td>
                    </tr>
                  );
                })}
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
