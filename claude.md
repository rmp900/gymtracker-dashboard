# CLAUDE.md — GymTracker

> Documento normativo de arquitetura. Leia antes de qualquer sessão de desenvolvimento.
> Decisões aqui registradas não devem ser revertidas sem justificativa explícita.
> Última atualização: 23 de Junho 2026

---

## 1. O que é o GymTracker

SaaS B2B IoT para academias. Dispositivos ESP32 instalados em equipamentos detectam uso via acelerômetro MPU-6050 e enviam sessões para uma API na nuvem. O dono da academia acessa um dashboard com analytics de utilização. Alunos acessam uma view pública de ocupação em tempo real via QR code.

**Estágio atual:** MVP em produção com 1 cliente (Águia Academia, SJC). Dados coletados há ~3 semanas. Estratégia comercial pivotou para apresentação direta à Smart Fit na primeira semana de julho/2026. José Ricardo (gerente Smart Fit SJC) retorna de férias em 15/06 — conversa de aproximação esta semana, pitch completo em julho.

---

## 2. Stack e Infraestrutura

### Backend
- **Linguagem:** Python 3 com FastAPI
- **Banco de dados:** PostgreSQL (Railway)
- **Deploy:** Railway (plano Hobby, $5 USD/mês)
- **Repo:** github.com/rmp900/gymtracker-api
- **URL produção:** https://gymtracker-api-production-bc16.up.railway.app
- **Projeto Railway:** "thriving-playfulness"

### Frontend / Dashboard
- **Framework:** React
- **Deploy:** Vercel
- **Repo:** github.com/rmp900/gymtracker-dashboard
- **URL produção:** gymtracker-dashboard.vercel.app
- **View pública (alunos):** gymtracker-dashboard.vercel.app/status.html (auto-refresh 30s, sem login)
- **Página de diagnóstico:** gymtracker-dashboard.vercel.app/diagnostico.html (device_006 e device_008 em teste; demais em produção)

### Firmware
- **Plataforma atual (campo):** ESP32 WROOM DevKit V1
- **IDE:** Arduino IDE 2.3.8
- **Sketch path local:** C:\Users\rmp_9\OneDrive\Documentos\Arduino\gymtracker_teste

### Rede na academia
- **Roteador:** TP-Link TL-WR840N
- **SSID:** GymTracker | **Senha:** Gt@Academia#2026
- **Painel admin:** 192.168.0.1 | **Senha:** GymTracker2026

### Paths locais
- API: `C:\Users\rmp_9\gymtracker-api`
- Dashboard: `C:\Users\rmp_9\Desktop\gymtracker-dashboard`

---

## 3. Modelo de Dados

### Tabela principal: `sessoes`

Campos base (todos os devices):
```
id            SERIAL PRIMARY KEY
device_id     VARCHAR   -- ex: "device_001"
inicio        TIMESTAMP -- horário BRT (UTC-3), NÃO UTC
fim           TIMESTAMP -- horário BRT
duracao_s     INTEGER   -- duração em segundos
```

Campos opcionais (protótipos com firmware novo — backward-compatible, campo inexistente = null):
```
bat_pct       FLOAT     -- nível de bateria em %
rssi          INTEGER   -- força do sinal WiFi em dBm
wakes_sem_mov INTEGER   -- wakes sem movimento desde último envio
buffer_fill   INTEGER   -- sessões no buffer RTC no momento do envio
temp_c        FLOAT     -- temperatura interna do ESP32 (diagnóstico)
```

> ⚠️ CRÍTICO — TIMEZONE: Timestamps são armazenados em BRT (UTC-3), NÃO em UTC.
> Todo filtro por data/hora na API deve usar `datetime.now()`, nunca `datetime.utcnow()`.
> No frontend, timestamps devem ser parseados com sufixo "-03:00" (função parseBRT).
> Errar isso faz sessões desaparecerem dos queries — bug já ocorreu e foi corrigido.

### Mapeamento de dispositivos

