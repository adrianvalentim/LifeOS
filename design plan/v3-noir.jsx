// V3 — TECH-NOIR
// Cinematic dashboard. Vast negative space, a single focal recommendation,
// the rest of the world reduced to a quiet horizon of indicators.

(function () {
  const D = window.LIFEOS;
  const { useState } = React;

  const c = {
    bg:        '#07090b',
    surface:   '#0c1014',
    line:      'rgba(255,255,255,.06)',
    lineMid:   'rgba(255,255,255,.10)',
    lineStrong:'rgba(255,255,255,.18)',
    ink:       '#dad5c5',
    inkSoft:   '#a39c8d',
    inkDim:    '#65615a',
    inkFaint:  '#2e2c28',
    ember:     '#e08555',
    emberDim:  '#7a4a30',
    healthy:   '#82a98a',
    attention: '#d4a558',
    critical:  '#d96452',
  };
  const dom = D.PALETTE.noir;
  const HEALTH = { healthy: c.healthy, attention: c.attention, critical: c.critical };

  const STYLES = `
    .v3 { font-family: "Instrument Sans", "Söhne", system-ui, sans-serif;
      background:
        radial-gradient(ellipse 1000px 600px at 20% 30%, rgba(224,133,85,.05), transparent 60%),
        radial-gradient(ellipse 800px 500px at 80% 70%, rgba(109,184,212,.04), transparent 60%),
        ${c.bg};
      color: ${c.ink}; width: 100%; height: 100%;
      overflow: hidden; font-size: 13px; letter-spacing: -.005em;
      display: grid; grid-template-columns: 1fr 380px;
      position: relative; }
    .v3::before {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .9  0 0 0 0 .85  0 0 0 0 .75  0 0 0 .25 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/></svg>");
      opacity: .06; mix-blend-mode: overlay; z-index: 0;
    }
    .v3 > * { position: relative; z-index: 1; }
    .v3 .serif { font-family: "Instrument Serif", "Newsreader", serif; }
    .v3 .mono { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-feature-settings: "tnum"; }
    .v3 .num { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-variant-numeric: tabular-nums; }
    .v3 .label { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .22em; text-transform: uppercase; color: ${c.inkDim}; }
    .v3 .label-strong { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .22em; text-transform: uppercase; color: ${c.inkSoft}; }

    /* Main canvas */
    .v3-main { display: grid; grid-template-rows: 64px 1fr auto auto;
      padding: 0; position: relative; }

    /* Tracking line · ambient status */
    .v3-track { display: flex; align-items: center; padding: 0 44px;
      border-bottom: 1px solid ${c.line}; gap: 28px; }
    .v3-track .mark { display: flex; align-items: center; gap: 10px; }
    .v3-track .mark .dot { width: 7px; height: 7px; border-radius: 50%;
      background: ${c.ember}; box-shadow: 0 0 12px ${c.ember}; }
    .v3-track .name { font-family: "Instrument Serif", serif; font-style: italic;
      font-size: 22px; color: ${c.ink}; line-height: 1; }
    .v3-track .grow { flex: 1; }
    .v3-track .stat { display: flex; align-items: baseline; gap: 8px; }
    .v3-track .stat .k { color: ${c.inkDim}; }
    .v3-track .stat .v { font-family: "JetBrains Mono", monospace;
      color: ${c.ink}; font-variant-numeric: tabular-nums; font-size: 12px;
      letter-spacing: .03em; }
    .v3-track .div { width: 1px; height: 16px; background: ${c.line}; }

    /* Hero */
    .v3-hero { padding: 0 60px; display: flex; align-items: center;
      justify-content: center; position: relative; overflow: hidden; }
    .v3-hero .frame { display: grid;
      grid-template-columns: auto 1fr auto; gap: 56px; align-items: center;
      max-width: 1000px; width: 100%; }
    .v3-hero .timestamp { display: flex; flex-direction: column; gap: 10px;
      align-items: flex-end; white-space: nowrap; }
    .v3-hero .timestamp .label { color: ${c.ember}; opacity: .8; }
    .v3-hero .timestamp .big { font-family: "Instrument Serif", serif;
      font-style: italic; font-size: 56px; line-height: .9; color: ${c.ink};
      letter-spacing: -.02em; }
    .v3-hero .timestamp .min { font-family: "JetBrains Mono", monospace;
      font-size: 14px; color: ${c.inkSoft}; letter-spacing: .12em; }
    .v3-hero .vrule { width: 1px; background: linear-gradient(to bottom,
      transparent, ${c.lineStrong} 20%, ${c.lineStrong} 80%, transparent); align-self: stretch; }
    .v3-hero .body { display: flex; flex-direction: column; gap: 14px; }
    .v3-hero .meta { display: flex; align-items: baseline; gap: 14px; }
    .v3-hero .meta .focus { color: ${c.ember}; }
    .v3-hero .meta .domain-mark { display: inline-flex; align-items: center; gap: 6px; }
    .v3-hero .meta .domain-mark i { width: 6px; height: 6px; border-radius: 50%; }
    .v3-hero .name { font-family: "Instrument Serif", serif; font-style: italic;
      font-weight: 400; font-size: 124px; line-height: .88; letter-spacing: -.03em;
      color: ${c.ink}; }
    .v3-hero .name::after { content: '.'; color: ${c.ember}; }
    .v3-hero .pitch { font-family: "Instrument Serif", serif; font-weight: 400;
      font-size: 26px; line-height: 1.25; color: ${c.ink}; max-width: 30ch;
      text-wrap: balance; }
    .v3-hero .pitch em { font-style: italic; color: ${c.ember}; font-weight: 400; }
    .v3-hero .actions { display: flex; align-items: center; gap: 16px;
      margin-top: 6px; }
    .v3-hero .btn { font-family: "JetBrains Mono", monospace; font-size: 11px;
      letter-spacing: .18em; text-transform: uppercase; padding: 12px 22px;
      border: 1px solid ${c.lineStrong}; background: transparent; color: ${c.ink};
      cursor: pointer; transition: all .15s; }
    .v3-hero .btn.primary { background: ${c.ember}; color: ${c.bg};
      border-color: ${c.ember}; }
    .v3-hero .btn:hover { border-color: ${c.ember}; color: ${c.ember}; }
    .v3-hero .btn.primary:hover { color: ${c.bg}; opacity: .9; }
    .v3-hero .alts { color: ${c.inkDim}; font-family: "JetBrains Mono", monospace;
      font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; }
    .v3-hero .alts b { color: ${c.inkSoft}; font-weight: 400; }

    /* Project horizon */
    .v3-horizon { padding: 18px 44px 14px; border-top: 1px solid ${c.line}; }
    .v3-horizon .hd { display: flex; align-items: baseline; gap: 14px;
      margin-bottom: 14px; }
    .v3-horizon .hd .grow { flex: 1; }
    .v3-horizon .bars { display: grid;
      grid-template-columns: repeat(9, 1fr); gap: 8px; align-items: end;
      height: 110px; }
    .v3-bar { display: flex; flex-direction: column; gap: 6px;
      height: 100%; cursor: pointer; }
    .v3-bar .stack { flex: 1; display: flex; flex-direction: column;
      justify-content: flex-end; gap: 2px; position: relative; }
    .v3-bar .stack .fill { width: 100%; transition: opacity .15s; }
    .v3-bar .stack .frame { width: 100%; height: 100%; position: absolute; inset: 0;
      border: 1px solid ${c.lineStrong}; pointer-events: none; opacity: 0; }
    .v3-bar:hover .stack .frame { opacity: .4; }
    .v3-bar .stack .health-dot { position: absolute; top: -6px; left: 50%;
      transform: translateX(-50%); width: 6px; height: 6px; border-radius: 50%; }
    .v3-bar .stack .pulse { position: absolute; top: -6px; left: 50%;
      transform: translateX(-50%); width: 6px; height: 6px; border-radius: 50%;
      animation: v3-pulse 2s infinite; }
    @keyframes v3-pulse {
      0% { box-shadow: 0 0 0 0 currentColor; opacity: .9; }
      100% { box-shadow: 0 0 0 8px transparent; opacity: 0; }
    }
    .v3-bar .meta { display: flex; flex-direction: column; gap: 1px;
      align-items: center; text-align: center; }
    .v3-bar .meta .nm { font-family: "Instrument Sans", sans-serif;
      font-size: 11.5px; color: ${c.ink}; font-weight: 500; letter-spacing: -.005em; }
    .v3-bar .meta .hr { font-family: "JetBrains Mono", monospace;
      font-size: 9.5px; color: ${c.inkDim}; font-variant-numeric: tabular-nums; }

    /* Today's tape — horizon line */
    .v3-today { padding: 18px 44px 20px; border-top: 1px solid ${c.line};
      display: grid; grid-template-columns: auto 1fr auto auto auto;
      align-items: center; gap: 36px; }
    .v3-today .col { display: flex; flex-direction: column; gap: 5px; }
    .v3-today .col .val { font-family: "Instrument Serif", serif;
      font-size: 26px; font-style: italic; line-height: 1; color: ${c.ink};
      letter-spacing: -.01em; }
    .v3-today .timeline { position: relative; height: 36px;
      display: flex; flex-direction: column; gap: 4px; }
    .v3-today .timeline .grid { position: relative; height: 14px;
      border-top: 1px solid ${c.lineMid}; }
    .v3-today .timeline .hash { position: absolute; top: 0; width: 1px; height: 4px;
      background: ${c.lineMid}; }
    .v3-today .timeline .hash.major { height: 7px; background: ${c.lineStrong}; }
    .v3-today .timeline .hash-label { position: absolute; top: 8px;
      transform: translateX(-50%); font-family: "JetBrains Mono", monospace;
      font-size: 8.5px; color: ${c.inkDim}; }
    .v3-today .timeline .entry { position: absolute; top: 4px; height: 6px;
      background: ${c.ember}; }
    .v3-today .timeline .now { position: absolute; top: -3px; bottom: 0; width: 1px;
      background: ${c.ember}; }
    .v3-today .timeline .now::before { content: '◆'; position: absolute; top: -10px;
      left: 50%; transform: translateX(-50%); color: ${c.ember}; font-size: 7px; }

    /* Chat sidebar */
    .v3-chat { background: ${c.surface}; display: flex; flex-direction: column;
      border-left: 1px solid ${c.line}; min-height: 0; }
    .v3-chat-top { padding: 22px 22px 18px; border-bottom: 1px solid ${c.line}; }
    .v3-chat-top .name { font-family: "Instrument Serif", serif; font-style: italic;
      font-size: 30px; line-height: 1; color: ${c.ink}; letter-spacing: -.015em; }
    .v3-chat-top .sub { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .v3-chat-top .sub .dot { width: 6px; height: 6px; border-radius: 50%;
      background: ${c.healthy}; box-shadow: 0 0 8px ${c.healthy}; }
    .v3-chat-top .sub .label { color: ${c.inkSoft}; }
    .v3-chat-top .sub .kbd { margin-left: auto; padding: 3px 8px;
      border: 1px solid ${c.line}; font-family: "JetBrains Mono", monospace;
      font-size: 10px; color: ${c.inkSoft}; letter-spacing: .06em; }

    .v3-chat-channels { padding: 12px 20px 10px; display: flex; gap: 6px;
      border-bottom: 1px solid ${c.line}; flex-wrap: wrap; }
    .v3-chat-channels .pill { font-family: "JetBrains Mono", monospace;
      font-size: 9.5px; letter-spacing: .18em; text-transform: uppercase;
      padding: 5px 9px; border: 1px solid transparent; cursor: pointer;
      color: ${c.inkDim}; background: transparent; }
    .v3-chat-channels .pill.active { color: ${c.ink}; border-color: ${c.lineStrong}; }
    .v3-chat-channels .pill.build.active { color: ${c.ember}; border-color: ${c.ember};
      background: rgba(224,133,85,.06); }

    .v3-chat-body { flex: 1; overflow-y: auto; padding: 18px 22px 8px;
      display: flex; flex-direction: column; gap: 18px; min-height: 0; }
    .v3-msg { display: flex; flex-direction: column; gap: 4px; }
    .v3-msg .meta { display: flex; align-items: baseline; gap: 8px;
      font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkDim}; }
    .v3-msg.user .meta b { color: ${c.ink}; font-weight: 400; }
    .v3-msg.assistant .meta b { color: ${c.ember}; font-weight: 400; }
    .v3-msg .body { font-size: 13px; line-height: 1.55; color: ${c.ink};
      white-space: pre-wrap; }
    .v3-msg.user .body { font-family: "Instrument Serif", serif; font-style: italic;
      font-size: 15px; color: ${c.ink}; }
    .v3-msg.terse .body { font-family: "JetBrains Mono", monospace; font-size: 11.5px;
      color: ${c.inkSoft}; }

    .v3-chat-input { border-top: 1px solid ${c.line}; padding: 14px 20px 18px; }
    .v3-chat-input .field { display: flex; align-items: center; gap: 10px;
      padding: 10px 0; border-bottom: 1px solid ${c.lineStrong}; }
    .v3-chat-input .caret { font-family: "Instrument Serif", serif; font-style: italic;
      font-size: 22px; color: ${c.ember}; line-height: 1; }
    .v3-chat-input .typed { flex: 1; font-family: "Instrument Sans", sans-serif;
      font-size: 13px; color: ${c.ink}; }
    .v3-chat-input .cursor { width: 1.5px; height: 16px; background: ${c.ember};
      animation: v3-blink 1.2s steps(2) infinite; }
    @keyframes v3-blink { 50% { opacity: 0; } }
    .v3-chat-input .hint { display: flex; justify-content: space-between;
      margin-top: 10px; font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .18em; text-transform: uppercase; color: ${c.inkDim}; }
  `;

  function Track() {
    return (
      <div className="v3-track">
        <div className="mark">
          <span className="dot"/>
          <span className="name">LifeOS</span>
        </div>
        <div className="div"/>
        <div className="stat">
          <span className="label">Date</span>
          <span className="v">FRI · 22 MAY 2026</span>
        </div>
        <div className="stat">
          <span className="label">Week</span>
          <span className="v">21 / 52</span>
        </div>
        <div className="grow"/>
        <div className="stat">
          <span className="label">Streak</span>
          <span className="v" style={{color: c.ember}}>7 d</span>
        </div>
        <div className="div"/>
        <div className="stat">
          <span className="label">Deep · May</span>
          <span className="v">88 h 03</span>
        </div>
        <div className="div"/>
        <div className="stat">
          <span className="label">YTD</span>
          <span className="v">482 h</span>
        </div>
        <div className="div"/>
        <div className="stat">
          <span className="label">São Paulo</span>
          <span className="v">08:34</span>
        </div>
      </div>
    );
  }

  function Hero() {
    const r = D.RECOMMENDATION;
    const p = D.project(r.project_id);
    return (
      <div className="v3-hero">
        <div className="frame">
          <div className="timestamp">
            <span className="label">Block · next</span>
            <span className="big serif">90′</span>
            <span className="min">09 : 00 → 10 : 30</span>
            <span className="label" style={{color: c.inkDim, marginTop: 4}}>86% confidence</span>
          </div>
          <div className="vrule"/>
          <div className="body">
            <div className="meta">
              <span className="label focus">→ Focus</span>
              <span className="label-strong domain-mark">
                <i style={{background: dom[p.domain]}}/>
                {D.DOMAINS[p.domain].label}
              </span>
              <span className="label" style={{color: c.critical}}>● Due in 3 days</span>
            </div>
            <div className="name serif">{p.name}</div>
            <div className="pitch">
              Untouched <em>six days</em>. Mornings are your strongest creative window —
              block <em>ninety minutes</em> on Act III.
            </div>
            <div className="actions">
              <button className="btn primary">Begin · 90 min</button>
              <button className="btn">Alternate</button>
              <button className="btn" style={{border: 'none', color: c.inkDim, padding: '12px 0'}}>Dismiss</button>
            </div>
            <div className="alts">
              <b>Alts</b> · Substack 60′ <span style={{color: c.inkFaint}}>·</span> Infinitamente 45′
            </div>
          </div>
        </div>
      </div>
    );
  }

  function Horizon() {
    const projects = D.PROJECTS;
    return (
      <div className="v3-horizon">
        <div className="hd">
          <span className="label-strong">Project horizon</span>
          <span className="label">·</span>
          <span className="label">{projects.length} active</span>
          <span className="grow"/>
          <span className="label" style={{color: c.critical}}>● 2 critical</span>
          <span className="label" style={{color: c.attention}}>● 2 attention</span>
          <span className="label" style={{color: c.healthy}}>● 5 healthy</span>
        </div>
        <div className="bars">
          {projects.map((p) => {
            // Health → bar height proportion
            const h = 0.25 + p.health_score * 0.75;
            const color = dom[p.domain];
            return (
              <div className="v3-bar" key={p.id}>
                <div className="stack">
                  <span className={p.health === 'critical' ? 'pulse' : 'health-dot'}
                        style={{background: HEALTH[p.health], color: HEALTH[p.health]}}/>
                  <div className="fill" style={{
                    height: `${h * 100}%`,
                    background: `linear-gradient(to top, ${color} 0%, ${color}55 100%)`,
                    opacity: p.health === 'critical' ? .55 : .9,
                  }}/>
                  <div className="frame"/>
                </div>
                <div className="meta">
                  <span className="nm">{p.name}</span>
                  <span className="hr">{p.hours_week === 0 ? '— h' : D.fmtHM(p.hours_week)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function Today() {
    const totalMin = D.TODAY_ENTRIES.reduce((s, e) => s + e.dur, 0);
    const totalH = totalMin / 60;
    // Timeline 06:00 → 22:00, 16h span
    const startHr = 6, endHr = 22, span = endHr - startHr;
    const minutes = totalMin;
    const nowFrac = (8 + 34/60 - startHr) / span;
    return (
      <div className="v3-today">
        <div className="col">
          <span className="label">Today</span>
          <span className="val num">{Math.floor(totalH)}h {String(Math.round((totalH%1)*60)).padStart(2,'0')}</span>
        </div>
        <div className="timeline">
          <div className="grid">
            {[6, 9, 12, 15, 18, 21].map((h) => {
              const left = ((h - startHr) / span) * 100;
              return (
                <React.Fragment key={h}>
                  <div className="hash major" style={{left: `${left}%`}}/>
                  <div className="hash-label" style={{left: `${left}%`}}>{String(h).padStart(2,'0')}</div>
                </React.Fragment>
              );
            })}
            {[7,8,10,11,13,14,16,17,19,20].map((h) => {
              const left = ((h - startHr) / span) * 100;
              return <div className="hash" key={h} style={{left: `${left}%`}}/>;
            })}
            {/* Today's entries */}
            {D.TODAY_ENTRIES.map((e, i) => {
              const [hh, mm] = e.t.split(':').map(Number);
              const startFrac = ((hh + mm/60) - startHr) / span;
              const widthFrac = (e.dur / 60) / span;
              const colors = { research: dom.research, shallow_work: c.inkSoft, communication: dom.content };
              return <div className="entry" key={i} style={{
                left: `${startFrac * 100}%`, width: `${widthFrac * 100}%`,
                background: colors[e.type] || c.ember,
              }}/>;
            })}
            <div className="now" style={{left: `${nowFrac * 100}%`}}/>
          </div>
        </div>
        <div className="col">
          <span className="label">Plan</span>
          <span className="val num" style={{color: c.inkSoft}}>8h 00</span>
        </div>
        <div className="col">
          <span className="label">Deep ratio</span>
          <span className="val num" style={{color: c.healthy}}>—</span>
        </div>
        <div className="col" style={{minWidth: 130}}>
          <span className="label">Challenge</span>
          <span className="val serif" style={{fontSize: 14, fontStyle: 'italic', color: c.ember, lineHeight: 1.3}}>
            3 deep on Portia · 0/3
          </span>
        </div>
      </div>
    );
  }

  function ChatRail() {
    const channels = ['daily-log', 'project-ops', 'analytics', 'build', 'open'];
    const [active, setActive] = useState('daily-log');
    const thread = D.CHAT.find((c) => c.channel === active) || { messages: [] };
    return (
      <div className="v3-chat">
        <div className="v3-chat-top">
          <div className="name">Codex</div>
          <div className="sub">
            <span className="dot"/>
            <span className="label-strong">Online · listening</span>
            <span className="kbd">⌘ K</span>
          </div>
        </div>
        <div className="v3-chat-channels">
          {channels.map((ch) => (
            <button key={ch} className={`pill ${ch === active ? 'active' : ''} ${ch}`} onClick={() => setActive(ch)}>
              {ch}
            </button>
          ))}
        </div>
        <div className="v3-chat-body">
          {thread.messages.map((m, i) => (
            <div key={i} className={`v3-msg ${m.role} ${m.terse ? 'terse' : ''}`}>
              <div className="meta">
                <b>{m.role === 'user' ? 'You' : 'Codex'}</b>
                <span>·</span>
                <span>{m.t}</span>
              </div>
              <div className="body">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="v3-chat-input">
          <div className="field">
            <span className="caret">›</span>
            <span className="typed">log 90 min on portia, act III draft</span>
            <span className="cursor"/>
          </div>
          <div className="hint">
            <span>Daily-log</span>
            <span>↵ to send</span>
          </div>
        </div>
      </div>
    );
  }

  function V3Noir() {
    return (
      <div className="v3">
        <style>{STYLES}</style>
        <div className="v3-main">
          <Track/>
          <Hero/>
          <Horizon/>
          <Today/>
        </div>
        <ChatRail/>
      </div>
    );
  }

  window.V3Noir = V3Noir;
})();
