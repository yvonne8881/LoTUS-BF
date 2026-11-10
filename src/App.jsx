import { useCallback, useEffect, useRef, useState } from 'react'
import { Terms } from './components/Terms'
import { QueryBuilder } from './components/QueryBuilder'
import { Studies } from './components/Studies'
import { NiiViewer } from './components/NiiViewer'
import { AccountDialog } from './components/AccountDialog'
import { WorkspaceDrawer } from './components/WorkspaceDrawer'
import { useUrlQueryState } from './hooks/useUrlQueryState'
import { useResearchWorkspace } from './hooks/useResearchWorkspace'
import { Brain3DViewer } from './components/Brain3DViewer'
import lotusLogo from './assets/lotus-bf-logo.png'
import './App.css'

const SEARCH_HISTORY_KEY = 'lotus-bf-saved-search-history-v1'
const MAX_SEARCH_HISTORY = 50

function readSearchHistory () {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) || '[]')
    return Array.isArray(saved)
      ? saved.filter((item) => (
        item &&
        typeof item.id === 'string' &&
        typeof item.query === 'string' &&
        typeof item.savedAt === 'string'
      )).slice(0, MAX_SEARCH_HISTORY)
      : []
  } catch {
    return []
  }
}

export default function App () {
  const [query, setQuery] = useUrlQueryState('q')
  const [draftQuery, setDraftQuery] = useState(query)
  const [selectedStudyId, setSelectedStudyId] = useState('')
  const [selectedStudy, setSelectedStudy] = useState(null)
  const [coordinateFields, setCoordinateFields] = useState({ x: '', y: '', z: '' })
  const research = useResearchWorkspace()
  const { ready: workspaceReady, user: accountUser, workspaceState, saveWorkspaceState } = research
  const [searchHistory, setSearchHistory] = useState(readSearchHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [viewerMode, setViewerMode] = useState('2d');
  const [hasEntered, setHasEntered] = useState(false)
  const handlePickTerm = useCallback((term) => {
    setDraftQuery((current) => (current ? `${current} ${term}` : term))
  }, [])

  useEffect(() => {
    setDraftQuery(query)
    setSelectedStudyId('')
    setSelectedStudy(null)
  }, [query])

  const handleSearch = useCallback(() => {
    setSelectedStudyId('')
    setSelectedStudy(null)
    setQuery(draftQuery.trim())
  }, [draftQuery, setQuery])

  const handleClearQuery = useCallback(() => {
    setDraftQuery('')
    setSelectedStudyId('')
    setSelectedStudy(null)
    setQuery('')
  }, [setQuery])

  const handleCoordinateSearch = (event) => {
    event.preventDefault()
    const values = [coordinateFields.x, coordinateFields.y, coordinateFields.z].map(Number)
    if (values.some((value) => !Number.isFinite(value))) return
    const coordinateQuery = `[${values.join(', ')}]`
    setDraftQuery(coordinateQuery)
    setSelectedStudyId('')
    setSelectedStudy(null)
    setQuery(coordinateQuery)
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(searchHistory))
    } catch {
      // The app remains usable when browser storage is unavailable.
    }
  }, [searchHistory])

  useEffect(() => {
    if (!historyOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [historyOpen])

  const gridRef = useRef(null)
  const [sizes, setSizes] = useState([24, 39, 37])
  const restoredForUser = useRef(null)
  const minPaneWidth = 230

  useEffect(() => {
    if (workspaceReady && accountUser) setHasEntered(true)
  }, [workspaceReady, accountUser])

  useEffect(() => {
    if (!workspaceReady) return
    if (!accountUser) {
      restoredForUser.current = null
      return
    }
    if (restoredForUser.current === accountUser.id) return
    restoredForUser.current = accountUser.id
    if (workspaceState?.query) setQuery(workspaceState.query)
    if (Array.isArray(workspaceState?.paneSizes) && workspaceState.paneSizes.length === 3) {
      const paneSizes = workspaceState.paneSizes.map(Number)
      if (paneSizes.every((size) => Number.isFinite(size) && size >= 10 && size <= 80)) setSizes(paneSizes)
    }
  }, [workspaceReady, accountUser, workspaceState, setQuery])

  useEffect(() => {
    if (!workspaceReady || (accountUser && restoredForUser.current !== accountUser.id)) return undefined
    const timer = window.setTimeout(() => {
      saveWorkspaceState({ query, paneSizes: sizes })
        .catch((error) => setWorkspaceError(error?.message || String(error)))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [workspaceReady, accountUser, query, sizes, saveWorkspaceState])

  const startDrag = (which, event) => {
    event.preventDefault()
    const startX = event.clientX
    const total = gridRef.current.getBoundingClientRect().width
    const currentPx = sizes.map((percent) => (percent / 100) * total)

    const onPointerMove = (pointerEvent) => {
      const dx = pointerEvent.clientX - startX
      if (which === 0) {
        let left = currentPx[0] + dx
        let middle = currentPx[1] - dx
        if (left < minPaneWidth) { middle -= minPaneWidth - left; left = minPaneWidth }
        if (middle < minPaneWidth) { left -= minPaneWidth - middle; middle = minPaneWidth }
        const leftPct = (left / total) * 100
        const middlePct = (middle / total) * 100
        setSizes([leftPct, middlePct, Math.max(0, 100 - leftPct - middlePct)])
      } else {
        let middle = currentPx[1] + dx
        let right = currentPx[2] - dx
        if (middle < minPaneWidth) { right -= minPaneWidth - middle; middle = minPaneWidth }
        if (right < minPaneWidth) { middle -= minPaneWidth - right; right = minPaneWidth }
        const middlePct = (middle / total) * 100
        const rightPct = (right / total) * 100
        setSizes([currentPx[0] / total * 100, middlePct, rightPct])
      }
    }
    const stopDrag = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag, { once: true })
  }

  const adjustPane = (which, direction) => {
    const next = [...sizes]
    const step = direction * 2
    const first = which === 0 ? 0 : 1
    const second = first + 1
    if (next[first] + step < 16 || next[second] - step < 16) return
    next[first] += step
    next[second] -= step
    setSizes(next)
  }

  const saveCurrentSearch = (queryToSave = query) => {
    const currentQuery = String(queryToSave || '').trim()
    if (!currentQuery) return

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      query: currentQuery,
      savedAt: new Date().toISOString()
    }
    setSearchHistory((current) => [record, ...current].slice(0, MAX_SEARCH_HISTORY))
  }

  const formatSavedTime = (savedAt) => {
    const date = new Date(savedAt)
    if (Number.isNaN(date.getTime())) return savedAt
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date)
  }

  const handleSignIn = async (mode, username, password) => {
    setWorkspaceError('')
    await research.signIn(mode, username, password)
    setHasEntered(true)
  }

  const handleCreateGroup = async (name) => {
    setWorkspaceError('')
    await research.createGroup(name)
  }

  const handleDeleteGroup = async (id) => {
    setWorkspaceError('')
    await research.deleteGroup(id)
  }

  const handleAddPaper = async (groupId, paper) => {
    setWorkspaceError('')
    await research.addPaperToGroup(groupId, paper)
  }

  const handleUpdateGroupNote = async (groupId, paperKey, note) => {
    setWorkspaceError('')
    await research.updateGroupNote(groupId, paperKey, note)
  }

  const handleRemoveGroupPaper = async (groupId, paperKey) => {
    setWorkspaceError('')
    await research.removePaperFromGroup(groupId, paperKey)
  }

  if (!hasEntered) {
    return (
      <main className='entry-page'>
        <div className='entry-page__backdrop' aria-hidden='true'><span /><span /><span /></div>
        <section className='entry-card' aria-labelledby='entry-title'>
          <img className='entry-card__logo' src={lotusLogo} alt='LoTUS-BF' />
          <h1 className='entry-card__brand' id='entry-title'>
            <span>Connect Concepts.</span>
            <span>Discover Brain Function.</span>
          </h1>
          <p className='entry-card__tagline'>Location-or-Term Unified Search for Brain Functions</p>
          <div className='entry-card__features' aria-label='Workspace features'>
            <span>Concept search</span>
            <span>Literature groups</span>
            <span>2D brain maps</span>
          </div>
          <div className='entry-card__actions'>
            <button type='button' className='entry-card__guest' onClick={() => setHasEntered(true)}>Continue as guest <span aria-hidden='true'>→</span></button>
            <button type='button' className='entry-card__account' onClick={() => setAccountOpen(true)}>Sign in or create account</button>
          </div>
          <p className='entry-card__privacy'>Guest searches and notes stay in this browser. Sign in to sync your workspace.</p>
          {!workspaceReady && <span className='entry-card__status'>Checking saved account…</span>}
        </section>
        {accountOpen && (
          <AccountDialog
            onClose={() => setAccountOpen(false)}
            onGuest={() => { setAccountOpen(false); setHasEntered(true) }}
            onSubmit={handleSignIn}
            initialError={research.error}
          />
        )}
      </main>
    )
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__heading">
          <h1 className="app__title">
            <img className="app__logo" src={lotusLogo} alt="LoTUS-BF" />
          </h1>
          <p className="app__subtitle">Location-or-Term Unified Search for Brain Functions</p>
        </div>
        <div className="app__header-actions">
          <button className="workspace-toggle" type="button" onClick={() => setGroupsOpen(true)}>
            <span aria-hidden="true">▤</span><span>My groups</span>
          </button>
          <button
            className="history-toggle"
            type="button"
            aria-expanded={historyOpen}
            aria-controls="search-history"
            onClick={() => setHistoryOpen(true)}
          >
            <span aria-hidden="true">◷</span>
            <span>Search history</span>
            <span className="history-count">{searchHistory.length}</span>
          </button>
          {research.user ? (
            <div className='account-chip' title={`Signed in as ${research.user.username}`}>
              <span className='status-dot' />{research.user.username}
              <button type='button' onClick={() => research.signOut().catch((error) => setWorkspaceError(error.message))}>Sign out</button>
            </div>
          ) : (
            <button className='app__header-meta account-entry' type='button' onClick={() => setAccountOpen(true)}>
              <span className='status-dot' />{research.ready ? 'Guest' : 'Loading account…'}<span className='account-entry__sign-in'>Sign in</span>
            </button>
          )}
        </div>
      </header>

      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} onGuest={() => setAccountOpen(false)} onSubmit={handleSignIn} initialError={research.error} />}
      {groupsOpen && (
        <WorkspaceDrawer
          groups={research.groups}
          accountName={research.user?.username}
          error={workspaceError}
          onClose={() => setGroupsOpen(false)}
          onSignIn={() => { setGroupsOpen(false); setAccountOpen(true) }}
          onCreateGroup={handleCreateGroup}
          onDeleteGroup={handleDeleteGroup}
          onSaveNote={handleUpdateGroupNote}
          onRemovePaper={handleRemoveGroupPaper}
        />
      )}

      {historyOpen && (
        <div className="history-overlay">
          <button
            className="history-backdrop"
            type="button"
            aria-label="Close search history"
            onClick={() => setHistoryOpen(false)}
          />
          <aside
            className="history-drawer"
            id="search-history"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <div className="history-drawer__header">
              <div>
                <h2 id="history-title">Search history</h2>
                <p>Choose a previous query to run it again.</p>
              </div>
              <button
                className="history-close"
                type="button"
                aria-label="Close search history"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </button>
            </div>

            {searchHistory.length === 0 ? (
              <div className="history-empty">
                Enter a query, then press “Save current search” to keep it here.
              </div>
            ) : (
              <div className="history-list">
                {searchHistory.map((item) => (
                  <button
                    className="history-item"
                    key={item.id}
                    type="button"
                    aria-current={item.query === query ? 'true' : undefined}
                    onClick={() => {
                      setQuery(item.query)
                      setHistoryOpen(false)
                    }}
                  >
                    <span className="history-item__details">
                      <span className="history-item__query">{item.query}</span>
                      <time className="history-item__time" dateTime={item.savedAt}>
                        {formatSavedTime(item.savedAt)}
                      </time>
                    </span>
                    {item.query === query && <span className="history-item__current">Current</span>}
                  </button>
                ))}
              </div>
            )}

            <div className="history-drawer__footer">
              <span>{searchHistory.length} / {MAX_SEARCH_HISTORY} saved</span>
              <button
                type="button"
                disabled={searchHistory.length === 0}
                onClick={() => setSearchHistory([])}
              >
                Clear history
              </button>
            </div>
          </aside>
        </div>
      )}

      <main className="app__grid" ref={gridRef}>
        <section className="card card--terms" style={{ flexBasis: `${sizes[0]}%` }} aria-labelledby="terms-heading">
          <div className="panel-heading">
            <div>
              <h2 className="card__title" id="terms-heading">Terms</h2>
              <p className="card__description">Browse concepts and add them to your query.</p>
            </div>
          </div>
          <form className="coordinate-search" onSubmit={handleCoordinateSearch}>
            <h3>Search by MNI coordinates</h3>
            <p>Enter a point in millimeters to find nearby studies.</p>
            <div className="coordinate-search__fields">
              {['x', 'y', 'z'].map((axis) => (
                <label key={axis}>
                  <span>{axis.toUpperCase()} (mm)</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={coordinateFields[axis]}
                    onChange={(event) => setCoordinateFields((current) => ({ ...current, [axis]: event.target.value }))}
                    aria-label={`${axis.toUpperCase()} MNI coordinate in millimeters`}
                  />
                </label>
              ))}
            </div>
            <button type="submit">Search coordinates</button>
          </form>
          <Terms onPickTerm={handlePickTerm} />
        </section>

        <div
          className="resizer"
          role="separator"
          aria-label="Resize terms and studies panels"
          aria-orientation="vertical"
          aria-valuenow={Math.round(sizes[0])}
          aria-valuemin="16"
          aria-valuemax="55"
          tabIndex={0}
          onPointerDown={(event) => startDrag(0, event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              adjustPane(0, event.key === 'ArrowLeft' ? -1 : 1)
            }
          }}
        />

        <section className="card card--stack card--results" style={{ flexBasis: `${sizes[1]}%` }} aria-labelledby="query-heading">
          <QueryBuilder
            query={query}
            draftQuery={draftQuery}
            setDraftQuery={setDraftQuery}
            onSearch={handleSearch}
            onClear={handleClearQuery}
            onSaveHistory={saveCurrentSearch}
          />
          <div className="divider" />
          <Studies
            query={query}
            selectedStudyId={selectedStudyId}
            onSelectStudy={(study) => {
              setSelectedStudy(study)
              setSelectedStudyId(study?.study_id == null ? '' : String(study.study_id))
            }}
            user={research.user}
            groups={research.groups}
            notesByStudy={research.notesByStudy}
            membershipsByStudy={research.membershipsByStudy}
            onSaveNote={research.savePaperNote}
            onAddPaperToGroup={handleAddPaper}
            onUpdateGroupNote={handleUpdateGroupNote}
            onRemovePaperFromGroup={handleRemoveGroupPaper}
          />
        </section>

        <div
          className="resizer"
          role="separator"
          aria-label="Resize studies and brain map panels"
          aria-orientation="vertical"
          aria-valuenow={Math.round(sizes[1])}
          aria-valuemin="16"
          aria-valuemax="60"
          tabIndex={0}
          onPointerDown={(event) => startDrag(1, event)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              adjustPane(1, event.key === 'ArrowLeft' ? -1 : 1)
            }
          }}
        />

    <section className="card card--viewer" style={{ flexBasis: `${sizes[2]}%` }} aria-label="Brain map viewer">
      <div className="brain-map__tabs" role="tablist" aria-label="Brain map view">
        <button type="button" role="tab" aria-selected={viewerMode === '2d'} className={viewerMode === '2d' ? 'is-active' : ''} onClick={() => setViewerMode('2d')}>2D slices</button>
        <button type="button" role="tab" aria-selected={viewerMode === '3d'} className={viewerMode === '3d' ? 'is-active' : ''} onClick={() => setViewerMode('3d')}>3D brain</button>
      </div>
      {viewerMode === '2d'
        ? <NiiViewer query={query} studyId={selectedStudyId || null} />
        : <Brain3DViewer query={query} studyId={selectedStudyId || null} />}
      {selectedStudy && (
        <div className="brain-map__study-meta" aria-live="polite">
          <h3>{selectedStudy.title || `Study ${selectedStudy.study_id}`}</h3>
          <p>{Array.isArray(selectedStudy.authors ?? selectedStudy.author)
            ? (selectedStudy.authors ?? selectedStudy.author).join('; ')
            : (selectedStudy.authors ?? selectedStudy.author ?? 'Author information unavailable')}</p>
        </div>
      )}
    </section>
      </main>
      <footer className="app__footer">
        <span>LoTUS-BF</span><span className="footer-separator">·</span>
        <span>Search concepts, studies, and brain locations in one workspace.</span>
      </footer>
    </div>
  )
}