| device_id  | Tipo     | Aparelho           | Músculo | Cor          | Status    |
|------------|----------|--------------------|---------|--------------|-----------|
| device_001 | Produção | Leg Press          | Perna   | #5DCAA5      | Campo     |
| device_002 | Produção | Pulley Remada      | Costas  | #378ADD      | Campo     |
| device_003 | Produção | Supino Máquina     | Peito   | #D85A30      | Campo     |
| device_004 | Produção | Esteira B          | Cardio  | #9B6DD8      | Campo — AC, janela deslizante (sem deep sleep) |
| device_005 | Produção | Pulley Alto        | Costas  | #2563C9      | Campo     |
| device_006 | Teste    | LoRa               | —       | —            | Lab/teste |
| device_007 | Produção | Cadeira Extensora  | Perna   | #3DA882      | Campo     |
| device_008 | Teste    | Demo investidores  | —       | —            | Lab/teste |

**PRODUCTION_DEVICES** (constante no frontend): `['device_001', 'device_002', 'device_003', 'device_004', 'device_005', 'device_007']`
**DEVICES_TESTE** (constante no frontend): `['device_006', 'device_008']` — aparecem SOMENTE em diagnostico.html, nunca no dashboard principal.

### Evolução planejada — multi-tenancy (bloqueante para Smart Fit)

Antes de qualquer novo cliente, adicionar:
```sql
academia_id  VARCHAR  -- isolamento por cliente
```
Sem isso, dados de academias diferentes ficam na mesma tabela. Esta migração é bloqueante.

---

## 4. API — Endpoints

| Método | Rota                        | Descrição                                                     |
|--------|-----------------------------|---------------------------------------------------------------|
| POST   | /sessao                     | Recebe sessão do firmware. Campos base + opcionais de diagnóstico |
| GET    | /status                     | Retorna sessões da última hora. Usado por status.html         |
| GET    | /sessoes/dia?data=YYYY-MM-DD| Retorna sessões de um dia específico. Filtro no banco.        |

### Regra crítica do endpoint /status

```python
uma_hora_atras = (datetime.now() - timedelta(hours=4)).isoformat()
```
O `hours=4` compensa diferença entre servidor Railway (UTC) e timestamps BRT armazenados. Nunca usar `datetime.utcnow()`.

### Lógica de ocupação (status.html)

| Devices ativos nos últimos 5 min | Status              | Cor  |
|----------------------------------|---------------------|------|
| 3                                | Academia cheia      | 🔴   |
| 2                                | Bem movimentada     | 🟡   |
| 1                                | Tranquila           | 🟢   |
| 0                                | Sem atividade       | ⚪   |

---

## 5. Firmware — Histórico e Versão Atual

### Regra de ouro: nunca reescrever o loop de monitoramento

O loop de sessão usa `millis()` internamente. `millis()` reseta a cada wake do deep sleep. Misturar `millis()` com epoch timestamp destrói a lógica de inatividade — sessão nunca encerra. Lição aprendida na v2a.

**Regra:** adicionar features em cima da estrutura original, nunca substituir.
**`ultimoMovimento` deve ser variável LOCAL ao loop, nunca na RTC.**

### Versão atual em campo: v3 (lógica simplificada)

Todo wake sem movimento verifica o schedule incondicionalmente:
- Academia fechada → dorme 30 minutos
- Academia aberta → dorme 2 segundos

Sem `wakeCount % N` — essa lógica causou bug após fim de semana longo (wakeCount acumula, condição nunca satisfeita).

### Melhoria de firmware em desenvolvimento (battery + buffer + NTP otimizado)

- NTP sincroniza apenas no bootstrap ou ao sair de hibernação — não conecta WiFi a cada 30s
- Buffer RTC armazena até 20 sessões — envia em batch a cada ~WAKES_POR_ENVIO wakes
- Campos de diagnóstico opcionais (bat_pct, rssi, etc.) no payload POST
- Leitura de bateria: módulo GY 0-25V (divisor 5:1) no GPIO34, DIVISOR_FATOR=5, ADC_REF_MV=3578

> ⚠️ Carregador atual não corta em 4.2V — baterias chegam a ~4.89V. Verificar tensão com multímetro antes de cada uso em campo enquanto este carregador for usado.

### Firmware device_004 (esteira) — arquitetura diferente

