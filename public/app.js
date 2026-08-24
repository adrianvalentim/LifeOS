let state = null;
let activeTab = 'projects';
let activeRange = 'week';
let recommendationIndex = 0;
let recommendationDismissed = false;
let pageError = null;
let stateRefreshTimer = null;
let eventSource = null;

const codex = {
  connection: 'connecting',
  connectionDetail: null,
  account: null,
  threads: [],
  activeThread: null,
  runningTurns: {},
  pendingRequests: [],
  draft: '',
  sending: false,
  opening: false,
  error: null,
  voice: {
    available: false,
    reason: 'Checking whether Codex desktop dictation is available.',
  },
};

const app = document.getElementById('app');
const THREAD_STORAGE_KEY = 'lifeos.codex.threadId';

void init();

async function init() {
  const params = new URLSearchParams(location.search);
  activeRange = ['week', 'month', 'quarter', 'year'].includes(params.get('range')) ? params.get('range') : 'week';
  try {
    state = await fetchState(activeRange);
    activeTab = params.get('tab') || state.meta.activeTab || 'projects';
    render();
    connectEventStream();
    void bootstrapCodex();
  } catch (error) {
    app.innerHTML = `<div class="boot error-boot">${escapeHtml(error.message)}</div>`;
  }

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      document.querySelector('.chat-input')?.focus();
    }
  });
  window.addEventListener('popstate', async () => {
    const next = new URLSearchParams(location.search);
    activeTab = next.get('tab') || 'projects';
    activeRange = next.get('range') || 'week';
    state = await fetchState(activeRange);
    render();
  });
}

async function fetchState(range = activeRange) {
  return apiJson(`/api/state?range=${encodeURIComponent(range)}`);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function render() {
  app.className = 'lifeos';
  app.innerHTML = `
    ${renderMasthead()}
    ${renderTabs()}
    <section class="page" data-view="${activeTab}">
      ${pageError ? `<div class="page-error"><span>${escapeHtml(pageError)}</span><button data-page-error-dismiss type="button">Dismiss</button></div>` : ''}
      ${renderPage()}
    </section>
    ${renderChat()}
  `;
  bindPageEvents();
  bindChatEvents();
  scrollChatToEnd();
}

function renderChatRegion() {
  const current = document.querySelector('.chat');
  if (!current) return;
  current.outerHTML = renderChat();
  bindChatEvents();
  scrollChatToEnd();
}

function bindPageEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab;
      updateLocation();
      render();
    });
  });

  document.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.range === activeRange) return;
      activeRange = button.dataset.range;
      updateLocation();
      await refreshState();
    });
  });

  document.querySelector('[data-recommendation-alternate]')?.addEventListener('click', () => {
    recommendationIndex = (recommendationIndex + 1) % Math.max(1, state.recommendations.length);
    render();
  });
  document.querySelector('[data-recommendation-dismiss]')?.addEventListener('click', () => {
    recommendationDismissed = true;
    render();
  });
  document.querySelector('[data-recommendation-restore]')?.addEventListener('click', () => {
    recommendationDismissed = false;
    render();
  });
  document.querySelector('[data-session-start]')?.addEventListener('click', async (event) => {
    const rec = visibleRecommendation();
    if (!rec) return;
    await runPageAction(event.currentTarget, async () => {
      state = await apiJson('/api/session/start', jsonRequest({
        projectId: rec.projectId,
        description: rec.action,
        rawInput: `Begin recommendation: ${rec.projectName}`,
      }));
      render();
    });
  });
  document.querySelector('[data-session-stop]')?.addEventListener('click', async (event) => {
    await runPageAction(event.currentTarget, async () => {
      state = await apiJson('/api/session/stop', jsonRequest({}));
      render();
    });
  });
  document.querySelector('[data-page-error-dismiss]')?.addEventListener('click', () => {
    pageError = null;
    render();
  });
}

