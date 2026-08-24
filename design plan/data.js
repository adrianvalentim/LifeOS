// LifeOS — shared data model. Exposed on window so each variant reads the same world.

window.LIFEOS = (function () {
  const now = new Date('2026-05-22T08:34:00');  // Friday morning, deterministic
  const HOUR = 1000 * 60 * 60;

  const DOMAINS = {
    filmmaking:    { key: 'filmmaking',    label: 'Filmmaking',    short: 'FILM', glyph: 'F' },
    research:      { key: 'research',      label: 'Research',      short: 'RSCH', glyph: 'R' },
    education:     { key: 'education',     label: 'Education',     short: 'EDU',  glyph: 'E' },
    content:       { key: 'content',       label: 'Content',       short: 'CONT', glyph: 'C' },
    business:      { key: 'business',      label: 'Business',      short: 'BIZ',  glyph: 'B' },
    personal:      { key: 'personal',      label: 'Personal',      short: 'PERS', glyph: 'P' },
  };

  // Domain palettes — six harmonious hues at matched chroma/lightness.
  // Each variant pulls from these; theme adjusts lightness for legibility.
  const PALETTE = {
    instrument: {
      filmmaking: '#d97757', research: '#6ba3c4', education: '#9bb86b',
      content:    '#d77ba0', business: '#d4b066', personal: '#9b8ad4',
    },
    editorial: {
      filmmaking: '#b4502c', research: '#3a6b85', education: '#5e7d2c',
      content:    '#a23c6b', business: '#9c7720', personal: '#5e4a9c',
    },
    noir: {
      filmmaking: '#e08555', research: '#6db8d4', education: '#a5c46b',
      content:    '#e07db0', business: '#dec275', personal: '#a594dc',
    },
  };

  // Eight active projects spanning all six domains. Health is computed from
  // last_touched + deadline_in + recent momentum; precomputed here so the
  // visualizations stay stable.
  const PROJECTS = [
    {
      id: 'vulcano',
      name: 'Vulcano',
      subtitle: 'Documentary feature',
      domain: 'filmmaking',
      health: 'healthy',
      health_score: 0.84,
      last_touched: now - 18 * HOUR,           // yesterday evening
      hours_week: 14.2,
      hours_planned: 12,
      deadline_in_days: 28,
      progress: 0.62,
      streak: 7,
      sparkline: [2.1, 3.4, 0, 1.8, 4.2, 3.2, 0],   // last 7 days, h/day
      weeks_history: [8.2, 9.1, 11.3, 10.8, 12.4, 13.0, 11.9, 14.2],
      note: 'Color pass on Act II. Cleared 6 shots.',
    },
    {
      id: 'portia',
      name: 'Portia',
      subtitle: 'Short film · script',
      domain: 'filmmaking',
      health: 'critical',
      health_score: 0.18,
      last_touched: now - 6 * 24 * HOUR,        // 6 days
      hours_week: 0,
      hours_planned: 6,
      deadline_in_days: 3,                      // Friday
      progress: 0.20,
      streak: 0,
      sparkline: [0, 0, 0, 0, 0, 0, 0],
      weeks_history: [4.1, 3.2, 2.8, 1.6, 1.0, 0.4, 0, 0],
      note: 'Acts III & IV still in outline. Deadline Friday.',
    },
    {
      id: 'mechinterp',
      name: 'Mech Interp Lab',
      subtitle: 'Grad supervision',
      domain: 'research',
      health: 'healthy',
      health_score: 0.71,
      last_touched: now - 2 * HOUR,             // this morning
      hours_week: 7.8,
      hours_planned: 8,
      deadline_in_days: null,
      progress: null,
      streak: 4,
      sparkline: [1.5, 0, 2.2, 1.1, 0, 1.0, 2.0],
      weeks_history: [6.5, 7.2, 8.0, 7.4, 7.0, 8.3, 8.1, 7.8],
      note: 'Reviewed M.\'s circuits notebook.',
    },
    {
      id: 'curriculum',
      name: 'Curriculum 2026',
      subtitle: 'Graduate ML syllabus',
      domain: 'education',
      health: 'attention',
      health_score: 0.42,
      last_touched: now - 4 * 24 * HOUR,
      hours_week: 1.7,
      hours_planned: 4,
      deadline_in_days: 21,
      progress: 0.35,
      streak: 0,
      sparkline: [0, 0, 1.7, 0, 0, 0, 0],
      weeks_history: [3.2, 4.0, 3.8, 3.5, 2.5, 2.0, 1.5, 1.7],
      note: 'Module 4 outline pending.',
    },
    {
      id: 'infinitamente',
      name: 'Infinitamente',
      subtitle: 'YouTube channel',
      domain: 'content',
      health: 'healthy',
      health_score: 0.78,
      last_touched: now - 20 * HOUR,
      hours_week: 6.4,
      hours_planned: 6,
      deadline_in_days: 5,                      // weekly publish
      progress: 0.70,
      streak: 12,
      sparkline: [1.0, 1.5, 0, 1.2, 1.8, 0.9, 0],
      weeks_history: [5.8, 6.0, 7.2, 6.5, 6.0, 6.8, 7.0, 6.4],
      note: 'Episode 47 cut locked. B-roll pending.',
    },
    {
      id: 'substack',
      name: 'Substack',
      subtitle: 'Essay · "Slow time"',
      domain: 'content',
      health: 'critical',
      health_score: 0.22,
      last_touched: now - 5 * 24 * HOUR,
      hours_week: 0.5,
      hours_planned: 4,
      deadline_in_days: 3,
      progress: 0.20,
      streak: 0,
      sparkline: [0, 0.5, 0, 0, 0, 0, 0],
      weeks_history: [2.5, 2.0, 1.5, 1.0, 0.8, 0.7, 1.2, 0.5],
      note: 'Draft at 20%. Outline solid; prose stalled.',
    },
    {
      id: 'longnow',
      name: 'The Long Now',
      subtitle: 'Podcast · ep. 23',
      domain: 'content',
      health: 'healthy',
      health_score: 0.66,
      last_touched: now - 1 * HOUR,
      hours_week: 3.1,
      hours_planned: 3,
      deadline_in_days: 9,
      progress: 0.55,
      streak: 2,
      sparkline: [0, 1.0, 0, 0, 1.1, 1.0, 0],
      weeks_history: [3.5, 3.0, 2.8, 3.2, 3.0, 3.5, 3.0, 3.1],
      note: 'Guest confirmed. Outline drafted.',
    },
    {
      id: 'aurora',
      name: 'Aurora Store',
      subtitle: 'Online shop · ops',
      domain: 'business',
      health: 'healthy',
      health_score: 0.61,
      last_touched: now - 30 * HOUR,
      hours_week: 3.9,
      hours_planned: 3,
      deadline_in_days: null,
      progress: null,
      streak: 3,
      sparkline: [0.5, 0.9, 1.3, 0, 0.6, 0.6, 0],
      weeks_history: [4.0, 3.8, 3.2, 4.5, 4.0, 3.5, 4.2, 3.9],
      note: 'May restock processed. 14 orders pending.',
    },
    {
      id: 'sfprep',
      name: 'SF Move',
      subtitle: 'Relocation logistics',
      domain: 'personal',
      health: 'attention',
      health_score: 0.48,
      last_touched: now - 3 * 24 * HOUR,
      hours_week: 1.2,
      hours_planned: 2,
      deadline_in_days: 56,
      progress: 0.25,
      streak: 0,
      sparkline: [0, 1.2, 0, 0, 0, 0, 0],
      weeks_history: [0, 0, 0.5, 1.0, 0.8, 1.5, 1.2, 1.2],
      note: 'Visa paperwork next. Awaiting employer letter.',
    },
  ];

  // Weekly planned allocation per domain. The "intention vs reality" chart
  // compares this against actual PROJECTS.hours_week sums.
  const PLAN_BY_DOMAIN = {
    filmmaking: 18,  // Vulcano 12 + Portia 6
    research:    8,
    education:   4,
    content:    13,  // Infinitamente 6 + Substack 4 + Long Now 3
    business:    3,
    personal:    2,
  };
  // Total: 48 h/week intention.

  // User-set deep-work ratio target (shown as a target line on the
  // deep/shallow chart in Analytics).
  const DEEP_TARGET = 0.65;

  // 8-week labels for project trend sparklines
  const WEEK_LABELS = ['W14', 'W15', 'W16', 'W17', 'W18', 'W19', 'W20', 'W21'];

  // Today's time log so far — entries are activity_type + project + minutes.
  const TODAY_ENTRIES = [
    { t: '07:02', dur: 45,  type: 'research',      project: 'longnow',     desc: 'Background reading — guest\'s 2023 paper' },
    { t: '07:47', dur: 28,  type: 'shallow_work',  project: null,          desc: 'Inbox triage, scheduling' },
    { t: '08:15', dur: 19,  type: 'communication', project: 'mechinterp',  desc: 'Async reply to M. re: circuit visualization' },
  ];

  // Week-so-far totals (Mon-Fri, with Fri being today, partial)
  const WEEK_BY_DAY = [
    { d: 'Mon', deep: 4.2, shallow: 1.4, admin: 0.6 },
    { d: 'Tue', deep: 5.8, shallow: 0.9, admin: 0.4 },
    { d: 'Wed', deep: 3.1, shallow: 1.8, admin: 1.2 },
    { d: 'Thu', deep: 6.4, shallow: 1.1, admin: 0.3 },
    { d: 'Fri', deep: 0,   shallow: 0.8, admin: 0.0 },  // today, in progress
  ];

  // Hour-of-day heatmap — last 14 days × 24 hours, focus density 0..1.
  // Hand-tuned to read like a real circadian pattern (mornings strongest).
  function rhythmHeatmap() {
    const out = [];
    for (let d = 0; d < 14; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        let v = 0;
        if (h >= 8 && h <= 11)  v = 0.55 + 0.4 * Math.sin((h - 8) / 3 * Math.PI);
        if (h >= 14 && h <= 17) v = 0.45 + 0.3 * Math.sin((h - 14) / 3 * Math.PI);
        if (h >= 20 && h <= 22) v = 0.25;
        // Weekend dip
        const dow = (d + 5) % 7;
        if (dow === 5 || dow === 6) v *= 0.45;
        // Noise
        v *= 0.75 + 0.5 * Math.sin(d * 7.13 + h * 1.7);
        v = Math.max(0, Math.min(1, v));
        // Sparse blanks
        if (Math.sin(d * 3.1 + h * 5.7) > 0.78) v = 0;
        row.push(v);
      }
      out.push(row);
    }
    return out;
  }

  // The AI recommendation card
  const RECOMMENDATION = {
    project_id: 'portia',
    project_name: 'Portia',
    domain: 'filmmaking',
    duration_min: 90,
    confidence: 0.86,
    reason_short: 'Untouched 6 days · deadline Friday',
    reason_long:
      'Portia hasn\'t moved since Saturday and the cut is due Friday. Mornings ' +
      'are your strongest creative window — 73% of your deep work this month ' +
      'happened between 09:00 and 12:00. Block the next 90 minutes on Act III.',
    alternatives: [
      { project_id: 'substack',     duration_min: 60, why: 'Same deadline, lighter lift' },
      { project_id: 'infinitamente', duration_min: 45, why: 'Cut review before publish' },
    ],
  };

  // Weekly challenge — AI-generated, prominent on dashboard
  const CHALLENGE = {
    text: 'Three deep-work sessions on Portia before Thursday.',
    progress: 0,
    of: 3,
    days_left: 6,
  };

  // Milestones — chronological log, last 14 days
  const MILESTONES = [
    { date: 'May 21', text: 'Vulcano: Act II color pass complete' },
    { date: 'May 19', text: 'Long Now ep. 22 published' },
    { date: 'May 17', text: 'Submitted mech-interp position paper draft' },
    { date: 'May 14', text: 'Infinitamente ep. 46 — 38k views first 48h' },
    { date: 'May 12', text: 'Curriculum: Module 3 finalized' },
    { date: 'May 09', text: 'Aurora Store: May restock shipped' },
  ];

  // Scripted chat history — feels real, demonstrates channel routing
  const CHAT = [
    {
      channel: 'analytics',
      messages: [
        { role: 'user', t: '08:21', body: 'how much on vulcano this week?' },
        { role: 'assistant', t: '08:21',
          body: '14h 12m on Vulcano this week. 78% deep work. Yesterday was your biggest session — 3h 12m on color grading. Pacing slightly ahead of your 12h plan.' },
      ],
    },
    {
      channel: 'daily-log',
      messages: [
        { role: 'user', t: '07:02', body: 'starting 45min reading on long now guest' },
        { role: 'assistant', t: '07:02', body: '✓ Started · 45m · research · The Long Now', terse: true },
        { role: 'user', t: '07:47', body: 'done. now 28min inbox' },
        { role: 'assistant', t: '07:47',
          body: '✓ Logged 45m research · The Long Now\n✓ Started · 28m · shallow_work · Inbox', terse: true },
        { role: 'user', t: '08:15', body: 'done. 19min reply to M. about circuit viz' },
        { role: 'assistant', t: '08:15',
          body: '✓ Logged 28m shallow_work · Inbox\n✓ Logged 19m communication · Mech Interp Lab', terse: true },
      ],
    },
    {
      channel: 'project-ops',
      messages: [
        { role: 'user', t: 'Yesterday', body: 'set portia deadline to friday end of day' },
        { role: 'assistant', t: 'Yesterday', body: '✓ Portia deadline → 2026-05-23 23:59. Health: yellow → red (3d, 20% complete).', terse: true },
      ],
    },
    {
      channel: 'build',
      messages: [
        { role: 'user', t: 'May 20', body: 'add a "production vs consumption" ratio to the analytics page' },
        { role: 'assistant', t: 'May 20',
          body: 'Drafted. Added `prod_consumption_ratio()` over `activity_type`. Production = creative+communication. Consumption = research. Preview at /analytics?preview=pcr. Merge?' },
      ],
    },
  ];

  return {
    now,
    DOMAINS,
    PALETTE,
    PROJECTS,
    PLAN_BY_DOMAIN,
    DEEP_TARGET,
    WEEK_LABELS,
    TODAY_ENTRIES,
    WEEK_BY_DAY,
    rhythmHeatmap,
    RECOMMENDATION,
    CHALLENGE,
    MILESTONES,
    CHAT,
    // helpers
    project: (id) => PROJECTS.find((p) => p.id === id),
    domain:  (id) => DOMAINS[id],
    fmtAgo(ts) {
      const d = (window.LIFEOS.now - ts) / HOUR;
      if (d < 1)   return Math.round(d * 60) + 'm ago';
      if (d < 24)  return Math.round(d) + 'h ago';
      const days = Math.round(d / 24);
      return days + 'd ago';
    },
    fmtHM(h) {
      const H = Math.floor(h);
      const M = Math.round((h - H) * 60);
      if (H === 0) return M + 'm';
      if (M === 0) return H + 'h';
      return H + 'h ' + String(M).padStart(2, '0');
    },
  };
})();
