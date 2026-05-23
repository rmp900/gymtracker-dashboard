import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const API_BASE = "https://gymtracker-api-production-bc16.up.railway.app";
const COLORS = ["#00ff9d", "#00d4ff", "#ff6b35", "#ffd700", "#b44dff"];

function formatDuracao(segundos) {
  if (segundos < 60) return `${segundos}s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function getHora(isoString) {
  if (!isoString) return "?";
  try { return isoString.substring(11, 16); }
  catch { return "?"; }
}

export default function App() {
  const [sessoes, setSessoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function fetchSessoes() {
    try {
      const res = await fetch(`${API_BASE}/sessoes`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessoes(data);
      setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR"));
      setErro(null);
    } catch {
      setErro("Não foi possível conectar à API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSessoes();
    const interval = setInterval(fetchSessoes, 30000);
    return () => clearInterval(interval);
  }, []);

  const hoje = new Date().toISOString().substring(0, 10);
  const sessoesHoje = sessoes.filter(s => s.inicio?.startsWith(hoje));
  const totalHoje = sessoesHoje.length;
  const aparelhosAtivos = [...new Set(sessoes.map(s => s.device_id))].length;
  const duracaoMedia = sessoesHoje.length > 0
    ? Math.round(sessoesHoje.reduce((acc, s) => acc + s.duracao_segundos, 0) / sessoesHoje.length)
    : 0;

  const usoPorHora = Array.from({ length: 24 }, (_, i) => ({
    hora: `${String(i).padStart(2, "0")}h`,
    sessoes: 0
  }));
  sessoesHoje.forEach(s => {
    const hora = parseInt(s.inicio?.substring(11, 13) ?? "0");
    if (!isNaN(hora)) usoPorHora[hora].sessoes += 1;
  });

  const horasPico = [...usoPorHora].sort((a, b) => b.sessoes - a.sessoes);
  const horarioPico = horasPico[0]?.sessoes > 0 ? horasPico[0].hora : "--";

  const rankingMap = {};
  sessoes.forEach(s => { rankingMap[s.device_id] = (rankingMap[s.device_id] || 0) + 1; });
  const ranking = Object.entries(rankingMap)
    .map(([id, total]) => ({ id, total }))
    .sort((a, b) => b.total - a.total);

  const ultimasSessoes = [...sessoes].reverse().slice(0, 10);

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", color: "#e0e0e0", fontFamily: "'Courier New', monospace" }}>
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: isMobile ? "12px 16px" : "16px 32px",
        borderBottom: "1px solid #222", background: "#111",
        position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: isMobile ? 16 : 20, fontWeight: 700, color: "#00ff9d", letterSpacing: 1 }}>⚡ GymTracker</span>
          <span style={{
            background: "#00ff9d", color: "#000", fontSize: 9, fontWeight: 700,
            padding: "2px 6px", borderRadius: 4, letterSpacing: 2
          }}>LIVE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!isMobile && ultimaAtualizacao && (
            <span style={{ fontSize: 11, color: "#555" }}>Atualizado às {ultimaAtualizacao}</span>
          )}
          <button onClick={fetchSessoes} style={{
            background: "transparent", border: "1px solid #333", color: "#aaa",
            padding: isMobile ? "5px 10px" : "6px 14px", borderRadius: 6,
            cursor: "pointer", fontSize: isMobile ? 12 : 13, fontFamily: "'Courier New', monospace"
          }}>↻ Atualizar</button>
        </div>
      </header>

      {erro && (
        <div style={{ background: "#ff3333", color: "#fff", padding: "10px 16px", fontSize: 13, fontWeight: 600 }}>
          {erro}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
          <div style={{
            width: 36, height: 36, border: "3px solid #222",
            borderTop: "3px solid #00ff9d", borderRadius: "50%",
            animation: "spin 0.8s linear infinite"
          }} />
          <p style={{ color: "#555", fontSize: 14 }}>Carregando dados...</p>
        </div>
      ) : (
        <main style={{ padding: isMobile ? "16px" : "24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>

          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: 12
          }}>
            {[
              { label: "Aparelhos", value: aparelhosAtivos, icon: "🏋️", color: "#00ff9d" },
              { label: "Sessões Hoje", value: totalHoje, icon: "📊", color: "#00d4ff" },
              { label: "Pico", value: horarioPico, icon: "🕐", color: "#ffd700" },
              { label: "Duração Média", value: formatDuracao(duracaoMedia), icon: "⏱️", color: "#ff6b35" },
            ].map(card => (
              <div key={card.label} style={{
                background: "#151515", borderRadius: 10,
                padding: isMobile ? "14px" : "20px",
                borderTop: `3px solid ${card.color}`,
                display: "flex", flexDirection: "column", gap: 6
              }}>
                <span style={{ fontSize: isMobile ? 18 : 22 }}>{card.icon}</span>
                <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: card.color }}>{card.value}</div>
                <div style={{ fontSize: isMobile ? 10 : 12, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>{card.label}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#151515", borderRadius: 10, padding: isMobile ? "14px" : "20px 24px" }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, marginTop: 0 }}>
              Uso por Horário — Hoje
            </h2>
            {sessoesHoje.length === 0 ? (
              <p style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "30px 0" }}>Nenhuma sessão registrada hoje.</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 160 : 220}>
                <BarChart data={usoPorHora} margin={{ top: 8, right: 4, left: -28, bottom: 0 }}>
                  <XAxis dataKey="hora" tick={{ fill: "#555", fontSize: isMobile ? 9 : 11 }} interval={isMobile ? 5 : 2} />
                  <YAxis tick={{ fill: "#555", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 6 }}
                    labelStyle={{ color: "#00ff9d", fontWeight: 700 }}
                    itemStyle={{ color: "#e0e0e0" }}
                  />
                  <Bar dataKey="sessoes" radius={[4, 4, 0, 0]}>
                    {usoPorHora.map((entry, i) => (
                      <Cell key={i} fill={entry.sessoes > 0 ? "#00ff9d" : "#2a2a2a"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div style={{ background: "#151515", borderRadius: 10, padding: isMobile ? "14px" : "20px 24px" }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, marginTop: 0 }}>
              Ranking de Aparelhos
            </h2>
            {ranking.length === 0 ? (
              <p style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Sem dados.</p>
            ) : ranking.map((item, i) => (
              <div key={item.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 0", borderBottom: "1px solid #1e1e1e"
              }}>
                <span style={{ fontWeight: 700, fontSize: 16, minWidth: 28, color: COLORS[i % COLORS.length] }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#ccc" }}>{item.id}</span>
                <span style={{ fontSize: 12, color: "#555" }}>{item.total} sessões</span>
              </div>
            ))}
          </div>

          <div style={{ background: "#151515", borderRadius: 10, padding: isMobile ? "14px" : "20px 24px" }}>
            <h2 style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 2, marginBottom: 16, marginTop: 0 }}>
              Últimas Sessões
            </h2>
            {ultimasSessoes.length === 0 ? (
              <p style={{ color: "#444", fontSize: 13, textAlign: "center", padding: "20px 0" }}>Nenhuma sessão registrada.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13 }}>
                  <thead>
                    <tr>
                      {["ID", "Device", "Início", "Fim", "Duração"].map(col => (
                        <th key={col} style={{
                          textAlign: "left", padding: "8px 10px", color: "#555",
                          fontSize: 10, textTransform: "uppercase", letterSpacing: 1,
                          borderBottom: "1px solid #222"
                        }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ultimasSessoes.map((s, i) => (
                      <tr key={s.id} style={{ background: i % 2 === 0 ? "transparent" : "#111" }}>
                        <td style={{ padding: "10px 10px", color: "#bbb" }}>{s.id}</td>
                        <td style={{ padding: "10px 10px", color: "#00ff9d", fontWeight: 600 }}>{s.device_id}</td>
                        <td style={{ padding: "10px 10px", color: "#bbb" }}>{getHora(s.inicio)}</td>
                        <td style={{ padding: "10px 10px", color: "#bbb" }}>{getHora(s.fim)}</td>
                        <td style={{ padding: "10px 10px", color: "#ffd700" }}>{formatDuracao(s.duracao_segundos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </main>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