async function runPageAction(button, action) {
  pageError = null;
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    pageError = error.message;
    render();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function updateLocation() {
  const params = new URLSearchParams();
  if (activeTab !== 'projects') params.set('tab', activeTab);
  if (activeRange !== 'week') params.set('range', activeRange);
  const query = params.toString();
  history.pushState(null, '', query ? `?${query}` : location.pathname);
}

function renderMasthead() {
  const date = formatDateLong(state.meta.today);
  return `
    <header class="masthead">
      <div class="masthead-side">
        <span>Week <b>${state.meta.weekNumber}</b></span>
        <span>No. <b>${state.meta.issueNumber}</b></span>
        ${state.meta.demo ? '<span class="demo-tag">Demo data</span>' : ''}
      </div>
      <div class="masthead-name">
        ${escapeHtml(state.meta.appName)}
        <span class="masthead-sub">${escapeHtml(state.meta.tagline)}</span>
      </div>
      <div class="masthead-side right">
        <span><b>${date.weekday}</b>, ${date.rest}</span>
      </div>
    </header>
  `;
}

function renderTabs() {
  const tabs = [
    ['today', 'Today'],
    ['projects', 'Projects'],
    ['analytics', 'Analytics'],
    ['almanac', 'Almanac'],
  ];
  const meta = {
    today: state.activeSession ? 'A focused session is running' : 'What now and what has happened',
    projects: `${titleNumber(state.summary.activeCount)} active - ${titleNumber(state.summary.criticalCount)} critical`,
    analytics: 'Where the hours actually went',
    almanac: 'A record of what got done',
  };
  return `
    <nav class="tabs" aria-label="LifeOS sections">
      ${tabs.map(([id, label]) => `
        <button class="tab ${id === activeTab ? 'active' : ''}" data-tab="${id}" type="button">${label}</button>
      `).join('')}
      <div class="tab-meta"><span class="smallcaps">${escapeHtml(meta[activeTab] || '')}</span></div>
    </nav>
  `;
}

function renderPage() {
  if (activeTab === 'today') return renderToday();
  if (activeTab === 'analytics') return renderAnalytics();
  if (activeTab === 'almanac') return renderAlmanac();
  return renderProjects();
}

function renderProjects() {
  return `<div class="projects-grid">${state.projects.map(renderProject).join('')}</div>`;
}

function renderProject(project) {
  const domain = state.domains[project.domain];
  const healthColor = cssHealth(project.health);
  const due = project.dueInDays == null ? '-' : project.dueInDays < 0 ? `${Math.abs(project.dueInDays)}d late` : `${project.dueInDays}d`;
  const lastClass = project.lastTouchedLabel.includes('h ago') || project.lastTouchedLabel.includes('m ago') ? 'healthy' : project.health === 'critical' ? 'critical' : '';
  const dueClass = project.dueInDays != null && project.dueInDays <= 3 ? 'critical' : '';
  return `
    <article class="project-entry" style="--domain:${domain.color}">
      <div class="swatch"></div>
      <div>
        <div class="project-head">
          <div class="project-name">${escapeHtml(project.name)}</div>
          <div class="project-domain">${escapeHtml(domain.label)}</div>
          <div class="health-tag" style="color:${healthColor}"><span class="status-dot"></span>${escapeHtml(project.health)}</div>
        </div>
        <div class="project-subtitle">${escapeHtml(project.subtitle)}</div>
        <div class="project-note">${escapeHtml(project.note)}</div>
        <div class="project-stats">
          <span class="stat"><span class="stat-k">Last</span><span class="stat-v ${lastClass}">${escapeHtml(project.lastTouchedLabel)}</span></span>
          <span class="stat"><span class="stat-k">Week</span><span class="stat-v">${escapeHtml(project.weekHoursLabel)}</span></span>
          <span class="stat"><span class="stat-k">Due</span><span class="stat-v ${dueClass}">${escapeHtml(due)}</span></span>
          ${project.streak > 0 ? `<span class="stat"><span class="stat-k">Streak</span><span class="stat-v" style="color:var(--accent)">${project.streak}d</span></span>` : ''}
        </div>
        ${project.progress == null ? '' : `
          <div class="progress" style="--progress:${Math.round(project.progress * 100)}%">
            <div class="bar"><i class="bar-fill"></i></div>
            <span class="pct">${Math.round(project.progress * 100)}%</span>
          </div>
        `}
      </div>
    </article>
  `;
}

function renderToday() {
  const grouped = groupByActivity(state.todayEntries);
  return `
    <div class="today-layout">
      ${renderRecommendationPanel()}
      <section class="panel">
        <div class="panel-head">
          <span class="smallcaps-strong">The day so far</span>
          <span class="grow"></span>
          <span class="smallcaps">Plan ${formatHours(state.settings.defaultDailyPlanHours)} - ${Math.round(state.summary.todayMinutes / (state.settings.defaultDailyPlanHours * 60) * 100)}%</span>
        </div>
        <div class="total-time">${formatDayTotal(state.summary.todayMinutes)}<span class="of">across ${state.todayEntries.length} entries</span></div>
        <div class="activity-bar">
          ${Object.entries(grouped).map(([type, minutes]) => `<i class="activity-seg" style="--minutes:${minutes};--domain:${activityColor(type)}"></i>`).join('')}
        </div>
        <div class="entries">
          ${state.todayEntries.length ? state.todayEntries.map(renderEntry).join('') : '<p class="empty-copy">No time logged today.</p>'}
        </div>
      </section>
    </div>
  `;
}

function renderRecommendationPanel() {
  if (state.activeSession) {
    const project = state.projects.find((candidate) => candidate.id === state.activeSession.projectId);
    const domain = project ? state.domains[project.domain] : state.domains.personal;
    return `
      <section class="panel active-session" style="--domain:${domain.color}">
        <div class="panel-head"><span class="smallcaps-strong">Session running</span><span class="smallcaps">Started ${escapeHtml(formatClock(state.activeSession.startedAt))}</span></div>
        <div class="pull-project">${escapeHtml(project?.name || 'General work')}.</div>
        <div class="pull-sub">${escapeHtml(state.activeSession.description)}</div>
        <div class="context-line"><span class="context-swatch"></span><span class="smallcaps-strong">${escapeHtml(state.activeSession.activityType.replace('_', ' '))}</span></div>
        <div class="actions"><button class="action-btn" data-session-stop type="button">Stop and log</button></div>
        <p class="callout-text" style="margin-top:24px">LifeOS will calculate the elapsed time and create a real time entry.</p>
      </section>
    `;
  }
  if (recommendationDismissed) {
    return `
      <section class="panel dismissed-recommendation">
        <div class="panel-head"><span class="smallcaps-strong">What now</span></div>
        <div class="pull-sub">Recommendation dismissed for this visit.</div>
        <div class="actions"><button class="action-btn secondary" data-recommendation-restore type="button">Restore</button></div>
      </section>
    `;
  }
  const rec = visibleRecommendation();
  if (!rec) return '<section class="panel"><p class="empty-copy">No active project recommendation is available.</p></section>';
  const domain = state.domains[rec.domain];
  return `
    <section class="panel" style="--domain:${domain.color}">
      <div class="panel-head"><span class="smallcaps-strong">What now</span><span class="smallcaps">Now - ${formatMinutes(rec.durationMinutes)} - ${Math.round(rec.confidence * 100)}%</span></div>
      <div class="pull-project">${escapeHtml(rec.projectName)}.</div>
      <div class="pull-sub">${escapeHtml(rec.action)}</div>
      <div class="context-line"><span class="context-swatch"></span><span class="smallcaps-strong">${escapeHtml(domain.label)}</span><span class="smallcaps" style="color:var(--critical)">${escapeHtml(rec.reasonShort)}</span></div>
      <div class="actions">
        <button class="action-btn" data-session-start type="button">Begin - ${formatMinutes(rec.durationMinutes)}</button>
        <button class="action-btn secondary" data-recommendation-alternate type="button">Alternate</button>
        <button class="action-btn text" data-recommendation-dismiss type="button">Dismiss</button>
      </div>
      <p class="callout-text" style="margin-top:24px">${escapeHtml(rec.reasonLong)}</p>
    </section>
  `;
}

function visibleRecommendation() {
  if (!state.recommendations?.length) return null;
  return state.recommendations[recommendationIndex % state.recommendations.length];
}

function renderEntry(entry) {
  const project = state.projects.find((candidate) => candidate.id === entry.projectId);
  return `
    <div class="entry-row">
      <span class="entry-time">${escapeHtml(entry.time || '-')}</span>
      <span class="entry-desc"><span class="entry-type">${escapeHtml(entry.activityType.replace('_', ' '))}${project ? ` - ${escapeHtml(project.name)}` : ''}</span>${escapeHtml(entry.description)}</span>
      <span class="entry-duration">${entry.durationMinutes}m</span>
    </div>
  `;
}

function renderAnalytics() {
  const ratioDelta = Math.round((state.summary.deepRatio - state.settings.deepTarget) * 100);
  return `
    <div class="analytics-layout">
      <header class="analytics-header">
        <div class="range-tabs">
          ${Object.entries(state.analytics.labels).map(([range, label]) => `<button class="range-tab ${range === activeRange ? 'active' : ''}" data-range="${range}" type="button">${escapeHtml(label)}</button>`).join('')}
        </div>
        <div class="kpis">
          ${renderKpi('Time tracked', state.summary.totalRangeLabel, `of ${state.summary.plannedRangeLabel} plan`)}
          ${renderKpi('Deep ratio', `${Math.round(state.summary.deepRatio * 100)}%`, `${ratioDelta >= 0 ? '+' : ''}${ratioDelta} pts vs target`)}
          ${renderKpi('On plan', `${state.summary.onPlan}%`, state.summary.onPlan >= 100 ? 'ahead' : `short ${100 - state.summary.onPlan} pts`)}
        </div>
      </header>
      <div class="analytics-row">${renderHeatmap()}${renderDomainBreakdown()}</div>
      <div class="analytics-row bottom">${renderProjectTrends()}${renderComposition()}</div>
    </div>
  `;
}

function renderKpi(label, number, sub) {
  return `<div class="kpi"><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-number">${escapeHtml(number)}</span><span class="smallcaps">${escapeHtml(sub)}</span></div>`;
}

function renderHeatmap() {
  const dayCodes = state.rhythmHeatmap.dates.map((date) => new Intl.DateTimeFormat('en-US', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Daily rhythm</h3><span class="grow"></span><span class="smallcaps">Last 14 days - 00-24h</span></div>
      <div class="heatmap">
        <div></div>
        <div class="hour-axis">${Array.from({ length: 24 }, (_, hour) => `<span>${hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}</span>`).join('')}</div>
        <div class="day-axis">${dayCodes.map((day) => `<span>${day}</span>`).join('')}</div>
        <div class="matrix">${state.rhythmHeatmap.values.flatMap((row) => row.map((value) => `<i class="heat-cell" style="background:${heatmapColor(value)}"></i>`)).join('')}</div>
      </div>
    </section>
  `;
}

function renderDomainBreakdown() {
  const weeklyPlanTotal = Object.values(state.settings.weeklyPlanByDomain).reduce((sum, value) => sum + Number(value), 0);
  const planScale = weeklyPlanTotal ? state.summary.plannedRangeHours / weeklyPlanTotal : 1;
  const values = Object.keys(state.domains).map((key) => ({
    key,
    actual: state.analytics.actualByDomain[key] || 0,
    planned: (state.settings.weeklyPlanByDomain[key] || 0) * planScale,
  }));
  const max = Math.max(1, ...values.flatMap((item) => [item.actual, item.planned]));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Domain breakdown</h3><span class="grow"></span><span class="smallcaps">Plan marker</span></div>
      <div class="domain-rows">
        ${values.map(({ key, actual, planned }) => {
          const domain = state.domains[key];
          const delta = Math.round((actual - planned) * 10) / 10;
          return `
            <div class="domain-row" style="--domain:${domain.color};--actual:${actual / max * 100}%;--planned:${planned / max * 100}%">
              <span class="domain-label">${escapeHtml(domain.label)}</span><span class="domain-bar"><i class="domain-bar-fill"></i><i class="domain-plan"></i></span>
              <span class="domain-value">${actual ? formatHours(actual) : '-'}</span><span class="domain-delta" style="color:${delta >= 0 ? 'var(--healthy)' : 'var(--critical)'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</span>
            </div>`;
        }).join('')}
      </div>
    </section>
  `;
}

function renderProjectTrends() {
  const projects = [...state.projects].sort((a, b) => b.weekHours - a.weekHours);
  const max = Math.max(1, ...projects.flatMap((project) => project.weekHistory));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Project trends</h3><span class="grow"></span><span class="smallcaps">Hours / week - last 8</span></div>
      <div class="trend-rows">
        ${projects.map((project) => {
          const domain = state.domains[project.domain];
          const current = project.weekHistory.at(-1) || 0;
          const previous = project.weekHistory.at(-2) || 0;
          const delta = current - previous;
          return `<div class="trend-row" style="--domain:${domain.color}"><span class="trend-name"><i></i>${escapeHtml(project.name)}</span><span class="spark">${project.weekHistory.map((value, index) => `<i style="height:${Math.max(2, value / max * 100)}%;opacity:${index === project.weekHistory.length - 1 ? 1 : 0.55}"></i>`).join('')}</span><span class="trend-current">${current ? formatHours(current) : '-'}</span><span class="trend-delta" style="color:${delta > 0.1 ? 'var(--healthy)' : delta < -0.1 ? 'var(--critical)' : 'var(--ink-faint)'}">${delta > 0.1 ? 'up' : delta < -0.1 ? 'dn' : '-'}</span></div>`;
        }).join('')}
      </div>
    </section>
  `;
}

function renderComposition() {
  const comp = state.analytics.composition;
  const total = Math.max(0.0001, comp.deep + comp.shallow + comp.admin);
  const pc = state.analytics.productionConsumption;
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Composition</h3><span class="grow"></span><span class="smallcaps">Deep target ${Math.round(state.settings.deepTarget * 100)}%</span></div>
      <div class="smallcaps-strong">Deep - Shallow - Admin</div>
      <div class="composition-bar">
        <span class="composition-seg" style="flex:${comp.deep || 0.001};background:var(--ink)">Deep ${Math.round(comp.deep / total * 100)}%</span>
        <span class="composition-seg" style="flex:${comp.shallow || 0.001};background:var(--ink-dim)">Shallow ${Math.round(comp.shallow / total * 100)}%</span>
        <span class="composition-seg" style="flex:${comp.admin || 0.001};background:var(--ink-faint);color:var(--ink)">Admin ${Math.round(comp.admin / total * 100)}%</span>
      </div>
      <div class="smallcaps-strong" style="margin-top:18px">Production - Consumption</div>
      <div class="composition-bar">
        <span class="composition-seg" style="flex:${pc.productionPct || 0.001};background:${state.domains.filmmaking.color}">Production ${pc.productionPct}%</span>
        <span class="composition-seg" style="flex:${pc.consumptionPct || 0.001};background:${state.domains.research.color}">Consumption ${pc.consumptionPct}%</span>
      </div>
      <div class="support-note smallcaps">Support work: ${formatHours(pc.supportHours)}</div>
      <div class="callout"><div class="callout-kicker">Computed weekly note</div><div class="callout-text">${escapeHtml(state.analytics.note)}</div></div>
    </section>
  `;
}

function renderAlmanac() {
  const challenge = state.challenge;
  const deep = state.analytics.deepWork;
  return `
    <div class="almanac-layout">
      <div class="almanac-column">
        ${challenge ? `<section class="challenge"><div class="challenge-kicker">Weekly challenge</div><div class="challenge-text">"${escapeHtml(challenge.text)}"</div><div class="pips">${Array.from({ length: challenge.target }, (_, index) => `<i class="pip ${index < challenge.progress ? 'on' : ''}"></i>`).join('')}<span class="smallcaps">${challenge.progress} of ${challenge.target} - ${challenge.daysLeft} days remaining</span></div></section>` : ''}
        <section class="almanac-card">
          <div class="almanac-card-head"><h3>Deep work</h3></div>
          <div class="counter-grid"><div><span class="smallcaps">${escapeHtml(state.analytics.labels.month)}</span><div class="counter-big">${formatMinutes(deep.monthMinutes)}</div></div><div><span class="smallcaps">YTD ${state.meta.today.slice(0, 4)}</span><div class="counter-big" style="color:var(--accent)">${formatMinutes(deep.yearMinutes)}</div></div></div>
        </section>
        <section class="almanac-card"><div class="almanac-card-head"><h3>Streaks</h3><span class="grow"></span><span class="smallcaps">${state.projects.filter((project) => project.streak > 0).length} active</span></div>${renderStreaks()}</section>
      </div>
      <section class="almanac-card"><div class="almanac-card-head"><h3>This fortnight</h3><span class="grow"></span><span class="smallcaps">${state.milestones.length} entries</span></div>${state.milestones.map((milestone) => `<div class="milestone-row"><span class="milestone-date">${escapeHtml(formatMilestoneDate(milestone.date))}</span><span class="milestone-text">${escapeHtml(milestone.text)}</span></div>`).join('')}</section>
    </div>
  `;
}

function renderStreaks() {
  const projects = state.projects.filter((project) => project.streak > 0).sort((a, b) => b.streak - a.streak);
  if (!projects.length) return '<p class="empty-copy">No active 30-minute streaks yet.</p>';
  return projects.map((project) => {
    const domain = state.domains[project.domain];
    return `<div class="streak-row" style="--domain:${domain.color}"><span class="streak-name">${escapeHtml(project.name)}</span><span class="stat-v">${project.streak}d</span><span class="streak-pips">${Array.from({ length: 12 }, (_, index) => `<i class="${index >= project.streak ? 'cold' : ''}"></i>`).join('')}</span></div>`;
  }).join('');
}

function renderChat() {
  const account = codex.account?.account;
  const subscriptionReady = account?.type === 'chatgpt';
  const activeThread = codex.activeThread;
  const busy = activeThread?.turns?.some((turn) => turn.status === 'inProgress') || Boolean(codex.runningTurns[activeThread?.id]);
  const statusLabel = subscriptionReady ? account.email || `ChatGPT ${account.planType || ''}` : codex.connection;
  return `
    <aside class="chat">
      <div class="chat-top">
        <div class="chat-name">Codex</div>
        <div class="chat-sub"><span class="online-dot ${codex.connection === 'connected' ? '' : 'offline'}"></span><span>${escapeHtml(statusLabel)}</span><span>-</span><span>LifeOS</span></div>
      </div>
      <div class="chat-taskbar">
        <select class="thread-select" aria-label="Codex task" ${codex.opening ? 'disabled' : ''}>
          <option value="">${codex.threads.length ? 'Choose a task' : 'No LifeOS tasks yet'}</option>
          ${codex.threads.map((thread) => `<option value="${escapeAttribute(thread.id)}" ${thread.id === activeThread?.id ? 'selected' : ''}>${escapeHtml(threadTitle(thread))}</option>`).join('')}
        </select>
        <button class="chat-tool-button" data-codex-new type="button" ${!subscriptionReady || codex.opening ? 'disabled' : ''}>New</button>
        <button class="chat-tool-button" data-codex-refresh type="button" ${codex.opening ? 'disabled' : ''}>↻</button>
      </div>
      <div class="chat-body">
        ${renderChatBody(subscriptionReady)}
        ${codex.pendingRequests.map(renderServerRequest).join('')}
      </div>
      ${codex.error ? `<div class="chat-error"><span>${escapeHtml(codex.error)}</span><button data-codex-error-dismiss type="button">Dismiss</button></div>` : ''}
      <form class="chat-form">
        <div class="voice-strip">
          <button class="voice-button" type="button" disabled title="${escapeAttribute(codex.voice.reason)}">Voice unavailable</button>
          <span class="voice-status">${escapeHtml(codex.voice.reason)}</span>
        </div>
        <div class="chat-field">
          <span class="chat-caret">›</span>
          <textarea class="chat-input" name="message" rows="1" placeholder="Ask Codex to log, analyze, or change LifeOS…" ${!subscriptionReady || busy || codex.sending ? 'disabled' : ''}>${escapeHtml(codex.draft)}</textarea>
          ${busy ? '<button class="send-button stop" data-codex-stop type="button">Stop</button>' : `<button class="send-button" type="submit" ${!subscriptionReady || codex.sending ? 'disabled' : ''}>${codex.sending ? 'Sending' : 'Send'}</button>`}
        </div>
        <div class="hint-row"><span>Local app server - no API key</span><span>⌘K</span></div>
      </form>
    </aside>
  `;
}

function renderChatBody(subscriptionReady) {
  if (codex.connection === 'connecting') return '<div class="chat-welcome"><b>Connecting to installed Codex…</b><span>Your signed-in account and LifeOS tasks will appear here.</span></div>';
  if (!subscriptionReady) {
    const message = codex.account
      ? 'Codex is not using a ChatGPT account. Sign in with the installed Codex application, then refresh.'
      : 'Could not reach the installed Codex application. Start Codex or configure CODEX_EXECUTABLE.';
    return `<div class="chat-welcome"><b>Codex account required</b><span>${escapeHtml(message)}</span></div>`;
  }
  if (!codex.activeThread) return '<div class="chat-welcome"><b>One project, another doorway.</b><span>Start a LifeOS task or open an existing one. Codex already has the workspace and its compact instructions.</span></div>';
  const items = codex.activeThread.turns?.flatMap((turn) => turn.items || []) || [];
  if (!items.length) return '<div class="chat-welcome"><b>What should Codex do here?</b><span>Log time, inspect the data, or ask for a deliberate app change.</span></div>';
  return items.map(renderCodexItem).join('');
}

function renderCodexItem(item) {
  if (item.type === 'userMessage') {
    const text = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return `<article class="message user"><div class="message-meta"><b>You</b></div><div class="message-body">${escapeHtml(text)}</div></article>`;
  }
  if (item.type === 'agentMessage') {
    return `<article class="message assistant"><div class="message-meta"><b>Codex</b></div><div class="message-body">${escapeHtml(item.text || '…')}</div></article>`;
  }
  if (item.type === 'commandExecution') return renderActivity(`Command - ${item.status || 'running'}`, [item.command, item.aggregatedOutput].filter(Boolean).join('\n\n'));
  if (item.type === 'fileChange') return renderActivity(`Files - ${item.status || 'changed'}`, (item.changes || []).map((change) => `${change.kind}: ${change.path}\n${change.diff || ''}`).join('\n\n'));
  if (item.type === 'plan') return renderActivity('Plan', item.text || '');
  if (item.type === 'reasoning') return renderActivity('Reasoning', (item.summary || []).join('\n'));
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return renderActivity(`Tool - ${item.server ? `${item.server}/` : ''}${item.tool || 'call'}`, stringifyCompact(item.result || item.error || item.arguments));
  if (item.type === 'contextCompaction') return '<div class="chat-divider">Context compacted</div>';
  return '';
}

function renderActivity(label, body) {
  const compact = String(body || '').slice(0, 6_000);
  return `<details class="chat-activity"><summary>${escapeHtml(label)}</summary>${compact ? `<pre>${escapeHtml(compact)}</pre>` : ''}</details>`;
}

function renderServerRequest(request, index) {
  const params = request.params || {};
  if (request.method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    return `
      <form class="request-card request-input-form" data-request-index="${index}">
        <div class="request-kicker">Codex is asking</div>
        ${questions.map((question) => `<fieldset><legend>${escapeHtml(question.question || question.header || 'Input required')}</legend>${Array.isArray(question.options) ? question.options.map((option, optionIndex) => `<label class="request-option"><input type="radio" name="${escapeAttribute(question.id)}" value="${escapeAttribute(option.label)}" ${optionIndex === 0 ? 'checked' : ''}><span><b>${escapeHtml(option.label)}</b><small>${escapeHtml(option.description || '')}</small></span></label>`).join('') : `<input class="request-text" name="${escapeAttribute(question.id)}" type="${question.isSecret ? 'password' : 'text'}">`}</fieldset>`).join('')}
        <div class="request-actions"><button type="submit">Answer</button></div>
      </form>`;
  }
  const command = params.command || params.reason || (params.grantRoot ? `Write access: ${params.grantRoot}` : 'Codex needs permission to continue.');
  return `
    <section class="request-card">
      <div class="request-kicker">Codex needs approval</div>
      <pre>${escapeHtml(command)}</pre>
      <div class="request-actions">
        <button data-request-index="${index}" data-request-decision="decline" type="button">Decline</button>
        <button data-request-index="${index}" data-request-decision="acceptForSession" type="button">Allow session</button>
        <button data-request-index="${index}" data-request-decision="accept" type="button">Allow once</button>
      </div>
    </section>`;
}

function bindChatEvents() {
  const input = document.querySelector('.chat-input');
  input?.addEventListener('input', () => {
    codex.draft = input.value;
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, input.scrollHeight)}px`;
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendCodexMessage();
    }
  });
  document.querySelector('.chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendCodexMessage();
  });
  document.querySelector('[data-codex-new]')?.addEventListener('click', () => void newCodexThread());
  document.querySelector('[data-codex-refresh]')?.addEventListener('click', () => void refreshCodexThreads());
  document.querySelector('.thread-select')?.addEventListener('change', (event) => {
    if (event.target.value) void openCodexThread(event.target.value);
  });
  document.querySelector('[data-codex-stop]')?.addEventListener('click', () => void interruptCodexTurn());
  document.querySelector('[data-codex-error-dismiss]')?.addEventListener('click', () => {
    codex.error = null;
    renderChatRegion();
  });
  document.querySelectorAll('[data-request-decision]').forEach((button) => {
    button.addEventListener('click', () => void resolveApproval(Number(button.dataset.requestIndex), button.dataset.requestDecision));
  });
  document.querySelectorAll('.request-input-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const request = codex.pendingRequests[Number(form.dataset.requestIndex)];
      if (!request) return;
      const data = new FormData(form);
      const answers = Object.fromEntries((request.params.questions || []).map((question) => [question.id, { answers: [String(data.get(question.id) || '')] }]));
      void respondToCodexRequest(request, { answers });
    });
  });
}

async function bootstrapCodex() {
  codex.connection = 'connecting';
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.connection = body.connection.status;
    codex.connectionDetail = body.connection.executable;
    codex.account = body.account;
    codex.threads = body.threads || [];
    codex.voice = body.voice || codex.voice;
    codex.pendingRequests = body.pendingRequests || [];
    const stored = localStorage.getItem(THREAD_STORAGE_KEY);
    const selected = codex.threads.find((thread) => thread.id === stored) || codex.threads[0];
    if (selected) await openCodexThread(selected.id, { quiet: true });
  } catch (error) {
    codex.connection = 'error';
    codex.error = error.message;
  }
  renderChatRegion();
}

async function refreshCodexThreads() {
  codex.opening = true;
  codex.error = null;
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.connection = body.connection.status;
    codex.account = body.account;
    codex.threads = body.threads || [];
    codex.voice = body.voice || codex.voice;
  } catch (error) {
    codex.error = error.message;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function openCodexThread(threadId, options = {}) {
  codex.opening = true;
  codex.error = null;
  if (!options.quiet) renderChatRegion();
  try {
    const body = await apiJson('/api/codex/thread/read', jsonRequest({ threadId }));
    codex.activeThread = body.thread;
    localStorage.setItem(THREAD_STORAGE_KEY, body.thread.id);
    const running = [...(body.thread.turns || [])].reverse().find((turn) => turn.status === 'inProgress');
    if (running) codex.runningTurns[body.thread.id] = running.id;
    else delete codex.runningTurns[body.thread.id];
  } catch (error) {
    codex.error = error.message;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function newCodexThread() {
  codex.opening = true;
  codex.error = null;
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/thread/start', jsonRequest({}));
    codex.activeThread = body.thread;
    codex.threads = [body.thread, ...codex.threads.filter((thread) => thread.id !== body.thread.id)];
    localStorage.setItem(THREAD_STORAGE_KEY, body.thread.id);
    return body.thread;
  } catch (error) {
    codex.error = error.message;
    return null;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function sendCodexMessage(explicitText = null) {
  const text = String(explicitText ?? codex.draft).trim();
  if (!text || codex.sending) return;
  codex.sending = true;
  codex.error = null;
  const previousDraft = codex.draft;
  codex.draft = '';
  renderChatRegion();
  try {
    const thread = codex.activeThread || await newCodexThread();
    if (!thread) throw new Error('Could not start a Codex task.');
    const body = await apiJson('/api/codex/turn/start', jsonRequest({ threadId: thread.id, message: text }));
    codex.activeThread = upsertTurn(codex.activeThread || thread, body.turn);
    codex.runningTurns[thread.id] = body.turn.id;
  } catch (error) {
    codex.error = error.message;
    codex.draft = previousDraft || text;
  } finally {
    codex.sending = false;
    renderChatRegion();
  }
}

async function interruptCodexTurn() {
  const threadId = codex.activeThread?.id;
  const turnId = threadId ? codex.runningTurns[threadId] || [...(codex.activeThread.turns || [])].reverse().find((turn) => turn.status === 'inProgress')?.id : null;
  if (!threadId || !turnId) return;
  try {
    await apiJson('/api/codex/turn/interrupt', jsonRequest({ threadId, turnId }));
  } catch (error) {
    codex.error = error.message;
    renderChatRegion();
  }
}

async function resolveApproval(index, decision) {
  const request = codex.pendingRequests[index];
  if (!request) return;
  if (request.method === 'item/permissions/requestApproval') {
    const permissions = Object.fromEntries(Object.entries(request.params.permissions || {}).filter(([, value]) => value !== null));
    const result = decision === 'decline' ? { permissions: {}, scope: 'turn' } : { permissions, scope: decision === 'acceptForSession' ? 'session' : 'turn' };
    await respondToCodexRequest(request, result);
    return;
  }
  await respondToCodexRequest(request, { decision });
}

async function respondToCodexRequest(request, result) {
  try {
    await apiJson('/api/codex/request/respond', jsonRequest({ id: request.id, result }));
    codex.pendingRequests = codex.pendingRequests.filter((candidate) => candidate.id !== request.id);
  } catch (error) {
    codex.error = error.message;
  }
  renderChatRegion();
}

function connectEventStream() {
  eventSource?.close();
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('codex', (event) => {
    try {
      handleCodexEvent(JSON.parse(event.data));
    } catch (error) {
      codex.error = `Could not read a Codex event: ${error.message}`;
      renderChatRegion();
    }
  });
  eventSource.addEventListener('lifeos', () => scheduleStateRefresh());
  eventSource.addEventListener('error', () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      codex.connection = 'disconnected';
      renderChatRegion();
    }
  });
}

function handleCodexEvent(event) {
  if (event.type === 'connection') {
    codex.connection = event.status;
    codex.connectionDetail = event.detail || codex.connectionDetail;
    if (event.status === 'error') codex.error = event.detail || 'Codex connection failed.';
    renderChatRegion();
    return;
  }
  if (event.type === 'serverRequest') {
    if (!codex.pendingRequests.some((request) => request.id === event.request.id)) codex.pendingRequests.push(event.request);
    renderChatRegion();
    return;
  }
  if (event.type !== 'notification') return;
  const { method, params } = event;
  const threadId = typeof params.threadId === 'string' ? params.threadId : null;
  if (method === 'turn/started' && threadId && params.turn) {
    codex.runningTurns[threadId] = params.turn.id;
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertTurn(codex.activeThread, params.turn);
  } else if ((method === 'item/started' || method === 'item/completed') && threadId && params.turnId && params.item) {
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertItem(codex.activeThread, params.turnId, params.item);
  } else if ((method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta') && threadId && params.turnId && params.itemId && typeof params.delta === 'string') {
    if (codex.activeThread?.id === threadId) codex.activeThread = appendItemDelta(codex.activeThread, params.turnId, params.itemId, method === 'item/agentMessage/delta' ? 'text' : 'aggregatedOutput', params.delta);
  } else if (method === 'turn/completed' && threadId && params.turn) {
    delete codex.runningTurns[threadId];
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertTurn(codex.activeThread, params.turn);
    scheduleStateRefresh();
    void refreshThreadsQuietly();
  } else if (method === 'serverRequest/resolved' && params.requestId !== undefined) {
    codex.pendingRequests = codex.pendingRequests.filter((request) => request.id !== params.requestId);
  } else if (method === 'error') {
    codex.error = params.error?.message || 'Codex reported an error.';
  }
  renderChatRegion();
}

async function refreshThreadsQuietly() {
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.threads = body.threads || codex.threads;
    renderChatRegion();
  } catch {
    // A completed turn is still visible even if the history refresh briefly fails.
  }
}

function scheduleStateRefresh() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(() => void refreshState(), 100);
}

async function refreshState() {
  try {
    state = await fetchState(activeRange);
    pageError = null;
    recommendationIndex = Math.min(recommendationIndex, Math.max(0, state.recommendations.length - 1));
    render();
  } catch (error) {
    pageError = error.message;
    render();
  }
}

function upsertTurn(thread, turn) {
  const turns = [...(thread.turns || [])];
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  if (index === -1) turns.push(turn);
  else turns[index] = turn;
  return { ...thread, turns };
}

function upsertItem(thread, turnId, item) {
  const turn = (thread.turns || []).find((candidate) => candidate.id === turnId);
  if (!turn) return upsertTurn(thread, { id: turnId, items: [item], status: 'inProgress', error: null });
  const items = [...(turn.items || [])];
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) items.push(item);
  else items[index] = item;
  return upsertTurn(thread, { ...turn, items });
}

function appendItemDelta(thread, turnId, itemId, field, delta) {
  const turn = (thread.turns || []).find((candidate) => candidate.id === turnId);
  const current = turn?.items?.find((candidate) => candidate.id === itemId);
  const item = current
    ? { ...current, [field]: `${String(current[field] || '')}${delta}` }
    : { id: itemId, type: field === 'text' ? 'agentMessage' : 'commandExecution', [field]: delta };
  return upsertItem(thread, turnId, item);
}

function scrollChatToEnd() {
  const scroll = () => {
    const body = document.querySelector('.chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  };
  scroll();
  requestAnimationFrame(() => {
    scroll();
    setTimeout(scroll, 50);
  });
}

function jsonRequest(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function threadTitle(thread) {
  return String(thread.name || thread.preview || 'Untitled LifeOS task').trim();
}

function groupByActivity(entries) {
  return entries.reduce((acc, entry) => {
    acc[entry.activityType] = (acc[entry.activityType] || 0) + entry.durationMinutes;
    return acc;
  }, {});
}

function activityColor(type) {
  const colors = {
    research: state.domains.research.color,
    creative: state.domains.filmmaking.color,
    communication: state.domains.content.color,
    shallow_work: 'var(--ink-faint)',
    admin: 'var(--ink-ghost)',
    deep_work: 'var(--ink)',
  };
  return colors[type] || 'var(--accent)';
}

function cssHealth(health) {
  if (health === 'critical') return 'var(--critical)';
  if (health === 'attention') return 'var(--attention)';
  return 'var(--healthy)';
}

function formatDayTotal(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  return `${hours}h <span style="color:var(--ink-dim)">${mins}</span>`;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}`;
}

function formatHours(hours) {
  return formatMinutes(Math.round(Number(hours || 0) * 60));
}

function formatDateLong(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: 'UTC' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase();
  return { weekday, rest: `${day} ${month} ${date.getUTCFullYear()}` };
}

function formatMilestoneDate(dateString) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(`${dateString}T12:00:00Z`));
}

function formatClock(isoString) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(isoString));
}

function titleNumber(value) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[value] || String(value);
}

function heatmapColor(value) {
  if (value < 0.04) return '#eee7d6';
  const t = Math.pow(Math.min(1, value), 0.7);
  const r = Math.round(0xee + (0xa4 - 0xee) * t);
  const g = Math.round(0xe7 + (0x4a - 0xe7) * t);
  const b = Math.round(0xd6 + (0x26 - 0xd6) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function stringifyCompact(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