> 📝 23/06/2026: esta arquitetura pertencia ao device_005 antes do remapeamento físico de devices na academia. Agora é o device_004. device_005 passou a ser um device padrão (Pulley Alto) — WiFi com deep sleep, igual aos demais.

Esteira não dorme. É alimentada por AC (HLK-PM01 → CN1 JST). Sem deep sleep, sem gestão de bateria.

Detecção via janela deslizante:
- Janela de 5 segundos contando picos acima de threshold 17500
- Requer 3 de 12 janelas ativas (60s confirmados) para iniciar sessão
- 30s de inatividade para encerrar
- Sessão mínima de 60s para registrar
- WiFi contínuo, sem buffer

### Protocolo obrigatório de gravação de firmware

**Nunca gravar em campo sem validação prévia em casa.**

1. Validar na rede MENDES 148 (home WiFi)
2. Confirmar "SESSAO INICIADA" e "SESSAO ENCERRADA" no Serial Monitor (115200 baud)
3. Trocar SSID/senha para GymTracker / Gt@Academia#2026
4. Trocar `deviceId` para o dispositivo correto
5. Confirmar no Serial Monitor antes de desconectar USB
6. Anotar data e hora exata da gravação
7. Confirmar no Railway que sessões aparecem nas primeiras horas

### Diferença de pinos: WROOM vs C3-MINI-1 (referência futura)

| Função  | ESP32 WROOM (campo atual) | ESP32-C3-MINI-1 (PCB — não usar ainda) |
|---------|--------------------------|----------------------------------------|
| SDA     | GPIO21                   | IO6                                    |
| SCL     | GPIO22                   | IO7                                    |
| ADC bat | GPIO34                   | IO1                                    |

---

## 6. PCB Customizada — Status

**PCB JLCPCB chegou e NÃO funcionou.** LED não acendeu, não conectou, não fez nada. Suspeita: falta do botão de boot (GPIO0 pull-down para entrar em modo de programação). A ser investigado com empresa de PCB local no Brasil que possa ajudar a diagnosticar o erro do projeto.

**Próximo passo hardware:** orçar fabricação local + suporte de engenheiro para diagnóstico do projeto EasyEDA.

**Não investir em novo batch sem entender a causa raiz da falha.**

---

## 7. Arquitetura v2 — LoRa (planejamento, não em produção)

Motivação: autonomia atual ~8 dias com WiFi é insuficiente para escala.

**Componentes definidos:**
- Módulo RF: Ebyte E32-900T20D (915MHz, UART, ~R$50 unitário)
- MCU target (produção futura): RAK3172
- Gateway por academia: ESP32 WROOM + E32 + HLK-5M05 (alimentado por tomada)
- Bateria device: dual 18650 paralelo (~5300mAh) — comprado case paralelo (não série)
- Protocolo: LoRa puro (não LoRaWAN) — suficiente até ~200-300 academias

**Decisão de bateria:** Li-SOCl2 ER18505 descartada — picos de corrente do WiFi (125mA) incompatíveis; supercapacitor de buffer descartado como complexidade desnecessária.

**Próximo passo LoRa:** teste de autonomia lado a lado — device WiFi atual vs device LoRa, ambos com dual 18650 paralelo — antes de qualquer desenvolvimento de firmware.

---

## 8. Dashboard — Arquitetura de Camadas

| Camada      | Janela           | Pergunta respondida                      | Status                    |
|-------------|------------------|------------------------------------------|---------------------------|
| Real-time   | Últimos 15-30min | O que está acontecendo agora?            | ✅ status.html             |
| Operacional | Última hora/dia  | Hoje a academia foi bem usada?           | ✅ Dashboard principal     |
| Tático      | Semana           | Qual horário é mais cheio? Heatmap.      | 🔄 A implementar          |
| Estratégico | Mês/tendência    | Estou crescendo? Qual aparelho é mais usado? | 🔄 A implementar      |

**Seletor de data:** botões ‹ › com "Hoje" reset, busca por `/sessoes/dia?data=`.
**Timeout de fetch:** 10 segundos — UI não trava em falha de API.

---

## 9. Modelo Comercial

