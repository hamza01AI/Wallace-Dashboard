import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import './App.css'

type AirtableRecord = {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

type DashboardData = {
  generatedAt: string
  usage?: {
    models?: Array<{ model: string; totalCostUSD: number }>
    error?: string
    message?: string
  }
  news?: NewsReport | null
  tables: {
    proposals: AirtableRecord[]
    acquisitions: AirtableRecord[]
    tenders: AirtableRecord[]
  }
}

type NewsSource = {
  label: string
  url: string
}

type NewsItem = {
  title?: string
  location?: string
  opportunity?: string
  recommendedAction?: string
  summary?: string
  bullets?: string[]
  urgent?: boolean
  sources?: NewsSource[]
}

type NewsSection = {
  key: string
  title: string
  headline: string
  bullets: string[]
  items?: NewsItem[]
}

type NewsReport = {
  generatedAt: string
  timezone?: string
  headline: string
  urgentCount?: number
  sourceCount?: number
  telegramSummary?: string
  sections: NewsSection[]
}

type View = 'overview' | 'work' | 'deals' | 'tenders'

type NavItem = {
  view: View
  label: string
  caption: string
  badge: string
  icon: string
}

type UtilityItem = {
  label: string
  caption: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { view: 'overview', label: 'Overview', caption: 'Usage and system', badge: '01', icon: '⌂' },
  { view: 'work', label: 'CRM', caption: 'Work proposals', badge: '02', icon: '▦' },
  { view: 'deals', label: 'Deals', caption: 'Acquisitions', badge: '03', icon: '◆' },
  { view: 'tenders', label: 'Tenders', caption: 'Pipeline watch', badge: '04', icon: '△' },
]

const UTILITY_ITEMS: UtilityItem[] = [
  { label: 'Docs', caption: 'Workspace notes', icon: '⌘' },
  { label: 'Settings', caption: 'System options', icon: '⚙' },
]

const moneyFields = [
  'Monthly Cost Not Incl GST',
  'Total Monthly Invoiced Amount Incl GST',
  'Est. Monthly Revenue',
  'Est. Monthly Profit',
  'Estimated Value',
]

function createEmptyDashboard(message = 'Airtable is unavailable right now.') {
  return {
    generatedAt: new Date().toISOString(),
    usage: {
      error: 'offline',
      message,
    },
    news: null,
    tables: {
      proposals: [],
      acquisitions: [],
      tenders: [],
    },
  }
}

function text(value: unknown, fallback = 'Not set') {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function money(value: unknown) {
  const amount = numberValue(value)
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function usd(value: unknown) {
  const amount = numberValue(value)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount)
}

function dateLabel(value: unknown) {
  if (!value) return 'No date'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return text(value)
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function formatReportTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function daysUntil(value: unknown) {
  if (!value) return null
  const target = new Date(String(value))
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function getStatus(record: AirtableRecord, field = 'Status') {
  return text(record.fields[field], 'Unsorted')
}

function isOpenStatus(status: string) {
  return !/(won|lost|closed|complete|declined|inactive)/i.test(status)
}

function sortByDate(records: AirtableRecord[], field: string) {
  return [...records].sort((a, b) => {
    const aTime = new Date(String(a.fields[field] || '9999-12-31')).getTime()
    const bTime = new Date(String(b.fields[field] || '9999-12-31')).getTime()
    return aTime - bTime
  })
}

function statusGroups(records: AirtableRecord[], field = 'Status') {
  return records.reduce<Record<string, number>>((groups, record) => {
    const status = getStatus(record, field)
    groups[status] = (groups[status] || 0) + 1
    return groups
  }, {})
}

function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'plain',
}: {
  label: string
  value: string | number
  note: string
  icon: string
  tone?: 'plain' | 'green' | 'blue' | 'amber'
}) {
  return (
    <article className={`stat stat-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <p>{note}</p>
      </div>
      <button type="button" aria-label={`${label} options`}>
        ...
      </button>
    </article>
  )
}

function Sidebar({
  activeView,
  onViewChange,
  variant = 'desktop',
  open = false,
  collapsed = false,
  onToggleCollapse,
  onClose,
  totalRecords,
  usageLabel,
  refreshLabel,
  generatedAt,
}: {
  activeView: View
  onViewChange: (view: View) => void
  variant?: 'desktop' | 'mobile'
  open?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
  onClose?: () => void
  totalRecords: number
  usageLabel: string
  refreshLabel: string
  generatedAt: string
}) {
  return (
    <aside
      className={[
        'sidebar',
        `sidebar-${variant}`,
        variant === 'mobile' && open ? 'is-open' : '',
        variant === 'desktop' && collapsed ? 'is-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={variant === 'mobile' ? !open : undefined}
    >
      <div className="sidebar-header">
        <div className="brand-lockup">
          <span>W</span>
          <div className="brand-copy">
            <strong>Wallace</strong>
            <p>Control room</p>
          </div>
        </div>
        <div className="sidebar-actions">
          {variant === 'desktop' ? (
            <button
              className="sidebar-toggle"
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '›' : '‹'}
            </button>
          ) : (
            <button className="sidebar-close" type="button" onClick={onClose} aria-label="Close menu">
              Close
            </button>
          )}
        </div>
      </div>
      <div className="sidebar-search">
        <span aria-hidden="true">⌕</span>
        <input aria-label="Search dashboard" placeholder="Search workspace" />
      </div>
      <button className="primary-action" onClick={() => onViewChange('work')} type="button">
        <strong>Open CRM</strong>
        <span>+</span>
      </button>
      <nav aria-label="Dashboard sections" className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={activeView === item.view ? 'active' : ''}
            onClick={() => onViewChange(item.view)}
            type="button"
          >
            <i aria-hidden="true">{item.icon}</i>
            <div className="nav-copy">
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </div>
            <b aria-hidden="true">{item.badge}</b>
          </button>
        ))}
        <div className="sidebar-divider" />
        {UTILITY_ITEMS.map((item) => (
          <button key={item.label} className="utility-item" type="button">
            <i aria-hidden="true">{item.icon}</i>
            <div className="nav-copy">
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </div>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-stat">
          <span>Total records</span>
          <strong>{totalRecords}</strong>
        </div>
        <div className="sidebar-stat">
          <span>Model usage</span>
          <strong>{usageLabel}</strong>
        </div>
        <div className="sidebar-stat">
          <span>Workspace refresh</span>
          <strong>{refreshLabel}</strong>
        </div>
        <p>Shell updated {formatReportTime(generatedAt)}</p>
      </div>
    </aside>
  )
}

function MobileHeader({
  generatedAt,
  activeView,
  onMenuToggle,
  menuOpen,
}: {
  generatedAt: string
  activeView: View
  onMenuToggle: () => void
  menuOpen: boolean
}) {
  const labels: Record<View, string> = {
    overview: 'Overview',
    work: 'CRM',
    deals: 'Deals',
    tenders: 'Tenders',
  }

  return (
    <header className="mobile-header">
      <div className="brand-lockup mobile-brand">
        <span>W</span>
        <div className="brand-copy">
          <strong>Wallace</strong>
          <p>{labels[activeView]}</p>
        </div>
      </div>
      <div className="mobile-header-meta">
        <time>
          Updated {new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
        <button
          className="mobile-menu-button"
          type="button"
          onClick={onMenuToggle}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          title={menuOpen ? 'Close menu' : 'Open menu'}
        >
          <span className="mobile-menu-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <strong>Menu</strong>
        </button>
      </div>
    </header>
  )
}

function RecordRow({
  title,
  meta,
  amount,
  badge,
}: {
  title: string
  meta: string
  amount?: string
  badge?: string
}) {
  return (
    <li className="record-row">
      <div>
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="record-side">
        {amount ? <b>{amount}</b> : null}
        {badge ? <em>{badge}</em> : null}
      </div>
    </li>
  )
}

function FieldCheck({ data, connected }: { data: DashboardData; connected: boolean }) {
  const tables = data.tables
  const populatedMoney = moneyFields.filter((field) =>
    [...tables.proposals, ...tables.acquisitions, ...tables.tenders].some((record) =>
      Boolean(record.fields[field]),
    ),
  )

  return (
    <section className="panel compact-panel">
      <div className="section-title">
        <p>Data wiring</p>
        <h2>{connected ? 'Airtable is connected' : 'Airtable is offline'}</h2>
      </div>
      <div className="wiring-grid">
        <span>Work CRM</span>
        <strong>{tables.proposals.length} proposals</strong>
        <span>Wallace base</span>
        <strong>{tables.acquisitions.length + tables.tenders.length} tracked items</strong>
        <span>Money fields</span>
        <strong>{populatedMoney.length || 'None populated yet'}</strong>
      </div>
    </section>
  )
}

function StatusBreakdown({ groups }: { groups: Record<string, number> }) {
  const rows = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const max = Math.max(...rows.map(([, count]) => count), 1)

  return (
    <ul className="status-breakdown">
      {rows.map(([status, count]) => (
        <li key={status}>
          <div>
            <span>{status}</span>
            <strong>{count}</strong>
          </div>
          <i style={{ '--scale': `${Math.max(8, (count / max) * 100)}%` } as CSSProperties} />
        </li>
      ))}
    </ul>
  )
}

function DonutMetric({
  value,
  label,
  tone = 'purple',
}: {
  value: number
  label: string
  tone?: 'purple' | 'orange'
}) {
  const clamped = Math.max(0, Math.min(value, 100))

  return (
    <div className={`donut-card donut-${tone}`}>
      <div className="donut" style={{ '--value': `${clamped}%` } as CSSProperties}>
        <strong>{clamped}%</strong>
      </div>
      <span>{label}</span>
    </div>
  )
}

function ModelUsagePanel({
  usage,
  generatedAt,
}: {
  usage: DashboardData['usage']
  generatedAt: string
}) {
  const models = usage?.models ?? []
  const total = models.reduce((sum, model) => sum + model.totalCostUSD, 0)
  const topModel = models.reduce<(typeof models)[number] | null>(
    (top, model) => (!top || model.totalCostUSD > top.totalCostUSD ? model : top),
    null,
  )
  const maxSpend = Math.max(...models.map((model) => model.totalCostUSD), 1)

  return (
    <>
      <div className="section-title inline-title">
        <div>
          <p>Usage</p>
          <h2>Model usage</h2>
        </div>
        <span>
          Updated{' '}
          {new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="usage-insight">
        <div className="usage-kpi-grid">
          <div>
            <span>Total tracked</span>
            <strong>{models.length ? usd(total) : 'Offline'}</strong>
          </div>
          <div>
            <span>Top model</span>
            <strong>{topModel?.model ?? 'No data'}</strong>
          </div>
          <div>
            <span>Models</span>
            <strong>{models.length}</strong>
          </div>
        </div>

        <ul className="usage-model-list">
          {models.slice(0, 5).map((model) => (
            <li key={model.model}>
              <div>
                <span>{model.model}</span>
                <strong>{usd(model.totalCostUSD)}</strong>
              </div>
              <i style={{ '--scale': `${Math.max(8, (model.totalCostUSD / maxSpend) * 100)}%` } as CSSProperties} />
            </li>
          ))}
          {!models.length && <li className="usage-empty">No local model usage available yet.</li>}
        </ul>
      </div>
    </>
  )
}

function TopBar({ generatedAt }: { generatedAt: string }) {
  return (
    <header className="topbar">
      <label className="search-box">
        <span>Search</span>
        <input aria-label="Search dashboard" placeholder="Search..." />
      </label>
      <div className="topbar-meta">
        <span className="bell-dot" aria-label="Notifications" />
        <div className="profile-pill">
          <span>WG</span>
          <strong>Wallace</strong>
        </div>
        <time>
          Updated{' '}
          {new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </header>
  )
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [activeView, setActiveView] = useState<View>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadDashboard() {
      try {
        const response = await fetch('/api/dashboard')
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message || 'Dashboard API failed')
        if (alive) {
          setData(payload)
          setError(null)
        }
      } catch (loadError) {
        if (alive) {
          const message = loadError instanceof Error ? loadError.message : 'Unable to load dashboard'
          setError(message)
          setData((current) => current ?? createEmptyDashboard(message))
        }
      }
    }

    loadDashboard()
    const timer = window.setInterval(loadDashboard, 120000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [reloadTick])

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth > 920) setMenuOpen(false)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const summary = useMemo(() => {
    if (!data) return null

    const { proposals, acquisitions, tenders } = data.tables
    const openProposals = proposals.filter((record) => isOpenStatus(getStatus(record)))
    const proposalRevenue = proposals.reduce(
      (sum, record) => sum + numberValue(record.fields['Total Monthly Invoiced Amount Incl GST']),
      0,
    )
    const acquisitionProfit = acquisitions.reduce(
      (sum, record) => sum + numberValue(record.fields['Est. Monthly Profit']),
      0,
    )
    const openTenders = tenders.filter((record) => isOpenStatus(getStatus(record)))
    const nextActions = sortByDate(acquisitions, 'Next Action Date').filter(
      (record) => daysUntil(record.fields['Next Action Date']) !== null,
    )
    const closingTenders = sortByDate(openTenders, 'Close Date').slice(0, 4)

    return {
      proposals,
      acquisitions,
      tenders,
      openProposals,
      proposalRevenue,
      acquisitionProfit,
      openTenders,
      nextActions,
      closingTenders,
      proposalStatuses: statusGroups(proposals),
      acquisitionStages: statusGroups(acquisitions, 'Stage'),
      tenderStatuses: statusGroups(tenders),
    }
  }, [data])

  if (!data || !summary) {
    return (
      <main className="app-shell centered">
        <section className="loading-panel">
          <span className="pulse-dot" />
          <p>Wiring up Airtable</p>
        </section>
      </main>
    )
  }

  const sidebarUsageLabel =
    data.usage?.models?.[0]?.model && data.usage?.models?.[0]?.totalCostUSD !== undefined
      ? usd(data.usage.models[0].totalCostUSD)
      : data.usage?.message || 'Offline'
  const sidebarRefreshLabel = formatReportTime(data.generatedAt)
  const sidebarTotalRecords = summary.proposals.length + summary.acquisitions.length + summary.tenders.length
  const handleViewChange = (view: View) => {
    setActiveView(view)
    setMenuOpen(false)
  }

  return (
    <main
      className="app-shell"
      style={{ '--sidebar-width': sidebarCollapsed ? '94px' : '282px' } as CSSProperties}
    >
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        variant="desktop"
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        totalRecords={sidebarTotalRecords}
        usageLabel={sidebarUsageLabel}
        refreshLabel={sidebarRefreshLabel}
        generatedAt={data.generatedAt}
      />
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        variant="mobile"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        totalRecords={sidebarTotalRecords}
        usageLabel={sidebarUsageLabel}
        refreshLabel={sidebarRefreshLabel}
        generatedAt={data.generatedAt}
      />
      {menuOpen ? (
        <button
          type="button"
          className="mobile-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <section className="workspace">
        {error ? (
          <section className="status-banner status-banner-warning" role="status">
            <div>
              <strong>Offline mode</strong>
              <p>{error}. The dashboard is still usable with the last available shell.</p>
            </div>
            <button type="button" onClick={() => setReloadTick((value) => value + 1)}>
              Retry Airtable
            </button>
          </section>
        ) : null}
        <MobileHeader
          generatedAt={data.generatedAt}
          activeView={activeView}
          onMenuToggle={() => setMenuOpen((value) => !value)}
          menuOpen={menuOpen}
        />
        <TopBar generatedAt={data.generatedAt} />

      {activeView === 'overview' && (
        <>
          <header className="app-header app-header-hero">
            <div>
              <p>Wallace dashboard</p>
              <h1>Overview</h1>
              <span>Composed for dense reading, fast scanning, and clear hierarchy.</span>
            </div>
            <div className="header-chip">
              <span>Live shell</span>
              <strong>{error ? 'Offline mode' : 'Connected'}</strong>
            </div>
          </header>

          <section className="grid stats-grid">
            <StatCard
              label="Codex usage"
              value={data.usage?.models?.[0] ? usd(data.usage.models[0].totalCostUSD) : 'Offline'}
              note={data.usage?.models?.[0]?.model || data.usage?.message || 'Local usage log'}
              icon="$"
              tone="blue"
            />
            <StatCard
              label="Airtable sync"
              value={error ? 'Offline' : 'Live'}
              note={
                error
                  ? 'Browse the dashboard while Airtable reconnects'
                  : `${sidebarTotalRecords} total records indexed`
              }
              icon="A"
              tone={error ? 'amber' : 'green'}
            />
            <StatCard
              label="CRM health"
              value={summary.openProposals.length}
              note="Open proposals waiting in CRM"
              icon="P"
              tone="amber"
            />
            <StatCard
              label="Open tenders"
              value={summary.openTenders.length}
              note="Live tenders still in the pipeline"
              icon="T"
              tone="blue"
            />
          </section>

          <section className="dashboard-grid">
            <section className="panel wide-panel model-panel">
              <ModelUsagePanel usage={data.usage} generatedAt={data.generatedAt} />
            </section>

            <section className="panel trend-panel">
              <div className="section-title">
                <p>Pipeline</p>
                <h2>CRM activity trend</h2>
              </div>
              <div className="chart-split">
                <StatusBreakdown groups={summary.proposalStatuses} />
                <DonutMetric
                  value={Math.round((summary.openProposals.length / Math.max(summary.proposals.length, 1)) * 100)}
                  label="Open CRM"
                />
              </div>
            </section>

            <section className="panel focus-panel">
              <div className="section-title">
                <p>System</p>
                <h2>Useful queue</h2>
              </div>
              <div className="focus-list">
                <div>
                  <span>Open CRM</span>
                  <strong>{summary.openProposals.length}</strong>
                </div>
                <div>
                  <span>Open tenders</span>
                  <strong>{summary.openTenders.length}</strong>
                </div>
                <div>
                  <span>Next actions</span>
                  <strong>{summary.nextActions.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel division-panel">
              <div className="section-title">
                <p>Models</p>
                <h2>Spend by model</h2>
              </div>
              <ul className="division-list">
                {data.usage?.models?.slice(0, 4).map((model, index) => (
                  <li key={model.model}>
                    <span>{model.model}</span>
                    <strong>{usd(model.totalCostUSD)}</strong>
                    <i style={{ '--scale': `${Math.max(18, 100 - index * 18)}%` } as CSSProperties} />
                  </li>
                ))}
                {!data.usage?.models?.length && <li>No local model usage available yet.</li>}
              </ul>
            </section>

            <FieldCheck data={data} connected={!error} />
          </section>
        </>
      )}

      {activeView === 'work' && (
        <>
          <header className="app-header">
            <div>
              <p>Airtable CRM</p>
              <h1>Work CRM</h1>
            </div>
          </header>
          <section className="grid stats-grid">
            <StatCard
              label="Open proposals"
              value={summary.openProposals.length}
              note={`${summary.proposals.length} total in work CRM`}
              icon="P"
              tone="blue"
            />
            <StatCard
              label="Monthly pipeline"
              value={money(summary.proposalRevenue)}
              note="Total invoiced amount field"
              icon="$"
              tone="green"
            />
            <StatCard
              label="Statuses"
              value={Object.keys(summary.proposalStatuses).length}
              note="Distinct proposal states"
              icon="S"
              tone="amber"
            />
            <StatCard label="Records" value={summary.proposals.length} note="Synced from Airtable" icon="A" />
          </section>

          <section className="panel full-panel">
            <div className="section-title">
              <p>Proposal Submissions Master</p>
              <h2>Work CRM pipeline</h2>
            </div>
            <div className="status-strip">
              {Object.entries(summary.proposalStatuses).map(([status, count]) => (
                <span key={status}>
                  {status} <b>{count}</b>
                </span>
              ))}
            </div>
            <ul className="record-list">
              {summary.proposals.slice(0, 12).map((record) => (
                <RecordRow
                  key={record.id}
                  title={text(record.fields['Company Name'])}
                  meta={`${text(record.fields["Client's Name"])} · ${text(record.fields['Frequency of service'])}`}
                  amount={money(record.fields['Total Monthly Invoiced Amount Incl GST'])}
                  badge={text(record.fields.Status)}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {activeView === 'deals' && (
        <>
          <header className="app-header">
            <div>
              <p>Wallace base</p>
              <h1>Acquisition board</h1>
            </div>
          </header>
          <section className="panel full-panel">
            <div className="section-title">
              <p>Wallace base</p>
              <h2>Acquisition targets</h2>
            </div>
            <div className="status-strip">
              {Object.entries(summary.acquisitionStages).map(([stage, count]) => (
                <span key={stage}>
                  {stage} <b>{count}</b>
                </span>
              ))}
            </div>
            <ul className="record-list">
              {summary.acquisitions.map((record) => (
                <RecordRow
                  key={record.id}
                  title={text(record.fields.Target)}
                  meta={`${text(record.fields.Region)} · ${text(record.fields.Stage)} · fit ${text(record.fields['Fit Score'], 'n/a')}`}
                  amount={money(record.fields['Est. Monthly Profit'])}
                  badge={text(record.fields.Priority)}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {activeView === 'tenders' && (
        <>
          <header className="app-header">
            <div>
              <p>Wallace base</p>
              <h1>Tender watch</h1>
            </div>
          </header>
          <section className="panel full-panel">
            <div className="section-title">
              <p>Wallace base</p>
              <h2>Tender watch</h2>
            </div>
            <div className="status-strip">
              {Object.entries(summary.tenderStatuses).map(([status, count]) => (
                <span key={status}>
                  {status} <b>{count}</b>
                </span>
              ))}
            </div>
            <ul className="record-list">
              {sortByDate(summary.tenders, 'Close Date').map((record) => (
                <RecordRow
                  key={record.id}
                  title={text(record.fields['Tender Name'])}
                  meta={`${text(record.fields['Authority / Client'])} · closes ${dateLabel(record.fields['Close Date'])}`}
                  amount={money(record.fields['Estimated Value'])}
                  badge={text(record.fields.Status)}
                />
              ))}
            </ul>
          </section>
        </>
      )}
      </section>
    </main>
  )
}

export default App
