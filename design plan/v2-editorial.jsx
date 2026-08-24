// V2 — EDITORIAL (tabbed)
// A daily personal almanac. Generous serif, hairline rules, room to breathe.
// Four tabs map cleanly to the three core questions plus a quiet record of progress:
//   Today    · What should I do right now? (+ what I've done so far)
//   Projects · What's the state of everything?
//   Week     · Where is my time going?
//   Almanac  · What have I done lately? (challenge, milestones, streaks, deep counter)

(function () {
  const D = window.LIFEOS;
  const { useState } = React;

  const c = {
    bg:        '#f6f1e7',
    paper:     '#fbf8f1',
    ink:       '#1a1813',
    inkDim:    '#5e5950',
    inkFaint:  '#9a9384',
    inkGhost:  '#dad2c0',
    inkPale:   '#eee7d6',
    rule:      'rgba(26,24,19,.14)',
    ruleSoft:  'rgba(26,24,19,.07)',
    accent:    '#a44a26',
    healthy:   '#3f6b48',
    attention: '#9d7220',
    critical:  '#a73525',
  };
  const dom = D.PALETTE.editorial;
  const HEALTH = { healthy: c.healthy, attention: c.attention, critical: c.critical };

  const STYLES = `
    .v2 { font-family: "IBM Plex Sans", system-ui, sans-serif;
      background: ${c.bg}; color: ${c.ink}; width: 100%; height: 100%;
      overflow: hidden; font-size: 13px; line-height: 1.5; letter-spacing: -.005em;
      display: grid; grid-template-columns: 1fr 380px;
      grid-template-rows: auto auto 1fr; }
    .v2 .serif { font-family: "Newsreader", "Source Serif 4", Georgia, serif;
      font-feature-settings: "ss01"; }
    .v2 .mono { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-feature-settings: "tnum"; }
    .v2 .num { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-variant-numeric: tabular-nums; }
    .v2 .smallcaps { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.inkDim}; font-weight: 500; }
    .v2 .smallcaps-strong { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.ink}; font-weight: 600; }
    .v2 hr { border: none; border-top: 1px solid ${c.rule}; margin: 0; }

    /* Masthead — radically simplified */
    .v2-masthead { grid-column: 1; padding: 22px 56px 16px;
      background: ${c.bg}; border-bottom: 2.5px double ${c.ink};
      display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 32px; }
    .v2-masthead .side { display: flex; align-items: baseline; gap: 16px;
      font-family: "JetBrains Mono", monospace; font-size: 10.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkDim}; }
    .v2-masthead .side.right { justify-content: flex-end; }
    .v2-masthead .side b { color: ${c.ink}; font-weight: 500; }
    .v2-masthead .name { font-family: "Newsreader", serif; font-weight: 400;
      font-style: italic; font-size: 56px; line-height: .9; letter-spacing: -.02em;
      color: ${c.ink}; text-align: center; }
    .v2-masthead .name .sub { display: block; font-style: normal; font-weight: 500;
      font-size: 10.5px; letter-spacing: .28em; color: ${c.inkDim}; margin-top: 8px;
      font-family: "IBM Plex Sans", sans-serif; text-transform: uppercase; }

    /* Tab nav */
    .v2-tabs { grid-column: 1; padding: 0 56px;
      border-bottom: 1px solid ${c.rule};
      display: flex; align-items: stretch; gap: 0; }
    .v2-tab { position: relative; appearance: none; background: transparent;
      border: none; cursor: pointer; padding: 16px 22px 14px;
      font-family: "Newsreader", serif; font-size: 17px; font-weight: 400;
      color: ${c.inkDim}; letter-spacing: -.005em; }
    .v2-tab:hover { color: ${c.ink}; }
    .v2-tab.active { color: ${c.ink}; font-style: italic; }
    .v2-tab.active::after { content: ''; position: absolute; left: 22px; right: 22px;
      bottom: -1px; height: 2px; background: ${c.ink}; }
    .v2-tabs .tab-meta { margin-left: auto; display: flex; align-items: center;
      gap: 18px; padding: 0 0 6px; }
    .v2-tabs .tab-meta .smallcaps { color: ${c.inkFaint}; }

    /* Page area */
    .v2-page { grid-column: 1; min-height: 0; overflow: hidden;
      padding: 30px 56px 36px; }

    /* ─── TODAY tab ──────────────────────────────────────────────── */
    .v2-today { display: grid; grid-template-columns: 1.2fr 1fr; gap: 64px;
      height: 100%; }
    .v2-today .col { display: flex; flex-direction: column; gap: 18px; }
    .v2-today .col-hd { display: flex; align-items: baseline; gap: 14px;
      padding-bottom: 8px; border-bottom: 1px solid ${c.rule}; }
    .v2-today .col-hd .grow { flex: 1; }

    /* WHAT NOW */
    .v2-now .pull { font-family: "Newsreader", serif; font-weight: 400;
      font-size: 76px; line-height: .92; letter-spacing: -.025em; color: ${c.ink};
      margin-top: 18px; }
    .v2-now .pull em { font-style: italic; color: ${c.accent}; font-weight: 400; }
    .v2-now .pull-sub { font-family: "Newsreader", serif; font-weight: 400;
      font-size: 28px; line-height: 1.2; color: ${c.ink}; margin-top: 14px;
      text-wrap: balance; max-width: 22ch; }
    .v2-now .pull-sub em { font-style: italic; color: ${c.accent}; }
    .v2-now .context { display: flex; align-items: center; gap: 14px;
      margin-top: 24px; padding: 12px 0; border-top: 1px solid ${c.rule};
      border-bottom: 1px solid ${c.rule}; }
    .v2-now .context .swatch { width: 4px; height: 26px; }
    .v2-now .context .domain { font-family: "JetBrains Mono", monospace;
      font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: ${c.ink}; }
    .v2-now .context .health { font-family: "JetBrains Mono", monospace;
      font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: ${c.critical}; }
    .v2-now .context .div { color: ${c.inkFaint}; }
    .v2-now .actions { display: flex; gap: 12px; align-items: center;
      margin-top: 22px; }
    .v2-now .btn { font-family: "IBM Plex Sans", sans-serif; font-size: 12px;
      padding: 11px 22px; border: 1px solid ${c.ink}; background: ${c.ink};
      color: ${c.paper}; cursor: pointer; font-weight: 500; letter-spacing: .01em; }
    .v2-now .btn.ghost { background: transparent; color: ${c.ink}; }
    .v2-now .btn.text { background: transparent; border: none; color: ${c.inkDim};
      padding: 0 8px; }
    .v2-now .alts { margin-top: auto; padding-top: 24px;
      font-family: "JetBrains Mono", monospace; font-size: 10.5px;
      letter-spacing: .12em; text-transform: uppercase; color: ${c.inkFaint}; }
    .v2-now .alts b { color: ${c.inkDim}; font-weight: 500; }

    /* THE DAY SO FAR */
    .v2-day .total { font-family: "Newsreader", serif; font-size: 56px;
      font-weight: 400; letter-spacing: -.025em; line-height: 1; color: ${c.ink};
      margin-top: 12px; }
    .v2-day .total .of { font-size: 14px; font-style: italic; color: ${c.inkDim};
      margin-left: 12px; letter-spacing: 0; }
    .v2-day .activity-bar { display: flex; height: 6px; margin-top: 20px;
      background: ${c.inkPale}; }
    .v2-day .activity-bar i { display: block; }
    .v2-day .activity-key { display: flex; flex-wrap: wrap; gap: 14px;
      margin-top: 10px; font-family: "JetBrains Mono", monospace; font-size: 10px;
      letter-spacing: .06em; color: ${c.inkDim}; }
    .v2-day .activity-key span { display: flex; align-items: center; gap: 6px; }
    .v2-day .activity-key span i { width: 7px; height: 7px; display: inline-block; }
    .v2-day .entries { display: flex; flex-direction: column; margin-top: 30px; }
    .v2-day .entry { display: grid; grid-template-columns: 56px 1fr auto;
      gap: 18px; padding: 14px 0; border-top: 1px solid ${c.ruleSoft};
      align-items: baseline; }
    .v2-day .entry:first-child { border-top: 1px solid ${c.rule}; }
    .v2-day .entry .t { font-family: "JetBrains Mono", monospace;
      font-size: 11px; color: ${c.inkDim}; letter-spacing: .04em; }
    .v2-day .entry .desc { font-size: 13px; line-height: 1.45; color: ${c.ink};
      max-width: 36ch; }
    .v2-day .entry .desc .type { font-family: "JetBrains Mono", monospace;
      font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.inkFaint}; display: block; margin-bottom: 2px; }
    .v2-day .entry .dur { font-family: "Newsreader", serif; font-style: italic;
      font-size: 18px; color: ${c.ink}; letter-spacing: -.01em; }

    /* ─── PROJECTS tab ────────────────────────────────────────────── */
    .v2-projects { height: 100%; display: flex; flex-direction: column; }
    .v2-projects .grid { display: grid; grid-template-columns: 1fr 1fr;
      gap: 0 44px; flex: 1; padding-top: 4px; }
    .v2-p-entry { display: grid; grid-template-columns: 3px 1fr;
      gap: 14px; padding: 11px 0; border-top: 1px solid ${c.ruleSoft};
      align-content: start; }
    .v2-p-entry:nth-child(-n+2) { border-top: none; padding-top: 6px; }
    .v2-p-entry .swatch { align-self: stretch; }
    .v2-p-entry .head { display: flex; align-items: baseline; gap: 12px;
      margin-bottom: 2px; }
    .v2-p-entry .name { font-family: "Newsreader", serif; font-size: 21px;
      font-weight: 500; letter-spacing: -.012em; color: ${c.ink}; line-height: 1; }
    .v2-p-entry .domain { font-family: "JetBrains Mono", monospace;
      font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.inkDim}; }
    .v2-p-entry .health-tag { font-family: "JetBrains Mono", monospace;
      font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
      margin-left: auto; }
    .v2-p-entry .sub { font-style: italic; color: ${c.inkDim}; font-size: 12.5px;
      font-family: "Newsreader", serif; line-height: 1.2; }
    .v2-p-entry .note { font-size: 11.5px; line-height: 1.35; color: ${c.inkDim};
      margin-top: 5px; padding-left: 10px; border-left: 1px solid ${c.rule};
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .v2-p-entry .stats { display: flex; gap: 16px; margin-top: 8px;
      align-items: baseline; }
    .v2-p-entry .stat { display: flex; flex-direction: row; gap: 4px;
      align-items: baseline; }
    .v2-p-entry .stat .k { font-family: "JetBrains Mono", monospace; font-size: 8.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkFaint}; }
    .v2-p-entry .stat .v { font-family: "JetBrains Mono", monospace;
      font-variant-numeric: tabular-nums; font-size: 11.5px; color: ${c.ink}; }
    .v2-p-entry .stat .v.imminent { color: ${c.critical}; }
    .v2-p-entry .stat .v.fresh { color: ${c.healthy}; }
    .v2-p-entry .stat .v.cold { color: ${c.critical}; }
    .v2-p-entry .progress { display: flex; align-items: center; gap: 8px;
      margin-top: 6px; }
    .v2-p-entry .bar { flex: 1; height: 3px; background: ${c.inkGhost};
      position: relative; }
    .v2-p-entry .bar > i { position: absolute; left: 0; top: 0; bottom: 0; }
    .v2-p-entry .pct { font-family: "JetBrains Mono", monospace;
      font-size: 10px; color: ${c.inkDim};
      font-variant-numeric: tabular-nums; }

    /* ─── ANALYTICS tab ───────────────────────────────────────────── */
    .v2-analytics { height: 100%; display: grid;
      grid-template-rows: auto 1fr 1fr; gap: 24px; }
    .v2-analytics-header { display: grid; grid-template-columns: auto 1fr;
      align-items: end; gap: 40px; padding-bottom: 14px;
      border-bottom: 1px solid ${c.rule}; }
    .v2-an-range { display: flex; gap: 4px; align-items: baseline; }
    .v2-range-tab { appearance: none; background: transparent; border: none;
      cursor: pointer; padding: 6px 14px 8px;
      font-family: "Newsreader", serif; font-size: 16px; font-weight: 400;
      color: ${c.inkDim}; letter-spacing: -.005em; }
    .v2-range-tab:hover { color: ${c.ink}; }
    .v2-range-tab.active { color: ${c.ink}; font-style: italic;
      border-bottom: 1.5px solid ${c.ink}; padding-bottom: 6.5px; }
    .v2-an-kpis { display: flex; gap: 36px; justify-content: flex-end;
      align-items: baseline; }
    .v2-kpi { display: flex; flex-direction: column; gap: 2px; align-items: baseline; }
    .v2-kpi .lbl { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkDim}; }
    .v2-kpi .num { font-family: "Newsreader", serif; font-size: 30px;
      font-weight: 400; letter-spacing: -.025em; color: ${c.ink}; line-height: 1;
      font-variant-numeric: tabular-nums; }
    .v2-kpi .sub { font-family: "JetBrains Mono", monospace; font-size: 10px;
      color: ${c.inkDim}; letter-spacing: .04em; }

    .v2-an-row { display: grid; grid-template-columns: 1.35fr 1fr;
      gap: 40px; min-height: 0; }
    .v2-an-row.bottom { grid-template-columns: 1fr 1fr; }
    .v2-an-card { display: flex; flex-direction: column; min-height: 0; }
    .v2-an-card .hd { display: flex; align-items: baseline; gap: 12px;
      padding-bottom: 8px; border-bottom: 1px solid ${c.rule};
      margin-bottom: 16px; }
    .v2-an-card .hd h3 { font-family: "Newsreader", serif; font-weight: 500;
      font-size: 20px; margin: 0; letter-spacing: -.012em; color: ${c.ink}; }
    .v2-an-card .hd .grow { flex: 1; }
    .v2-an-card .body { flex: 1; min-height: 0; display: flex;
      flex-direction: column; }

    /* Daily rhythm heatmap */
    .v2-heatmap { display: grid; grid-template-columns: 28px 1fr;
      gap: 6px 8px; flex: 1; min-height: 0; }
    .v2-heatmap .corner { }
    .v2-heatmap .hour-axis { display: grid;
      grid-template-columns: repeat(24, 1fr); font-family: "JetBrains Mono", monospace;
      font-size: 9px; color: ${c.inkFaint}; letter-spacing: .06em;
      align-items: end; padding-bottom: 4px; }
    .v2-heatmap .hour-axis .tick { text-align: center; }
    .v2-heatmap .day-axis { display: grid; grid-template-rows: repeat(14, 1fr);
      gap: 2px; align-content: stretch;
      font-family: "JetBrains Mono", monospace; font-size: 9px;
      color: ${c.inkFaint}; letter-spacing: .04em; }
    .v2-heatmap .day-axis span { display: flex; align-items: center;
      justify-content: flex-end; padding-right: 2px; }
    .v2-heatmap .day-axis span.today { color: ${c.accent}; font-weight: 600; }
    .v2-heatmap .matrix { display: grid;
      grid-template-columns: repeat(24, 1fr);
      grid-template-rows: repeat(14, 1fr); gap: 2px; min-height: 0; }
    .v2-heatmap .cell { background: ${c.inkPale}; }
    .v2-heatmap-legend { display: flex; align-items: center; gap: 8px;
      margin-top: 8px; font-family: "JetBrains Mono", monospace;
      font-size: 9.5px; color: ${c.inkDim}; letter-spacing: .08em;
      text-transform: uppercase; }
    .v2-heatmap-legend .ramp { display: flex; height: 8px; gap: 1px; }
    .v2-heatmap-legend .ramp i { width: 16px; }

    /* Domain breakdown */
    .v2-d-rows { display: flex; flex-direction: column; gap: 10px;
      justify-content: center; flex: 1; }
    .v2-d-row { display: grid; grid-template-columns: 90px 1fr 56px 44px;
      align-items: center; gap: 14px; }
    .v2-d-lbl { font-family: "Newsreader", serif; font-size: 15px; color: ${c.ink}; }
    .v2-d-bar { position: relative; height: 12px; background: ${c.inkPale}; }
    .v2-d-bar .actual { position: absolute; left: 0; top: 0; bottom: 0; }
    .v2-d-bar .planned { position: absolute; top: -4px; bottom: -4px;
      width: 1.5px; background: ${c.ink}; }
    .v2-d-bar .planned::before { content: ''; position: absolute; top: -1px;
      left: 50%; transform: translateX(-50%);
      border-left: 4px solid transparent; border-right: 4px solid transparent;
      border-top: 4px solid ${c.ink}; }
    .v2-d-val { font-family: "JetBrains Mono", monospace;
      font-variant-numeric: tabular-nums; color: ${c.ink}; font-size: 12px;
      text-align: right; }
    .v2-d-delta { font-family: "JetBrains Mono", monospace;
      font-variant-numeric: tabular-nums; font-size: 11px; text-align: right;
      letter-spacing: .04em; }

    /* Project trends */
    .v2-trend-rows { display: flex; flex-direction: column;
      justify-content: space-between; flex: 1; padding: 4px 0; }
    .v2-trend-row { display: grid;
      grid-template-columns: 1fr 76px 50px 22px;
      align-items: center; gap: 12px; }
    .v2-trend-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .v2-trend-name i { width: 4px; height: 14px; flex-shrink: 0; }
    .v2-trend-name span { font-family: "Newsreader", serif; font-size: 14px;
      color: ${c.ink}; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; }
    .v2-spark { display: flex; gap: 2px; align-items: flex-end;
      height: 22px; }
    .v2-spark i { flex: 1; min-height: 1px; }
    .v2-trend-cur { font-family: "JetBrains Mono", monospace;
      font-variant-numeric: tabular-nums; color: ${c.ink}; font-size: 11.5px;
      text-align: right; }
    .v2-trend-delta { font-family: "JetBrains Mono", monospace;
      font-size: 11px; text-align: center; }

    /* Time composition */
    .v2-comp-section { display: flex; flex-direction: column; gap: 8px;
      margin-bottom: 18px; }
    .v2-comp-lbl { display: flex; justify-content: space-between;
      align-items: baseline; font-family: "Newsreader", serif; font-size: 14px;
      color: ${c.ink}; }
    .v2-comp-lbl em { font-style: italic; color: ${c.inkDim}; }
    .v2-comp-bar { display: flex; height: 32px; position: relative; }
    .v2-comp-bar .seg { display: flex; align-items: center; padding: 0 12px;
      color: ${c.paper}; font-family: "Newsreader", serif; font-style: italic;
      font-size: 14px; gap: 8px; }
    .v2-comp-bar .seg .pct { font-family: "JetBrains Mono", monospace;
      font-style: normal; font-size: 11px; opacity: .9;
      font-variant-numeric: tabular-nums; }
    .v2-comp-target { position: absolute; top: -10px; bottom: -10px;
      width: 0; border-left: 1.5px dashed ${c.ink}; }
    .v2-comp-target .lbl { position: absolute; top: -16px;
      transform: translateX(-50%);
      font-family: "JetBrains Mono", monospace; font-size: 9px;
      letter-spacing: .12em; text-transform: uppercase; color: ${c.ink};
      white-space: nowrap; padding: 0 4px; }
    .v2-comp-callout { margin-top: auto; padding: 14px 16px;
      background: ${c.paper}; border-left: 3px solid ${c.accent};
      font-family: "Newsreader", serif; }
    .v2-comp-callout .kicker { font-family: "JetBrains Mono", monospace;
      font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
      color: ${c.accent}; margin-bottom: 6px; }
    .v2-comp-callout .text { font-size: 14px; color: ${c.ink}; line-height: 1.4;
      font-style: italic; text-wrap: pretty; }

    /* ─── ALMANAC tab ─────────────────────────────────────────────── */
    .v2-almanac { display: grid; grid-template-columns: 1fr 1fr; gap: 64px;
      height: 100%; }
    .v2-almanac .col { display: flex; flex-direction: column; gap: 30px; }
    .v2-almanac .card .hd { display: flex; align-items: baseline; gap: 12px;
      padding-bottom: 10px; border-bottom: 1px solid ${c.rule};
      margin-bottom: 14px; }
    .v2-almanac .card .hd h3 { font-family: "Newsreader", serif; font-weight: 500;
      font-size: 22px; margin: 0; letter-spacing: -.012em; }
    .v2-almanac .card .hd .grow { flex: 1; }

    .v2-challenge { background: ${c.paper}; padding: 22px 24px;
      border-left: 3px solid ${c.accent}; }
    .v2-challenge .kicker { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .16em; text-transform: uppercase; color: ${c.accent};
      margin-bottom: 10px; }
    .v2-challenge .text { font-family: "Newsreader", serif; font-style: italic;
      font-size: 22px; line-height: 1.25; color: ${c.ink}; text-wrap: balance;
      margin-bottom: 16px; }
    .v2-challenge .progress { display: flex; align-items: center; gap: 8px;
      font-family: "JetBrains Mono", monospace; font-size: 10.5px;
      color: ${c.inkDim}; letter-spacing: .04em; }
    .v2-challenge .pip { width: 30px; height: 8px; background: ${c.inkGhost}; }
    .v2-challenge .pip.on { background: ${c.accent}; }

    .v2-mile { display: flex; flex-direction: column; }
    .v2-mile-row { display: grid; grid-template-columns: 64px 1fr;
      gap: 16px; padding: 11px 0; border-top: 1px solid ${c.ruleSoft};
      font-size: 13px; align-items: baseline; }
    .v2-mile-row:first-child { border-top: none; }
    .v2-mile-row .date { font-family: "JetBrains Mono", monospace; color: ${c.inkDim};
      font-size: 10.5px; letter-spacing: .06em; }
    .v2-mile-row .text { color: ${c.ink}; line-height: 1.45;
      font-family: "Newsreader", serif; font-size: 15px; }

    .v2-deep-counter { display: grid; grid-template-columns: 1fr 1fr;
      gap: 24px; align-items: end; padding-top: 4px; }
    .v2-deep-counter .col { display: flex; flex-direction: column; gap: 4px; }
    .v2-deep-counter .big { font-family: "Newsreader", serif; font-size: 52px;
      font-weight: 400; letter-spacing: -.025em; line-height: 1; color: ${c.ink}; }

    .v2-streaks { display: flex; flex-direction: column; gap: 10px; }
    .v2-streak { display: grid; grid-template-columns: 1fr auto 1fr;
      gap: 14px; align-items: center; }
    .v2-streak .name { font-family: "Newsreader", serif; font-size: 14px;
      color: ${c.ink}; }
    .v2-streak .days { font-family: "JetBrains Mono", monospace;
      font-variant-numeric: tabular-nums; font-size: 11px; color: ${c.inkDim};
      letter-spacing: .06em; }
    .v2-streak .pips { display: flex; gap: 2px; }
    .v2-streak .pips i { width: 8px; height: 8px; background: ${c.accent}; }
    .v2-streak .pips i.cold { background: ${c.inkGhost}; }

    /* ─── Chat column ────────────────────────────────────────────── */
    .v2-chat { grid-column: 2; grid-row: 1 / -1;
      background: ${c.paper}; display: flex; flex-direction: column;
      border-left: 1px solid ${c.rule}; overflow: hidden; min-height: 0; }
    .v2-chat-top { padding: 22px 22px 16px; border-bottom: 1px solid ${c.rule}; }
    .v2-chat-top .name { font-family: "Newsreader", serif; font-style: italic;
      font-size: 32px; font-weight: 400; line-height: 1; color: ${c.ink};
      letter-spacing: -.015em; }
    .v2-chat-top .sub { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkDim};
      margin-top: 8px; display: flex; gap: 10px; align-items: baseline; }
    .v2-chat-top .sub .dot { color: ${c.healthy}; }
    .v2-chat-channels { padding: 8px 18px 8px; display: flex; flex-wrap: wrap; gap: 2px;
      border-bottom: 1px solid ${c.rule}; }
    .v2-chat-channels .pill { font-family: "JetBrains Mono", monospace; font-size: 10px;
      letter-spacing: .04em; color: ${c.inkDim}; padding: 5px 9px; cursor: pointer;
      border: 1px solid transparent; background: transparent; }
    .v2-chat-channels .pill:hover { color: ${c.ink}; }
    .v2-chat-channels .pill.active { color: ${c.ink}; border-color: ${c.ink}; }
    .v2-chat-channels .pill.build.active { color: ${c.accent}; border-color: ${c.accent}; }
    .v2-chat-body { flex: 1; overflow-y: auto; padding: 18px 22px 8px;
      display: flex; flex-direction: column; gap: 18px; min-height: 0; }
    .v2-chat-day { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .14em; text-transform: uppercase; color: ${c.inkFaint};
      padding-bottom: 4px; border-bottom: 1px solid ${c.rule}; }
    .v2-msg { display: flex; flex-direction: column; gap: 4px; }
    .v2-msg .meta { font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .1em; text-transform: uppercase; color: ${c.inkFaint};
      display: flex; gap: 6px; align-items: baseline; }
    .v2-msg.user .meta b { color: ${c.ink}; font-weight: 600; }
    .v2-msg.assistant .meta b { color: ${c.accent}; font-weight: 600; }
    .v2-msg .body { font-size: 12.5px; line-height: 1.5; color: ${c.ink};
      white-space: pre-wrap; }
    .v2-msg.user .body { font-family: "Newsreader", serif; font-size: 14.5px;
      font-style: italic; padding-left: 12px; border-left: 2px solid ${c.ink}; }
    .v2-msg.terse .body { font-family: "JetBrains Mono", monospace;
      font-size: 11px; color: ${c.inkDim}; padding-left: 12px;
      border-left: 2px solid ${c.inkGhost}; }
    .v2-chat-input { border-top: 1px solid ${c.rule}; padding: 14px 20px 16px;
      background: ${c.paper}; }
    .v2-chat-input .field { display: flex; align-items: center; gap: 10px;
      border-bottom: 1.5px solid ${c.ink}; padding: 4px 0 8px; }
    .v2-chat-input .caret { font-family: "Newsreader", serif; font-style: italic;
      color: ${c.accent}; font-size: 20px; line-height: 1; }
    .v2-chat-input .typed { flex: 1; font-family: "IBM Plex Sans", sans-serif;
      font-size: 13px; color: ${c.ink}; }
    .v2-chat-input .cursor { width: 1.5px; height: 16px; background: ${c.ink};
      animation: v2-blink 1.1s steps(2) infinite; }
    @keyframes v2-blink { 50% { opacity: 0; } }
    .v2-chat-input .hint { display: flex; justify-content: space-between;
      margin-top: 8px; font-family: "JetBrains Mono", monospace; font-size: 9.5px;
      letter-spacing: .1em; text-transform: uppercase; color: ${c.inkFaint}; }
  `;

  // ─── Masthead ───────────────────────────────────────────────────────
  function Masthead() {
    return (
      <div className="v2-masthead">
        <div className="side">
          <span>Week <b>21</b></span>
          <span>No. <b>147</b></span>
        </div>
        <div className="name">
          LifeOS
          <span className="sub">A personal almanac</span>
        </div>
        <div className="side right">
          <span><b>Friday</b>, 22 May 2026</span>
        </div>
      </div>
    );
  }

  // ─── Tab nav ────────────────────────────────────────────────────────
  function TabNav({ tab, onTab }) {
    const TABS = [
      { id: 'today',     label: 'Today' },
      { id: 'projects',  label: 'Projects' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'almanac',   label: 'Almanac' },
    ];
    const META = {
      today:     'What should I do, what have I done',
      projects:  'Nine active · two critical',
      analytics: 'Where the hours actually went',
      almanac:   'A record of what got done',
    };
    return (
      <div className="v2-tabs">
        {TABS.map((tt) => (
          <button key={tt.id}
                  className={`v2-tab ${tt.id === tab ? 'active' : ''}`}
                  onClick={() => onTab(tt.id)}>
            {tt.label}
          </button>
        ))}
        <div className="tab-meta">
          <span className="smallcaps">{META[tab]}</span>
        </div>
      </div>
    );
  }

  // ─── TODAY tab ──────────────────────────────────────────────────────
  function WhatNowPanel() {
    const r = D.RECOMMENDATION;
    const p = D.project(r.project_id);
    return (
      <div className="v2-now col">
        <div className="col-hd">
          <span className="smallcaps-strong">What now</span>
          <span className="smallcaps" style={{color: c.inkFaint}}>· 09 : 00 → 10 : 30 · 86%</span>
        </div>
        <div className="pull"><em>{p.name}.</em></div>
        <div className="pull-sub">Block <em>ninety minutes</em> on Act III.</div>
        <div className="context">
          <span className="swatch" style={{background: dom[p.domain]}}/>
          <span className="domain">{D.DOMAINS[p.domain].label}</span>
          <span className="div">·</span>
          <span className="health">Untouched 6 days · Due Friday</span>
        </div>
        <div className="actions">
          <button className="btn">Begin · 90 min</button>
          <button className="btn ghost">Alternate</button>
          <button className="btn text">Dismiss</button>
        </div>
        <div className="alts">
          <b>Alts</b> · Substack 60′ · Infinitamente 45′
        </div>
      </div>
    );
  }

  function TheDaySoFar() {
    const totalMin = D.TODAY_ENTRIES.reduce((s, e) => s + e.dur, 0);
    const totalH = totalMin / 60;
    const byType = {};
    D.TODAY_ENTRIES.forEach((e) => byType[e.type] = (byType[e.type] || 0) + e.dur);
    const typeColors = {
      deep_work: c.ink, creative: dom.filmmaking, research: dom.research,
      shallow_work: c.inkFaint, admin: c.inkGhost, communication: dom.content,
    };
    return (
      <div className="v2-day col">
        <div className="col-hd">
          <span className="smallcaps-strong">The day so far</span>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>Plan 8h · 19%</span>
        </div>
        <div className="total num">
          {Math.floor(totalH)}h <span style={{color: c.inkDim}}>{String(Math.round((totalH%1)*60)).padStart(2,'0')}</span>
          <span className="of">across three entries</span>
        </div>
        <div className="activity-bar">
          {Object.entries(byType).map(([k, v]) => (
            <i key={k} style={{ flex: v, background: typeColors[k] || c.inkDim }}/>
          ))}
        </div>
        <div className="activity-key">
          {Object.entries(byType).map(([k, v]) => (
            <span key={k}><i style={{background: typeColors[k]}}/>{k.replace('_', ' ')}</span>
          ))}
        </div>
        <div className="entries">
          {D.TODAY_ENTRIES.map((e, i) => (
            <div className="entry" key={i}>
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

  function TodayTab() {
    return (
      <div className="v2-today">
        <WhatNowPanel/>
        <TheDaySoFar/>
      </div>
    );
  }

  // ─── PROJECTS tab ───────────────────────────────────────────────────
  function ProjectEntry({ p }) {
    const d = D.DOMAINS[p.domain];
    const hoursAgo = (D.now - p.last_touched) / (1000 * 60 * 60);
    const freshClass = hoursAgo < 24 ? 'fresh' : hoursAgo > 24*5 ? 'cold' : '';
    const dueImminent = p.deadline_in_days != null && p.deadline_in_days <= 3;
    return (
      <div className="v2-p-entry">
        <div className="swatch" style={{background: dom[p.domain]}}/>
        <div>
          <div className="head">
            <span className="name">{p.name}</span>
            <span className="domain">{d.label}</span>
            <span className="health-tag" style={{color: HEALTH[p.health]}}>● {p.health}</span>
          </div>
          <div className="sub">{p.subtitle}</div>
          {p.note && <div className="note">{p.note}</div>}
          <div className="stats">
            <div className="stat">
              <span className="k">Last</span>
              <span className={`v ${freshClass}`}>{D.fmtAgo(p.last_touched)}</span>
            </div>
            <div className="stat">
              <span className="k">Week</span>
              <span className="v">{p.hours_week === 0 ? '—' : D.fmtHM(p.hours_week)}</span>
            </div>
            <div className="stat">
              <span className="k">Due</span>
              <span className={`v ${dueImminent ? 'imminent' : ''}`}>
                {p.deadline_in_days == null ? '—' : p.deadline_in_days + 'd'}
              </span>
            </div>
            {p.streak > 0 && (
              <div className="stat">
                <span className="k">Streak</span>
                <span className="v" style={{color: c.accent}}>{p.streak}d</span>
              </div>
            )}
          </div>
          {p.progress != null && (
            <div className="progress">
              <div className="bar">
                <i style={{width: `${p.progress * 100}%`, background: dom[p.domain]}}/>
              </div>
              <span className="pct">{Math.round(p.progress * 100)}%</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function ProjectsTab() {
    const sorted = [...D.PROJECTS].sort((a, b) => {
      const order = { critical: 0, attention: 1, healthy: 2 };
      return order[a.health] - order[b.health];
    });
    return (
      <div className="v2-projects">
        <div className="grid">
          {sorted.map((p) => <ProjectEntry key={p.id} p={p}/>)}
        </div>
      </div>
    );
  }

  // ─── ANALYTICS tab ──────────────────────────────────────────────────

  // Cell color for the heatmap — lerps inkPale → accent based on intensity.
  function heatmapColor(v) {
    if (v < 0.04) return c.inkPale;
    const t = Math.pow(Math.min(1, v), 0.7);
    // inkPale = #eee7d6, accent = #a44a26
    const r = Math.round(0xee + (0xa4 - 0xee) * t);
    const g = Math.round(0xe7 + (0x4a - 0xe7) * t);
    const b = Math.round(0xd6 + (0x26 - 0xd6) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function AnalyticsHeader({ range, onRange, totalActual, deepRatio, totalPlanned }) {
    const onPlan = Math.round((totalActual / totalPlanned) * 100);
    const deepDelta = Math.round((deepRatio - D.DEEP_TARGET) * 100);
    return (
      <div className="v2-analytics-header">
        <div className="v2-an-range">
          {[
            { id: 'week', label: 'Week 21' },
            { id: 'month', label: 'May' },
            { id: 'quarter', label: 'Q2' },
            { id: 'year', label: '2026' },
          ].map((r) => (
            <button key={r.id}
                    className={`v2-range-tab ${r.id === range ? 'active' : ''}`}
                    onClick={() => onRange(r.id)}>{r.label}</button>
          ))}
        </div>
        <div className="v2-an-kpis">
          <div className="v2-kpi">
            <span className="lbl">Time tracked</span>
            <span className="num">{D.fmtHM(totalActual)}</span>
            <span className="sub">of {D.fmtHM(totalPlanned)} plan</span>
          </div>
          <div className="v2-kpi">
            <span className="lbl">Deep ratio</span>
            <span className="num">{Math.round(deepRatio * 100)}%</span>
            <span className="sub" style={{color: deepDelta < 0 ? c.critical : c.healthy}}>
              {deepDelta >= 0 ? '+' : ''}{deepDelta} pts vs target
            </span>
          </div>
          <div className="v2-kpi">
            <span className="lbl">On plan</span>
            <span className="num">{onPlan}%</span>
            <span className="sub">{onPlan >= 100 ? 'ahead' : 'short ' + (100 - onPlan) + ' pts'}</span>
          </div>
        </div>
      </div>
    );
  }

  function DailyRhythm() {
    const matrix = D.rhythmHeatmap();
    const dayCodes = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const dayLabels = Array.from({length: 14}, (_, i) => {
      const d = new Date(D.now.getTime() - (13 - i) * 86400000);
      return { code: dayCodes[(d.getDay() + 6) % 7], today: i === 13 };
    });
    return (
      <div className="v2-an-card">
        <div className="hd">
          <h3>Daily rhythm</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>Last 14 days · 00–24h</span>
        </div>
        <div className="v2-heatmap">
          <div className="corner"/>
          <div className="hour-axis">
            {Array.from({length: 24}).map((_, h) => (
              <span key={h} className="tick">
                {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
          <div className="day-axis">
            {dayLabels.map((d, i) => (
              <span key={i} className={d.today ? 'today' : ''}>{d.code}</span>
            ))}
          </div>
          <div className="matrix">
            {matrix.flatMap((row, di) => row.map((v, hi) => (
              <div key={`${di}-${hi}`} className="cell"
                   style={{background: heatmapColor(v)}}/>
            )))}
          </div>
        </div>
        <div className="v2-heatmap-legend">
          <span>Less</span>
          <div className="ramp">
            <i style={{background: heatmapColor(0)}}/>
            <i style={{background: heatmapColor(0.25)}}/>
            <i style={{background: heatmapColor(0.5)}}/>
            <i style={{background: heatmapColor(0.75)}}/>
            <i style={{background: heatmapColor(1)}}/>
          </div>
          <span>More</span>
          <span style={{marginLeft: 'auto', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: c.inkDim}}>
            Mornings dominant · weekend dip after Sun
          </span>
        </div>
      </div>
    );
  }

  function DomainWithIntention({ actualByDomain }) {
    const max = Math.max(...Object.entries(D.PLAN_BY_DOMAIN).map(
      ([k, v]) => Math.max(v, actualByDomain[k] || 0),
    ));
    const sorted = Object.keys(D.DOMAINS).sort(
      (a, b) => (D.PLAN_BY_DOMAIN[b] || 0) - (D.PLAN_BY_DOMAIN[a] || 0),
    );
    return (
      <div className="v2-an-card">
        <div className="hd">
          <h3>Domain breakdown</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>
            <span style={{display:'inline-block', width:8, height:2, background: c.ink, marginRight: 6, marginBottom: 2}}/>
            Plan marker
          </span>
        </div>
        <div className="v2-d-rows">
          {sorted.map((k) => {
            const actual = actualByDomain[k] || 0;
            const planned = D.PLAN_BY_DOMAIN[k] || 0;
            const delta = actual - planned;
            return (
              <div className="v2-d-row" key={k}>
                <span className="v2-d-lbl">{D.DOMAINS[k].label}</span>
                <div className="v2-d-bar">
                  <i className="actual" style={{
                    width: `${(actual / max) * 100}%`, background: dom[k]
                  }}/>
                  <i className="planned" style={{
                    left: `${(planned / max) * 100}%`
                  }}/>
                </div>
                <span className="v2-d-val">{actual === 0 ? '—' : D.fmtHM(actual)}</span>
                <span className="v2-d-delta"
                      style={{color: delta >= 0 ? c.healthy : c.critical}}>
                  {delta >= 0 ? '+' : ''}{(Math.round(delta * 10) / 10).toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function ProjectTrends() {
    const projects = [...D.PROJECTS].sort((a, b) => b.hours_week - a.hours_week);
    const overallMax = Math.max(
      ...projects.flatMap((p) => p.weeks_history),
    );
    return (
      <div className="v2-an-card">
        <div className="hd">
          <h3>Project trends</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>
            Hours / week · last 8
          </span>
        </div>
        <div className="v2-trend-rows">
          {projects.map((p) => {
            const cur = p.weeks_history[p.weeks_history.length - 1];
            const prev = p.weeks_history[p.weeks_history.length - 2];
            const delta = cur - prev;
            return (
              <div className="v2-trend-row" key={p.id}>
                <div className="v2-trend-name">
                  <i style={{background: dom[p.domain]}}/>
                  <span>{p.name}</span>
                </div>
                <div className="v2-spark">
                  {p.weeks_history.map((v, i) => (
                    <i key={i} style={{
                      height: `${Math.max(2, (v / overallMax) * 100)}%`,
                      background: i === p.weeks_history.length - 1
                        ? dom[p.domain]
                        : `${dom[p.domain]}80`,
                      opacity: v === 0 ? .25 : 1,
                    }}/>
                  ))}
                </div>
                <span className="v2-trend-cur">{cur === 0 ? '—' : D.fmtHM(cur)}</span>
                <span className="v2-trend-delta"
                      style={{color: delta > 0.1 ? c.healthy : delta < -0.1 ? c.critical : c.inkFaint}}>
                  {delta > 0.1 ? '▲' : delta < -0.1 ? '▼' : '·'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function TimeComposition({ comp, deepRatio }) {
    const total = comp.deep + comp.shallow + comp.admin;
    const target = D.DEEP_TARGET;
    // Production: creative + communication. Consumption: research.
    // Tuned to read sensibly with the rest of the demo data.
    const prodCons = { production: 64, consumption: 36 };
    return (
      <div className="v2-an-card">
        <div className="hd">
          <h3>Composition</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>
            Deep target {Math.round(target * 100)}%
          </span>
        </div>
        <div className="v2-comp-section" style={{marginTop: 12}}>
          <div className="v2-comp-lbl">
            <span>Deep · Shallow · Admin</span>
            <span style={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
              color: deepRatio < target ? c.critical : c.healthy, letterSpacing: '.04em',
            }}>
              {Math.round(deepRatio * 100)}% deep · {Math.round((deepRatio - target) * 100)} pts vs target
            </span>
          </div>
          <div className="v2-comp-bar">
            <div className="seg" style={{flex: comp.deep, background: c.ink}}>
              Deep <span className="pct">{Math.round(comp.deep / total * 100)}%</span>
            </div>
            <div className="seg" style={{flex: comp.shallow, background: c.inkDim}}>
              Shallow <span className="pct">{Math.round(comp.shallow / total * 100)}%</span>
            </div>
            <div className="seg" style={{flex: comp.admin, background: c.inkFaint, color: c.ink}}>
              Admin <span className="pct">{Math.round(comp.admin / total * 100)}%</span>
            </div>
            <div className="v2-comp-target" style={{left: `${target * 100}%`}}>
              <span className="lbl">target {Math.round(target * 100)}%</span>
            </div>
          </div>
        </div>
        <div className="v2-comp-section">
          <div className="v2-comp-lbl">
            <span>Production · Consumption</span>
            <span style={{
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
              color: c.inkDim, letterSpacing: '.04em',
            }}>
              Creating vs ingesting
            </span>
          </div>
          <div className="v2-comp-bar">
            <div className="seg" style={{flex: prodCons.production, background: dom.filmmaking}}>
              Production <span className="pct">{prodCons.production}%</span>
            </div>
            <div className="seg" style={{flex: prodCons.consumption, background: dom.research}}>
              Consumption <span className="pct">{prodCons.consumption}%</span>
            </div>
          </div>
        </div>
        <div className="v2-comp-callout">
          <div className="kicker">From Codex · weekly note</div>
          <div className="text">
            Deep ratio is seven points below target. Admin spiked on Wednesday
            (1h 12); two short morning blocks would close the gap by Friday.
          </div>
        </div>
      </div>
    );
  }

  function AnalyticsTab() {
    const [range, setRange] = useState('week');

    const actualByDomain = {};
    Object.keys(D.DOMAINS).forEach((k) => { actualByDomain[k] = 0; });
    D.PROJECTS.forEach((p) => { actualByDomain[p.domain] += p.hours_week; });
    const totalActual = Object.values(actualByDomain).reduce((a, b) => a + b, 0);
    const totalPlanned = Object.values(D.PLAN_BY_DOMAIN).reduce((a, b) => a + b, 0);

    const comp = D.WEEK_BY_DAY.reduce((acc, d) => ({
      deep:    acc.deep + d.deep,
      shallow: acc.shallow + d.shallow,
      admin:   acc.admin + d.admin,
    }), { deep: 0, shallow: 0, admin: 0 });
    const compTotal = comp.deep + comp.shallow + comp.admin;
    const deepRatio = comp.deep / compTotal;

    return (
      <div className="v2-analytics">
        <AnalyticsHeader
          range={range} onRange={setRange}
          totalActual={totalActual} deepRatio={deepRatio} totalPlanned={totalPlanned}/>
        <div className="v2-an-row">
          <DailyRhythm/>
          <DomainWithIntention actualByDomain={actualByDomain}/>
        </div>
        <div className="v2-an-row bottom">
          <ProjectTrends/>
          <TimeComposition comp={comp} deepRatio={deepRatio}/>
        </div>
      </div>
    );
  }

  // ─── ALMANAC tab ────────────────────────────────────────────────────
  function ChallengeCard() {
    return (
      <div className="v2-challenge">
        <div className="kicker">Weekly challenge · from Codex</div>
        <div className="text">"Three deep-work sessions on Portia before Thursday."</div>
        <div className="progress">
          <div className="pip"/><div className="pip"/><div className="pip"/>
          <span style={{marginLeft: 10}}>0 of 3 · six days remaining</span>
        </div>
      </div>
    );
  }

  function MilestonesCard() {
    return (
      <div className="card">
        <div className="hd">
          <h3>This fortnight</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>Six entries</span>
        </div>
        <div className="v2-mile">
          {D.MILESTONES.map((m, i) => (
            <div className="v2-mile-row" key={i}>
              <span className="date">{m.date}</span>
              <span className="text">{m.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function DeepCounter() {
    return (
      <div className="card">
        <div className="hd">
          <h3>Deep work · a counter that only goes up</h3>
        </div>
        <div className="v2-deep-counter">
          <div className="col">
            <span className="smallcaps" style={{color: c.inkFaint}}>May</span>
            <span className="big num">88h 03</span>
          </div>
          <div className="col">
            <span className="smallcaps" style={{color: c.inkFaint}}>YTD 2026</span>
            <span className="big num" style={{color: c.accent}}>482h 14</span>
          </div>
        </div>
      </div>
    );
  }

  function StreaksCard() {
    const streaks = D.PROJECTS.filter((p) => p.streak > 0).sort((a, b) => b.streak - a.streak);
    const maxPips = 12;
    return (
      <div className="card">
        <div className="hd">
          <h3>Streaks</h3>
          <span className="grow"/>
          <span className="smallcaps" style={{color: c.inkFaint}}>{streaks.length} active</span>
        </div>
        <div className="v2-streaks">
          {streaks.map((p) => (
            <div className="v2-streak" key={p.id}>
              <span className="name">{p.name}</span>
              <span className="days">{p.streak}d</span>
              <div className="pips">
                {Array.from({length: maxPips}).map((_, i) => (
                  <i key={i} className={i >= p.streak ? 'cold' : ''}
                     style={i < p.streak ? {background: dom[p.domain]} : undefined}/>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function AlmanacTab() {
    return (
      <div className="v2-almanac">
        <div className="col">
          <ChallengeCard/>
          <DeepCounter/>
          <StreaksCard/>
        </div>
        <div className="col">
          <MilestonesCard/>
        </div>
      </div>
    );
  }

  // ─── Chat rail ──────────────────────────────────────────────────────
  function ChatRail() {
    const channels = ['daily-log', 'project-ops', 'analytics', 'build', 'open'];
    const [active, setActive] = useState('daily-log');
    const thread = D.CHAT.find((c) => c.channel === active) || { messages: [] };
    return (
      <div className="v2-chat">
        <div className="v2-chat-top">
          <div className="name">Codex</div>
          <div className="sub">
            <span className="dot">●</span>
            <span>online</span>
            <span style={{color: c.inkFaint}}>·</span>
            <span>⌘K to summon</span>
          </div>
        </div>
        <div className="v2-chat-channels">
          {channels.map((ch) => (
            <button key={ch} className={`pill ${ch === active ? 'active' : ''} ${ch}`} onClick={() => setActive(ch)}>
              {ch}
            </button>
          ))}
        </div>
        <div className="v2-chat-body">
          <div className="v2-chat-day">
            {active === 'daily-log' ? 'Today · Fri 22 May'
              : active === 'project-ops' ? 'Yesterday'
              : active === 'build' ? 'Tue 19 May'
              : 'Earlier this week'}
          </div>
          {thread.messages.map((m, i) => (
            <div key={i} className={`v2-msg ${m.role} ${m.terse ? 'terse' : ''}`}>
              <div className="meta">
                <b>{m.role === 'user' ? 'You' : 'Codex'}</b>
                <span>·</span>
                <span>{m.t}</span>
              </div>
              <div className="body">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="v2-chat-input">
          <div className="field">
            <span className="caret">›</span>
            <span className="typed">log 90 min on portia, act III draft</span>
            <span className="cursor"/>
          </div>
          <div className="hint">
            <span>Daily-log</span>
            <span>Return to send</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Shell ──────────────────────────────────────────────────────────
  function V2Editorial({ initialTab = 'today' }) {
    const [tab, setTab] = useState(initialTab);
    return (
      <div className="v2">
        <style>{STYLES}</style>
        <Masthead/>
        <TabNav tab={tab} onTab={setTab}/>
        <div className="v2-page">
          {tab === 'today'     && <TodayTab/>}
          {tab === 'projects'  && <ProjectsTab/>}
          {tab === 'analytics' && <AnalyticsTab/>}
          {tab === 'almanac'   && <AlmanacTab/>}
        </div>
        <ChatRail/>
      </div>
    );
  }

  window.V2Editorial = V2Editorial;
})();