| Item                          | Valor              |
|-------------------------------|--------------------|
| Mensalidade por dispositivo   | R$ 50,00           |
| Setup padrão (3 dispositivos) | R$ 150,00/mês      |
| Custo Railway                 | ~R$ 28,00/mês      |
| Hardware por dispositivo      | ~R$ 75,00 (custo único) |

R$50/dispositivo é o piso. Não negociar abaixo disso.

---

## 10. Estratégia Comercial Atual

**Pivô:** abandonar rota de academias independentes de bairro por ora. Ir direto para Smart Fit.

**Por quê:** dono da Águia Academia está desengajado (sem depoimento disponível). Academias independentes tomariam meses para validar e gerar receita. Smart Fit tem escala e contato direto disponível.

**Contato Smart Fit:** José Ricardo, gerente da unidade SJC. Retorna de férias 15/06. Conversa de aquecimento esta semana. Pitch completo: primeira semana de julho/2026.

**Estratégia de validação:** usar os dados da Águia Academia como prova de conceito técnica. O produto precisa estar robusto o suficiente para o demo — não precisa de depoimento do dono.

---

## 11. Decisões de Arquitetura que NÃO mudam sem discussão explícita

1. **Timestamps sempre em BRT no banco.** Não migrar para UTC sem migrar dados e filtros simultaneamente.

2. **Device ID segue padrão `device_XXX`.** Não mudar formato sem atualizar firmware de todos os dispositivos em campo.

3. **O loop de monitoramento usa `millis()` local.** `ultimoMovimento` é variável LOCAL ao loop, nunca na RTC.

4. **`wakeCount % N` não é usado para verificação de horário.** Causa bug após hibernação longa. Toda verificação de horário ocorre a cada wake, incondicionalmente.

5. **Firmware validado em casa (MENDES 148) antes de qualquer deploy em campo.** Sem exceção.

6. **device_006 e device_008 (DEVICES_TESTE) nunca aparecem no dashboard de produção.** Apenas em diagnostico.html. device_004 deixou de ser device de laboratório — remapeado para produção (ver nota abaixo).

7. **PRODUCTION_DEVICES = ['device_001', 'device_002', 'device_003', 'device_004', 'device_005', 'device_007'].** Qualquer novo device de produção requer atualização explícita desta constante.

> 📝 **23/06/2026 — Remapeamento físico de devices (múltiplas camadas, sem migração retroativa).** device_004 (antes protótipo de bateria em lab) passou a ser a Esteira B em produção; device_005 (antes Supino/Esteira) passou a ser Pulley Alto. Esses IDs já passaram por mais de um remapeamento físico — por exemplo, device_003 já foi Supino → Pulley Alto → Supino (mapeamento atual), e device_005 já foi Supino/Esteira → Pulley Alto. **Sessões registradas antes de 23/06/2026 podem corresponder a qualquer mapeamento anterior do device_id — não há migração retroativa de dados; a tabela da seção 3 reflete apenas o mapeamento vigente a partir desta data.** Justificativa: remapeamento físico dos devices na academia, decidido em sessão de organização do front-end.

8. **Multi-tenancy via `academia_id` antes de qualquer segundo cliente.**

---

## 12. O que está pendente (por prioridade)

### Bloqueante para Smart Fit
- [ ] Multi-tenancy: `academia_id` no schema + isolamento de dados
- [ ] Autenticação básica por academia no dashboard
- [ ] Endpoint de diagnóstico: alerta quando device para de enviar por >X horas

### Hardware imediato
- [ ] Instalar device_004 (esteira) na Águia Academia esta semana
- [ ] Investigar PCB com empresa local — diagnosticar causa da falha (suspeita: GPIO0/boot button)
- [ ] Teste de autonomia LoRa vs WiFi (dual 18650 paralelo)

### Produto
- [ ] Instalar QR code na entrada da Águia Academia
- [ ] Camada tática do dashboard (heatmap hora × dia da semana)
- [ ] Camada estratégica (mês, tendências, alertas automáticos)

### Negócio
- [ ] Conversa de aquecimento com José Ricardo (Smart Fit) esta semana
- [ ] Pitch completo Smart Fit — primeira semana de julho
- [ ] MEI + INPI após primeiro contrato pago

---

*GymTracker | Rodrigo Mendes | Documento vivo — atualizar a cada decisão de arquitetura relevante*
