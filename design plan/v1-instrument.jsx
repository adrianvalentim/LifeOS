// V1 — INSTRUMENT
// Mission-control dashboard. Dense tabular data, monospace numerics, thin rules.
// Theme: dark, ember accent, warm off-white text.

(function () {
  const D = window.LIFEOS;
  const { useState, useEffect, useRef } = React;

  // ─── theme ────────────────────────────────────────────────────────────
  const c = {
    bg:        '#0a0a0c',
    surface:   '#111114',
    surface2:  '#16161a',
    line:      'rgba(255,255,255,.07)',
    lineStrong:'rgba(255,255,255,.14)',
    ink:       '#e6e1d6',
    inkDim:    '#8a847a',
    inkDim2:   '#56514a',
    inkFaint:  '#37332e',
    ember:     '#d97757',
    healthy:   '#7ea884',
    attention: '#d4a04a',
    critical:  '#c95850',
  };
  const dom = D.PALETTE.instrument;
  const HEALTH = { healthy: c.healthy, attention: c.attention, critical: c.critical };

  // ─── styles ───────────────────────────────────────────────────────────
  const STYLES = `
    .v1 { font-family: "Instrument Sans", "IBM Plex Sans", system-ui, sans-serif;
      background: ${c.bg}; color: ${c.ink}; width: 100%; height: 100%;
      font-size: 12px; letter-spacing: .01em; overflow: hidden;
      display: grid; grid-template-columns: 1fr 380px; }
    .v1 .mono { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-feature-settings: "tnum", "ss01"; }
    .v1 .num { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-variant-numeric: tabular-nums; }
    .v1 .micro { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.inkDim}; font-family: "JetBrains Mono", ui-monospace, monospace; }
    .v1 .micro-strong { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.ink}; font-family: "JetBrains Mono", ui-monospace, monospace; }

    /* Topbar */
    .v1-top { grid-column: 1 / -1; height: 42px; border-bottom: 1px solid ${c.line};
      display: flex; align-items: stretch; background: ${c.bg}; }
    .v1-top .cell { padding: 0 16px; display: flex; align-items: center; gap: 8px;
      border-right: 1px solid ${c.line}; }
    .v1-top .cell:last-child { border-right: none; }
    .v1-top .logo { font-family: "JetBrains Mono", monospace; font-weight: 600;
      font-size: 12px; letter-spacing: .18em; color: ${c.ink}; padding: 0 18px; }
    .v1-top .logo .dot { display: inline-block; width: 6px; height: 6px; background: ${c.ember};
      margin-right: 8px; vertical-align: middle; }
    .v1-top .grow { flex: 1; border-right: 1px solid ${c.line}; }
    .v1-top .k { color: ${c.inkDim}; }
    .v1-top .v { color: ${c.ink}; font-family: "JetBrains Mono", monospace; }

    /* Main column */
    .v1-main { display: flex; flex-direction: column; min-width: 0;
      border-right: 1px solid ${c.line}; }
    .v1-sect { border-bottom: 1px solid ${c.line}; }
    .v1-sect-hd { display: flex; align-items: center; gap: 14px; height: 28px;
      padding: 0 18px; border-bottom: 1px solid ${c.line}; background: ${c.surface}; }
    .v1-sect-hd .micro { color: ${c.inkDim}; }
    .v1-sect-hd .micro b { color: ${c.ink}; font-weight: 500; }
    .v1-sect-hd .grow { flex: 1; }
    .v1-sect-hd .axis { color: ${c.inkDim2}; }

    /* WHAT NOW */
    .v1-now { padding: 18px 22px 18px; display: grid;
      grid-template-columns: auto 1fr auto; gap: 28px; align-items: center; }
    .v1-now .badge { width: 72px; height: 72px; border: 1px solid ${c.lineStrong};
      display: grid; place-items: center; color: ${c.ember}; position: relative;
      font-family: "JetBrains Mono", monospace; }
    .v1-now .badge::before { content: ''; position: absolute; inset: 4px;
      border: 1px solid ${c.line}; }
    .v1-now .badge-num { font-size: 26px; font-weight: 500; line-height: 1; }
    .v1-now .badge-unit { font-size: 9px; letter-spacing: .14em; opacity: .7; margin-top: 2px; }
    .v1-now .title-row { display: flex; align-items: baseline; gap: 14px; }
    .v1-now .title { font-size: 22px; font-weight: 500; letter-spacing: -.01em; color: ${c.ink}; }
    .v1-now .meta { color: ${c.inkDim}; font-size: 11px; }
    .v1-now .reason { color: ${c.ink}; opacity: .82; margin-top: 8px;
      font-size: 13px; line-height: 1.45; max-width: 56ch; }
    .v1-now .actions { display: flex; gap: 6px; flex-direction: column; align-items: flex-end; }
    .v1-now .btn { font-family: "JetBrains Mono", monospace; font-size: 10.5px;
      letter-spacing: .12em; text-transform: uppercase; padding: 7px 12px;
      border: 1px solid ${c.lineStrong}; background: transparent; color: ${c.ink};
      cursor: pointer; }
    .v1-now .btn.primary { background: ${c.ember}; color: #0a0a0c; border-color: ${c.ember}; }
    .v1-now .btn.ghost { border-color: ${c.line}; color: ${c.inkDim}; }

    /* Project rack table */
    .v1-rack { flex: 1; overflow: hidden; }
    .v1-row { display: grid; grid-template-columns: 4px 28px 1.7fr 60px 70px 60px 1.2fr 110px 36px;
      align-items: center; min-height: 38px; padding-right: 18px;
      border-bottom: 1px solid ${c.line}; font-size: 12.5px; }
    .v1-row.head { min-height: 22px; background: ${c.surface}; }
    .v1-row.head > * { font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.inkDim}; font-family: "JetBrains Mono", monospace; }
    .v1-row .swatch { width: 4px; align-self: stretch; }
    .v1-row .glyph { font-family: "JetBrains Mono", monospace; font-size: 10px;
      color: ${c.inkDim}; padding-left: 8px; }
    .v1-row .name { font-weight: 500; color: ${c.ink}; }
    .v1-row .name .sub { color: ${c.inkDim}; margin-left: 8px; font-weight: 400;
      font-size: 11px; }
    .v1-row .when, .v1-row .week, .v1-row .due { color: ${c.ink};
      font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums;
      font-size: 11.5px; }
    .v1-row .due.imminent { color: ${c.critical}; }
    .v1-row .due.soon { color: ${c.attention}; }
    .v1-row .when.fresh { color: ${c.healthy}; }
    .v1-row .when.stale { color: ${c.inkDim}; }
    .v1-row .when.cold { color: ${c.critical}; }

    .v1-row .progress { display: flex; align-items: center; gap: 8px;
      font-family: "JetBrains Mono", monospace; font-size: 10.5px; color: ${c.inkDim}; }
    .v1-row .bar { flex: 1; height: 6px; position: relative; background: ${c.inkFaint};
      max-width: 140px; }
    .v1-row .bar > i { position: absolute; left: 0; top: 0; bottom: 0; }

    .v1-row .spark { display: flex; align-items: flex-end; gap: 2px; height: 18px; }
    .v1-row .spark i { width: 4px; min-height: 1px; }

    .v1-row .health { font-family: "JetBrains Mono", monospace; font-size: 10px;
      display: flex; align-items: center; justify-content: flex-end; gap: 6px; color: ${c.inkDim}; }
    .v1-row .health .dot { width: 7px; height: 7px; border-radius: 50%; }
    .v1-row:hover { background: ${c.surface}; }

    /* Bottom strip */
    .v1-bottom { display: grid; grid-template-columns: 1.4fr 1fr 1fr; min-height: 168px; }
    .v1-panel { padding: 12px 18px 16px; border-right: 1px solid ${c.line};
      display: flex; flex-direction: column; gap: 10px; }
    .v1-panel:last-child { border-right: none; }
    .v1-panel .hd { display: flex; align-items: baseline; gap: 12px; }
    .v1-panel .hd .micro { color: ${c.inkDim}; }
    .v1-panel .hd .total { font-family: "JetBrains Mono", monospace; font-size: 22px;
      font-weight: 500; color: ${c.ink}; letter-spacing: -.02em; }
    .v1-panel .hd .delta { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace; font-size: 11px; }

    /* Today's tape */
    .v1-tape { display: flex; flex-direction: column; gap: 4px; }
    .v1-tape-row { display: grid; grid-template-columns: 56px 1fr auto;
      gap: 12px; align-items: center; padding: 5px 0;
      border-bottom: 1px dashed ${c.line}; font-size: 11.5px; }
    .v1-tape-row:last-child { border-bottom: none; }
    .v1-tape .t { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace; }
    .v1-tape .desc { color: ${c.ink}; }
    .v1-tape .desc .type { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace;
      font-size: 10px; letter-spacing: .1em; text-transform: uppercase; margin-right: 8px; }
    .v1-tape .dur { color: ${c.ink}; font-family: "JetBrains Mono", monospace; }

    /* Domain bars */
    .v1-domains { display: flex; flex-direction: column; gap: 7px; padding-top: 4px; }
    .v1-domain { display: grid; grid-template-columns: 80px 1fr 50px; gap: 10px; align-items: center;
      font-size: 11px; }
    .v1-domain .lbl { color: ${c.ink}; font-family: "JetBrains Mono", monospace;
      font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
    .v1-domain .track { height: 6px; background: ${c.inkFaint}; position: relative; }
    .v1-domain .track > i { position: absolute; left: 0; top: 0; bottom: 0; }
    .v1-domain .val { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace;
      text-align: right; }

    /* Challenge */
    .v1-challenge { display: flex; flex-direction: column; gap: 10px; }
    .v1-challenge .body { font-size: 13.5px; line-height: 1.4; color: ${c.ink}; }
    .v1-challenge .pips { display: flex; gap: 6px; align-items: center; }
    .v1-challenge .pips i { width: 18px; height: 8px; border: 1px solid ${c.lineStrong}; }
    .v1-challenge .pips i.on { background: ${c.ember}; border-color: ${c.ember}; }
    .v1-challenge .pips .days { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace;
      font-size: 10.5px; margin-left: 10px; }

    /* Chat sidebar */
    .v1-chat { display: flex; flex-direction: column; background: ${c.bg}; height: 100%;
      min-height: 0; }
    .v1-chat-top { display: flex; align-items: stretch; height: 42px;
      border-bottom: 1px solid ${c.line}; background: ${c.bg}; }
    .v1-chat-top .label { padding: 0 14px; display: flex; align-items: center; gap: 8px;
      border-right: 1px solid ${c.line}; }
    .v1-chat-top .grow { flex: 1; }
    .v1-chat-top .kbd { padding: 0 12px; display: flex; align-items: center;
      font-family: "JetBrains Mono", monospace; font-size: 10px; color: ${c.inkDim}; }
    .v1-chat-top .kbd b { color: ${c.ink}; font-weight: 400; border: 1px solid ${c.lineStrong};
      padding: 1px 5px; margin-right: 4px; }

    .v1-chat-channels { display: flex; padding: 8px 12px 4px; gap: 4px;
      border-bottom: 1px solid ${c.line}; }
    .v1-chat-channels .pill { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .12em; text-transform: uppercase; color: ${c.inkDim};
      padding: 5px 9px; border: 1px solid transparent; cursor: pointer; }
    .v1-chat-channels .pill.active { color: ${c.ink}; border-color: ${c.lineStrong}; }
    .v1-chat-channels .pill.build.active { color: ${c.ember}; border-color: ${c.ember}; }
    .v1-chat-channels .count { color: ${c.inkDim2}; margin-left: 4px; }

    .v1-chat-body { flex: 1; overflow-y: auto; padding: 16px 16px 8px;
      display: flex; flex-direction: column; gap: 14px; min-height: 0; }
    .v1-chat-day { display: flex; align-items: center; gap: 10px; margin: 4px 0; }
    .v1-chat-day .micro { color: ${c.inkDim2}; }
    .v1-chat-day .rule { flex: 1; border-top: 1px solid ${c.line}; }
    .v1-msg { display: grid; grid-template-columns: 44px 1fr; gap: 10px; }
    .v1-msg .t { color: ${c.inkDim2}; font-family: "JetBrains Mono", monospace; font-size: 10px;
      padding-top: 2px; }
    .v1-msg .body { font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
    .v1-msg.user .body { color: ${c.ink}; }
    .v1-msg.user .body::before { content: '› '; color: ${c.ember}; }
    .v1-msg.assistant .body { color: ${c.ink}; opacity: .92; }
    .v1-msg.terse .body { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace;
      font-size: 11.5px; }
    .v1-msg.terse .body::before { content: ''; }

    .v1-chat-input { border-top: 1px solid ${c.line}; padding: 10px 14px 12px;
      display: flex; flex-direction: column; gap: 8px; background: ${c.bg}; }
    .v1-chat-input .field { display: flex; align-items: center; gap: 8px;
      border: 1px solid ${c.lineStrong}; padding: 8px 10px; background: ${c.surface}; }
    .v1-chat-input .caret { color: ${c.ember}; font-family: "JetBrains Mono", monospace; }
    .v1-chat-input .typed { color: ${c.ink}; font-family: "JetBrains Mono", monospace;
      font-size: 12px; flex: 1; }
    .v1-chat-input .cursor { width: 7px; height: 14px; background: ${c.ink};
      animation: v1-blink 1.1s steps(2) infinite; }
    @keyframes v1-blink { 50% { opacity: 0; } }
    .v1-chat-input .hint { display: flex; justify-content: space-between;
      color: ${c.inkDim2}; font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .1em; text-transform: uppercase; }
  `;

  // ─── helpers ──────────────────────────────────────────────────────────
  function deadlineClass(d) {
    if (d == null) return '';
    if (d <= 3) return 'imminent';
    if (d <= 7) return 'soon';
    return '';
  }
  function lastTouchedClass(hoursAgo) {
    if (hoursAgo < 24) return 'fresh';
    if (hoursAgo < 24 * 4) return '';
    if (hoursAgo < 24 * 7) return 'stale';
    return 'cold';
  }

  // ─── components ───────────────────────────────────────────────────────
  function Topbar() {
    return (
      <div className="v1-top">
        <div className="logo cell"><span className="dot"/>LIFEOS</div>
        <div className="cell"><span className="k">DATE</span><span className="v">FRI 22 MAY 2026</span></div>
        <div className="cell"><span className="k">WEEK</span><span className="v">21 · 142/365</span></div>
        <div className="cell"><span className="k">LOC</span><span className="v">SAO PAULO 08:34</span></div>
        <div className="cell grow"></div>
        <div className="cell"><span className="k">DEEP YTD</span><span className="v">482h 14m</span></div>
        <div className="cell"><span className="k">DEEP MAY</span><span className="v">88h 03m</span></div>
        <div className="cell"><span className="k">STREAK</span><span className="v" style={{color:c.ember}}>● 7d</span></div>
      </div>
    );
  }

  function WhatNow() {
    const r = D.RECOMMENDATION;
    const p = D.project(r.project_id);
    return (
      <div className="v1-sect">
        <div className="v1-sect-hd">
          <span className="micro">WHAT NOW</span>
          <span className="axis">·</span>
          <span className="micro">CONFIDENCE 86%</span>
          <span className="grow"/>
          <span className="micro">ALTS · SUBSTACK 60M · INFINITAMENTE 45M</span>
        </div>
        <div className="v1-now">
          <div className="badge">
            <div className="badge-num">90</div>
            <div className="badge-unit">MIN</div>
          </div>
          <div>
            <div className="title-row">
              <div className="title">{p.name}</div>
              <div className="meta mono">{p.subtitle.toUpperCase()}</div>
              <div className="meta" style={{color: c.critical, fontFamily: '"JetBrains Mono", monospace'}}>● DEADLINE 3D</div>
            </div>
            <div className="reason">{r.reason_long}</div>
          </div>
          <div className="actions">
            <button className="btn primary">START · 90M</button>
            <button className="btn">ALTERNATIVE</button>
            <button className="btn ghost">DISMISS</button>
          </div>
        </div>
      </div>
    );
  }

  function ProjectRow({ p }) {
    const hoursAgo = (D.now - p.last_touched) / (1000 * 60 * 60);
    const maxSpark = Math.max(0.5, ...p.sparkline);
    return (
      <div className="v1-row">
        <div className="swatch" style={{background: dom[p.domain]}}/>
        <div className="glyph">{D.DOMAINS[p.domain].short.slice(0, 1)}</div>
        <div className="name">
          {p.name}
          <span className="sub">{p.subtitle}</span>
        </div>
        <div className={`when ${lastTouchedClass(hoursAgo)}`}>{D.fmtAgo(p.last_touched)}</div>
        <div className="week">{p.hours_week === 0 ? '—' : D.fmtHM(p.hours_week)}</div>
        <div className={`due ${deadlineClass(p.deadline_in_days)}`}>
          {p.deadline_in_days == null ? '—' : (p.deadline_in_days <= 3 ? p.deadline_in_days + 'd!' : p.deadline_in_days + 'd')}
        </div>
        <div className="progress">
          <span style={{width: 30, textAlign: 'right'}}>
            {p.progress == null ? '—' : Math.round(p.progress * 100) + '%'}
          </span>
          <div className="bar">
            {p.progress != null && <i style={{width: `${p.progress * 100}%`, background: dom[p.domain]}}/>}
          </div>
        </div>
        <div className="spark">
          {p.sparkline.map((v, i) => (
            <i key={i} style={{
              height: `${Math.max(1, (v / maxSpark) * 100)}%`,
              background: v > 0 ? dom[p.domain] : c.inkFaint,
              opacity: v > 0 ? .9 : 1,
            }}/>
          ))}
        </div>
        <div className="health">
          <span style={{color: HEALTH[p.health]}}>{p.health === 'healthy' ? 'OK' : p.health === 'attention' ? 'ATT' : 'CRT'}</span>
          <div className="dot" style={{background: HEALTH[p.health]}}/>
        </div>
      </div>
    );
  }

  function ProjectRack() {
    const sorted = [...D.PROJECTS].sort((a, b) => {
      const order = { critical: 0, attention: 1, healthy: 2 };
      return order[a.health] - order[b.health];
    });
    return (
      <div className="v1-sect v1-rack">
        <div className="v1-sect-hd">
          <span className="micro-strong">PROJECTS</span>
          <span className="micro">{sorted.length} ACTIVE · 2 CRITICAL · 2 ATTENTION</span>
          <span className="grow"/>
          <span className="micro">SORTED BY HEALTH</span>
        </div>
        <div className="v1-row head">
          <div></div>
          <div></div>
          <div>NAME</div>
          <div>LAST</div>
          <div>WEEK</div>
          <div>DUE</div>
          <div>PROGRESS</div>
          <div>7-DAY</div>
          <div style={{textAlign:'right'}}>HEALTH</div>
        </div>
        {sorted.map((p) => <ProjectRow key={p.id} p={p} />)}
      </div>
    );
  }

  function TodayPanel() {
    const totalMin = D.TODAY_ENTRIES.reduce((s, e) => s + e.dur, 0);
    return (
      <div className="v1-panel">
        <div className="hd">
          <span className="micro">TODAY</span>
          <span className="grow"/>
          <span className="delta">PLAN 8H · {Math.round(totalMin / 60 * 10) / 10}H LOGGED</span>
        </div>
        <div className="hd">
          <span className="total">{Math.floor(totalMin / 60)}h {String(totalMin % 60).padStart(2, '0')}</span>
          <span className="delta">/ 8h · {Math.round(totalMin / 480 * 100)}%</span>
        </div>
        <div className="v1-tape">
          {D.TODAY_ENTRIES.map((e, i) => (
            <div className="v1-tape-row" key={i}>
              <span className="t">{e.t}</span>
              <span className="desc">
                <span className="type">{e.type.replace('_', ' ')}</span>
                {e.desc}
              </span>
              <span className="dur">{e.dur}m</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function DomainPanel() {
    // Weekly totals per domain
    const totals = {};
    Object.keys(D.DOMAINS).forEach((k) => totals[k] = 0);
    D.PROJECTS.forEach((p) => { totals[p.domain] += p.hours_week; });
    const max = Math.max(...Object.values(totals));
    const grand = Object.values(totals).reduce((a, b) => a + b, 0);
    return (
      <div className="v1-panel">
        <div className="hd">
          <span className="micro">WEEK · BY DOMAIN</span>
          <span className="grow"/>
          <span className="delta">{D.fmtHM(grand)} · PLAN 48H</span>
        </div>
        <div className="v1-domains">
          {Object.entries(D.DOMAINS).map(([k, d]) => (
            <div className="v1-domain" key={k}>
              <span className="lbl">{d.short}</span>
              <div className="track">
                <i style={{width: `${(totals[k] / max) * 100}%`, background: dom[k]}}/>
              </div>
              <span className="val">{D.fmtHM(totals[k])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function ChallengePanel() {
    return (
      <div className="v1-panel v1-challenge">
        <div className="hd">
          <span className="micro" style={{color: c.ember}}>WEEKLY CHALLENGE</span>
          <span className="grow"/>
          <span className="delta">AI · MON 18 MAY</span>
        </div>
        <div className="body">"Three deep-work sessions on <b style={{color:c.ember, fontWeight:500}}>Portia</b> before Thursday."</div>
        <div className="pips">
          <i/><i/><i/>
          <span className="days">0 / 3 · 6D LEFT</span>
        </div>
        <div style={{marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6}}>
          <span className="micro" style={{color: c.inkDim2}}>RECENT MILESTONES</span>
          {D.MILESTONES.slice(0, 3).map((m, i) => (
            <div key={i} className="mono" style={{fontSize: 10.5, color: c.inkDim, display:'flex', gap:10}}>
              <span style={{color: c.inkDim2, minWidth: 44}}>{m.date.toUpperCase()}</span>
              <span style={{color: c.ink, opacity: .85}}>{m.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function ChatSidebar() {
    const channels = ['daily-log', 'project-ops', 'analytics', 'build', 'open'];
    const [active, setActive] = useState('daily-log');
    const thread = D.CHAT.find((c) => c.channel === active) || { messages: [] };
    return (
      <div className="v1-chat">
        <div className="v1-chat-top">
          <div className="label">
            <span style={{width: 6, height: 6, background: c.ember}}/>
            <span className="micro-strong">CODEX</span>
          </div>
          <div className="kbd"><b>⌘K</b> SUMMON</div>
          <div className="grow" style={{borderRight: 'none'}}/>
          <div className="kbd" style={{borderLeft: `1px solid ${c.line}`, paddingLeft: 12}}>● ONLINE</div>
        </div>
        <div className="v1-chat-channels">
          {channels.map((ch) => (
            <button key={ch} className={`pill ${ch === active ? 'active' : ''} ${ch}`} onClick={() => setActive(ch)}>
              {ch}{(D.CHAT.find((c) => c.channel === ch)?.messages?.length || 0) > 0 &&
                <span className="count">{D.CHAT.find((c) => c.channel === ch).messages.length}</span>}
            </button>
          ))}
        </div>
        <div className="v1-chat-body">
          <div className="v1-chat-day">
            <span className="micro">{active === 'daily-log' ? 'TODAY · FRI 22 MAY' : active === 'project-ops' ? 'YESTERDAY' : active === 'build' ? 'TUE 19 MAY' : 'EARLIER'}</span>
            <div className="rule"/>
          </div>
          {thread.messages.map((m, i) => (
            <div key={i} className={`v1-msg ${m.role} ${m.terse ? 'terse' : ''}`}>
              <div className="t">{m.t}</div>
              <div className="body">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="v1-chat-input">
          <div className="field">
            <span className="caret">›</span>
            <span className="typed">log 90 min on portia, act III draft</span>
            <span className="cursor"/>
          </div>
          <div className="hint">
            <span>ROUTE → DAILY-LOG</span>
            <span>↵ SEND · ⇧↵ NEWLINE</span>
          </div>
        </div>
      </div>
    );
  }

  function V1Instrument() {
    return (
      <div className="v1">
        <style>{STYLES}</style>
        <Topbar/>
        <div className="v1-main">
          <WhatNow/>
          <ProjectRack/>
          <div className="v1-bottom">
            <TodayPanel/>
            <DomainPanel/>
            <ChallengePanel/>
          </div>
        </div>
        <ChatSidebar/>
      </div>
    );
  }

  window.V1Instrument = V1Instrument;
})();
