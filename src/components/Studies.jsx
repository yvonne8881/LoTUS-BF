import { useEffect, useMemo, useState } from 'react'

function classNames (...xs) {
  return xs.filter(Boolean).join(' ')
}

function getPubMedUrl (study) {
  const rawPmid =
    study.pmid ??
    study.PMID ??
    study.pubmed_id ??
    study.pubmedId ??
    study.pubmedid

  const pmid = String(rawPmid ?? '')
    .trim()
    .replace(/^PMID\s*:\s*/i, '')

  if (/^\d+$/.test(pmid)) {
    return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
  }

  const title = String(study.title ?? '').trim()
  if (!title) return null

  const url = new URL('https://pubmed.ncbi.nlm.nih.gov/')
  url.searchParams.set('term', title)
  return url.toString()
}

function getPmid (study) {
  const raw = study.pmid ?? study.PMID ?? study.pubmed_id ?? study.pubmedId ?? study.pubmedid
  const value = String(raw ?? '').trim().replace(/^PMID\s*:\s*/i, '')
  return /^\d+$/.test(value) ? value : ''
}

function getDoi (study) {
  const raw = String(study.doi ?? study.DOI ?? study.doi_id ?? '').trim()
  return raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '')
}

function getAuthors (study) {
  const raw = study.authors ?? study.author ?? ''
  const authors = Array.isArray(raw) ? raw : String(raw).split(/\s*;\s*|\s+and\s+|\r?\n/i)
  return authors.map((author) => String(author).trim()).filter(Boolean)
}

function getStudyKey (study) {
  const key = study.study_id ?? getPmid(study) ?? getDoi(study) ?? study.title
  return String(key ?? '')
}

function readFavorites () {
  try {
    const saved = JSON.parse(window.localStorage.getItem('lotus-bf-favorite-studies-v1') || '[]')
    return new Set(Array.isArray(saved) ? saved.map(String) : [])
  } catch {
    return new Set()
  }
}

function plainText (value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function csvCell (value) {
  let text = String(value ?? '')
  if (/^[=+@-]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function risText (value) {
  return plainText(value).replace(/[\t]/g, ' ')
}

function bibtexText (value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/[{}]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function buildExport (records, format) {
  if (format === 'csv') {
    const headings = ['Title', 'Year', 'Authors', 'Journal', 'PMID', 'DOI', 'PubMed URL']
    const lines = [headings.map(csvCell).join(',')]
    records.forEach((study) => {
      const values = [study.title, study.year, getAuthors(study).join('; '), study.journal, getPmid(study), getDoi(study), getPubMedUrl(study)]
      lines.push(values.map(csvCell).join(','))
    })
    return { mime: 'text/csv;charset=utf-8', extension: 'csv', content: `\uFEFF${lines.join('\r\n')}` }
  }

  if (format === 'ris') {
    const content = records.map((study) => {
      const lines = ['TY  - JOUR', `TI  - ${risText(study.title)}`]
      getAuthors(study).forEach((author) => lines.push(`AU  - ${risText(author)}`))
      if (study.journal) lines.push(`JO  - ${risText(study.journal)}`)
      if (study.year) lines.push(`PY  - ${risText(study.year)}`)
      if (getPmid(study)) lines.push(`AN  - PMID: ${getPmid(study)}`)
      if (getDoi(study)) lines.push(`DO  - ${getDoi(study)}`)
      if (getPubMedUrl(study)) lines.push(`UR  - ${getPubMedUrl(study)}`)
      lines.push('ER  -')
      return lines.join('\r\n')
    }).join('\r\n\r\n')
    return { mime: 'application/x-research-info-systems;charset=utf-8', extension: 'ris', content }
  }

  const entries = records.map((study, index) => {
    const author = plainText(study.authors).split(/[,;\s]+/).filter(Boolean)[0] || 'study'
    const year = plainText(study.year) || 'nd'
    const key = `${author.replace(/[^a-z0-9]/gi, '')}${year}${getPmid(study) || index + 1}`
    const fields = [
      ['title', study.title], ['author', getAuthors(study).join(' and ')], ['journal', study.journal], ['year', study.year],
      ['doi', getDoi(study)], ['pmid', getPmid(study)],
      ['url', getPubMedUrl(study)]
    ].filter(([, value]) => value != null && String(value).trim() !== '')
    return `@article{${key},\n${fields.map(([name, value]) => `  ${name} = {${bibtexText(value)}}`).join(',\n')}\n}`
  })
  return { mime: 'application/x-bibtex;charset=utf-8', extension: 'bib', content: entries.join('\n\n') }
}

function getQueryTerms (query) {
  const tokens = query.match(/"[^"]+"|'[^']+'|\[[^\]]*\]|[^\s()]+/g) || []

  return [...new Set(tokens
    .map((token) => token.replace(/^['"]|['"]$/g, '').trim())
    .filter((term) => term.length > 0)
    .filter((term) => !/^(AND|OR|NOT)$/i.test(term))
    .filter((term) => !/^\[[^\]]*\]$/.test(term))
    .filter((term) => !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(term)))]
}

function escapeRegExp (text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightText ({ text, terms }) {
  const value = String(text ?? '')
  if (!value || terms.length === 0) return value

  const ranges = []
  terms.forEach((term) => {
    const pattern = new RegExp(escapeRegExp(term), 'giu')
    let match
    while ((match = pattern.exec(value)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  })

  if (ranges.length === 0) return value

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []
  ranges.forEach((range) => {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  })

  const parts = []
  let cursor = 0
  merged.forEach(({ start, end }, index) => {
    if (cursor < start) parts.push(value.slice(cursor, start))
    parts.push(
      <mark className='study-highlight' key={`match-${index}`}>
        {value.slice(start, end)}
      </mark>
    )
    cursor = end
  })
  if (cursor < value.length) parts.push(value.slice(cursor))

  return <>{parts}</>
}

function GroupMembershipNote ({ membership, onSave, onRemove }) {
  const [note, setNote] = useState(membership.note || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => setNote(membership.note || ''), [membership.note])

  const save = async () => {
    setBusy(true)
    setMessage('')
    try { await onSave(membership.groupId, membership.paper.paper_key, note) } catch (error) {
      setMessage(error?.message || String(error))
    } finally { setBusy(false) }
  }

  return (
    <div className='study-group-note'>
      <div className='study-group-note__heading'><strong>{membership.groupName}</strong><button type='button' onClick={() => onRemove(membership.groupId, membership.paper.paper_key)}>Remove from group</button></div>
      <textarea value={note} maxLength={12000} placeholder='Add a note for this group…' onChange={(event) => setNote(event.target.value)} />
      <div className='study-group-note__footer'><button type='button' disabled={busy || note === (membership.note || '')} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>{message && <span role='alert'>{message}</span>}</div>
    </div>
  )
}

export function Studies ({
  query, user, groups = [], notesByStudy = {}, membershipsByStudy = {},
  selectedStudyId, onSelectStudy,
  onSaveNote, onAddPaperToGroup, onUpdateGroupNote, onRemovePaperFromGroup, onManageGroups
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sortKey, setSortKey] = useState('year')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const [yearMode, setYearMode] = useState('all')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [selectedStudy, setSelectedStudy] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [favorites, setFavorites] = useState(readFavorites)
  const [exportFormat, setExportFormat] = useState('ris')
  const [exporting, setExporting] = useState(false)
  const [paperNote, setPaperNote] = useState('')
  const [noteMessage, setNoteMessage] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupMessage, setGroupMessage] = useState('')
  const pageSize = 20
  const highlightTerms = useMemo(() => getQueryTerms(query || ''), [query])
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    setPage(1)
    setSelectedStudy(null)
    setSelectedIds(new Set())
  }, [query])

  useEffect(() => {
    const key = selectedStudy ? getStudyKey(selectedStudy) : ''
    setPaperNote(notesByStudy[key] || '')
    setNoteMessage('')
    setGroupMessage('')
    setSelectedGroupId('')
  }, [selectedStudy, notesByStudy])

  useEffect(() => {
    try {
      window.localStorage.setItem('lotus-bf-favorite-studies-v1', JSON.stringify([...favorites]))
    } catch {
      // Favorites remain available for the current session if storage is unavailable.
    }
  }, [favorites])

  useEffect(() => {
    if (!query) {
      setRows([])
      setErr('')
      setLoading(false)
      return
    }

    let alive = true
    const ac = new AbortController()

    ;(async () => {
      setLoading(true)
      setErr('')

      try {
        const url = `/query/${encodeURIComponent(query)}/studies`
        const res = await fetch(url, { signal: ac.signal })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }

        if (!alive) return

        const list = Array.isArray(data?.results) ? data.results : []
        setRows(list)
      } catch (e) {
        if (!alive) return
        setErr(`Unable to fetch studies: ${e?.message || e}`)
        setRows([])
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
      ac.abort()
    }
  }, [query])

  const changeSort = (key) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filteredRows = useMemo(() => {
    if (yearMode === 'all') return rows
    return rows.filter((row) => {
      const year = Number(row?.year)
      if (!Number.isFinite(year) || year <= 0) return false
      if (yearMode === '5') return year >= currentYear - 4 && year <= currentYear
      if (yearMode === '10') return year >= currentYear - 9 && year <= currentYear
      if (yearMode === 'custom') {
        if (yearFrom && year < Number(yearFrom)) return false
        if (yearTo && year > Number(yearTo)) return false
      }
      return true
    })
  }, [rows, yearMode, yearFrom, yearTo, currentYear])

  useEffect(() => {
    setPage(1)
  }, [yearMode, yearFrom, yearTo])

  const sorted = useMemo(() => {
    const arr = [...filteredRows]
    const dir = sortDir === 'asc' ? 1 : -1

    arr.sort((a, b) => {
      const A = a?.[sortKey]
      const B = b?.[sortKey]

      if (sortKey === 'year') {
        return (Number(A || 0) - Number(B || 0)) * dir
      }

      return String(A || '').localeCompare(String(B || ''), 'en') * dir
    })

    return arr
  }, [filteredRows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page])

  const toggleFavorite = (study) => {
    const key = getStudyKey(study)
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelected = (study) => {
    const key = getStudyKey(study)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const pageKeys = pageRows.map(getStudyKey).filter(Boolean)
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selectedIds.has(key))
  const selectPage = () => setSelectedIds((current) => {
    const next = new Set(current)
    if (allPageSelected) pageKeys.forEach((key) => next.delete(key))
    else pageKeys.forEach((key) => next.add(key))
    return next
  })
  const selectAllFiltered = () => setSelectedIds((current) => new Set([...current, ...filteredRows.map(getStudyKey).filter(Boolean)]))
  const selectedCount = selectedIds.size

  const downloadSelected = async () => {
    const records = rows.filter((study) => selectedIds.has(getStudyKey(study)))
    if (!records.length) return
    setExporting(true)
    try {
      const file = buildExport(records, exportFormat)
      const blob = new Blob([file.content], { type: file.mime })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lotus-bf-studies.${file.extension}`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const selectedStudyKey = selectedStudy ? getStudyKey(selectedStudy) : ''
  const selectedMemberships = membershipsByStudy[selectedStudyKey] || []
  const selectedAvailableGroups = groups.filter((group) => !selectedMemberships.some((membership) => String(membership.groupId) === String(group.id)))

  const savePaperNote = async () => {
    setNoteSaving(true)
    setNoteMessage('')
    try {
      await onSaveNote?.(selectedStudy, paperNote)
      setNoteMessage('Note saved.')
    } catch (error) {
      setNoteMessage(error?.message || String(error))
    } finally {
      setNoteSaving(false)
    }
  }

  const addSelectedPaperToGroup = async () => {
    if (!selectedGroupId) return
    setGroupMessage('')
    try {
      await onAddPaperToGroup?.(selectedGroupId, { ...selectedStudy, paper_note: paperNote })
      setGroupMessage('Added to group.')
      setSelectedGroupId('')
    } catch (error) {
      setGroupMessage(error?.message || String(error))
    }
  }

  const selectedPmid = getPmid(selectedStudy || {})
  const selectedDoi = getDoi(selectedStudy || {})

  return (
    <section className='studies' aria-labelledby='studies-heading'>
      <div className='studies__header'>
        <h2 className='card__title' id='studies-heading'>Studies</h2>
        {query && !loading && !err && (
          <span className='studies__count'>{sorted.length} of {rows.length} records</span>
        )}
      </div>

      {query && !loading && !err && (
        <div className='studies__filters'>
          <label className='studies__filter-label' htmlFor='studies-year-filter'>Publication year</label>
          <select id='studies-year-filter' value={yearMode} onChange={(event) => setYearMode(event.target.value)}>
            <option value='all'>All years</option>
            <option value='5'>Past 5 years</option>
            <option value='10'>Past 10 years</option>
            <option value='custom'>Custom range</option>
          </select>
          {yearMode === 'custom' && (
            <div className='studies__year-range'>
              <label><span>From</span><input type='number' min='1900' max={currentYear} placeholder='Any year' value={yearFrom} onChange={(event) => setYearFrom(event.target.value)} /></label>
              <span aria-hidden='true'>–</span>
              <label><span>To</span><input type='number' min='1900' max={currentYear} placeholder='Any year' value={yearTo} onChange={(event) => setYearTo(event.target.value)} /></label>
            </div>
          )}
        </div>
      )}

      {query && !loading && !err && (
        <div className='studies__selection-bar'>
          <div className='studies__selection-actions'>
            <button type='button' onClick={selectAllFiltered} disabled={!filteredRows.length}>Select all {filteredRows.length} filtered</button>
            <button type='button' onClick={() => setSelectedIds(new Set())} disabled={!selectedCount}>Clear selection</button>
            <span>{selectedCount} selected</span>
          </div>
          <div className='studies__export-actions'>
            <label htmlFor='studies-export-format'>Export as</label>
            <select id='studies-export-format' value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
              <option value='ris'>RIS</option>
              <option value='bibtex'>BibTeX</option>
              <option value='csv'>CSV</option>
            </select>
            <button type='button' onClick={downloadSelected} disabled={!selectedCount || exporting}>{exporting ? 'Preparing export…' : 'Download selected'}</button>
          </div>
        </div>
      )}

      {!query && (
        <div className='studies__empty'>
          Your matching studies will appear here.
          <br />
          Start with a term or enter a query above.
        </div>
      )}

      {query && loading && (
        <div className='grid gap-3 p-3'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className='h-10 animate-pulse rounded-lg bg-gray-100'
            />
          ))}
        </div>
      )}

      {query && err && (
        <div className='mx-3 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
          {err}
        </div>
      )}

      {query && !loading && !err && (
        <div className='studies__table-wrap'>
          <table>
            <thead>
              <tr>
                <th className='studies__check-cell'>
                  <input type='checkbox' checked={allPageSelected} onChange={selectPage} aria-label='Select or clear studies on this page' />
                </th>
                <th className='studies__favorite-cell' aria-label='Favorites'>★</th>
                {[
                  { key: 'year', label: 'Year' },
                  { key: 'journal', label: 'Journal' },
                  { key: 'title', label: 'Title' },
                  { key: 'authors', label: 'Authors' }
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    aria-sort={
                      sortKey === key
                        ? (sortDir === 'asc' ? 'ascending' : 'descending')
                        : 'none'
                    }
                  >
                    <button
                      type='button'
                      className='table-sort'
                      onClick={() => changeSort(key)}
                    >
                      {label}
                      <span aria-hidden='true'>
                        {sortKey === key
                          ? (sortDir === 'asc' ? ' ↑' : ' ↓')
                          : ' ↕'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className='px-3 py-4 text-gray-500'>
                    No data
                  </td>
                </tr>
              ) : (
                pageRows.map((r, i) => {
                  const pubMedUrl = getPubMedUrl(r)
                  const pmid = getPmid(r)
                  const studyKey = getStudyKey(r)
                  const hasPmid = Boolean(pmid)

                  return (
                    <tr
                      key={r.study_id ?? `${r.title}-${i}`}
                      className={classNames(
                        String(selectedStudyId ?? selectedStudy?.study_id ?? '') === String(r.study_id ?? '') && selectedStudyId != null && selectedStudyId !== '' && 'study-row--selected',
                        i % 2 ? 'bg-white' : 'bg-gray-50'
                      )}
                      aria-selected={String(selectedStudyId ?? '') === String(r.study_id ?? '') && selectedStudyId != null && selectedStudyId !== ''}
                    >
                      <td className='studies__check-cell'>
                        <input type='checkbox' checked={selectedIds.has(studyKey)} onChange={() => toggleSelected(r)} aria-label={`Select ${r.title || 'study'}`} />
                      </td>
                      <td className='studies__favorite-cell'>
                        <button className={`study-star${favorites.has(studyKey) ? ' is-favorite' : ''}`} type='button' onClick={() => toggleFavorite(r)} aria-pressed={favorites.has(studyKey)} aria-label={favorites.has(studyKey) ? 'Remove from favorites' : 'Add to favorites'} title={favorites.has(studyKey) ? 'Remove from favorites' : 'Add to favorites'}>★</button>
                      </td>
                      <td className='whitespace-nowrap px-3 py-2 align-top'>
                        <HighlightText text={r.year ?? ''} terms={highlightTerms} />
                      </td>

                      <td className='px-3 py-2 align-top'>
                        <HighlightText text={r.journal || ''} terms={highlightTerms} />
                      </td>

                      <td className='max-w-[540px] px-3 py-2 align-top'>
                        <div className='study-title-cell'>
                          <button
                            className='study-title-button'
                            type='button'
                            aria-expanded={String(selectedStudyId ?? '') === String(r.study_id ?? '') && selectedStudyId != null && selectedStudyId !== ''}
                            onClick={() => {
                              const next = String(selectedStudyId ?? '') === String(r.study_id ?? '') ? null : r
                              setSelectedStudy(next)
                              onSelectStudy?.(next)
                            }}
                          >
                            <HighlightText text={r.title || ''} terms={highlightTerms} />
                          </button>
                          {r.study_id != null && (
                            <span className='study-title-actions'>
                              <span>{String(selectedStudyId ?? '') === String(r.study_id ?? '') ? 'Showing this study on the brain map' : 'Click title to view details and coordinates'}</span>
                              {pubMedUrl && (
                                <a className='study-title-link' href={pubMedUrl} target='_blank' rel='noopener noreferrer' aria-label={hasPmid ? `Open ${r.title} in PubMed` : `Search PubMed for ${r.title}`} title={hasPmid ? 'Open this article in PubMed' : 'Search PubMed for this title'}>
                                  PubMed ↗
                                </a>
                              )}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className='px-3 py-2 align-top'>
                        <HighlightText text={getAuthors(r).join('; ')} terms={highlightTerms} />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedStudy && query && !loading && !err && (
        <div className='study-details' aria-live='polite'>
          <div className='study-details__header'>
            <div><h3>Study details</h3><p>{selectedStudy.title || `Study ${selectedStudy.study_id}`}</p></div>
            <button type='button' className='study-details__close' onClick={() => { setSelectedStudy(null); onSelectStudy?.(null) }} aria-label='Close details'>×</button>
          </div>
          <div className='study-details__identifiers'>
              {selectedPmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${selectedPmid}/`} target='_blank' rel='noopener noreferrer'>PMID: {selectedPmid} ↗</a>}
              {selectedDoi && <a href={`https://doi.org/${encodeURIComponent(selectedDoi)}`} target='_blank' rel='noopener noreferrer'>DOI: {selectedDoi} ↗</a>}
          </div>
          <section className='study-annotations' aria-labelledby='paper-note-heading'>
            <div className='study-annotations__title-row'><div><h4 id='paper-note-heading'>Note</h4><p>Add a note about this paper.</p></div></div>
            <textarea className='study-paper-note' value={paperNote} maxLength={12000} placeholder='Write a note…' onChange={(event) => { setPaperNote(event.target.value); setNoteMessage('') }} />
            <div className='study-paper-note__footer'>
              <p className='study-annotations__message' role='status'>{noteMessage || (user ? 'Saved to your account.' : 'Saved only in this browser while in guest mode.')}</p>
              <button type='button' className='study-paper-note__save' onClick={savePaperNote} disabled={!onSaveNote || noteSaving || paperNote === (notesByStudy[selectedStudyKey] || '')}>{noteSaving ? 'Saving…' : 'Save note'}</button>
            </div>
          </section>
          <section className='study-group-memberships' aria-labelledby='paper-groups-heading'>
            <div className='study-annotations__title-row'><div><h4 id='paper-groups-heading'>Groups and notes</h4><p>This paper can belong to more than one group.</p></div><button type='button' onClick={onManageGroups}>Manage groups</button></div>
            {selectedAvailableGroups.length > 0 ? (
              <div className='study-group-add'>
                <select aria-label='Choose a group' value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
                  <option value=''>Choose a group…</option>
                  {selectedAvailableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <button type='button' disabled={!selectedGroupId} onClick={addSelectedPaperToGroup}>Add to group</button>
              </div>
            ) : groups.length === 0 ? (
              <p className='study-details__message'>Create a group to organize this paper.</p>
            ) : (
              <p className='study-details__message'>This paper is already in all your groups.</p>
            )}
            {groupMessage && <p className='study-annotations__message' role='status'>{groupMessage}</p>}
            {selectedMemberships.map((membership) => (
              <GroupMembershipNote key={membership.groupId} membership={membership} onSave={onUpdateGroupNote} onRemove={onRemovePaperFromGroup} />
            ))}
          </section>
        </div>
      )}

      {query && !loading && !err && (
        <div className='studies__pagination'>
          <div>
            Total <b>{sorted.length}</b> records, page <b>{page}</b>/<b>{totalPages}</b>
          </div>

          <div className='studies__pagination-controls'>
            <button
              type='button'
              aria-label='First page'
              disabled={page <= 1}
              onClick={() => setPage(1)}
            >
              «
            </button>

            <button
              type='button'
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>

            <button
              type='button'
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>

            <button
              type='button'
              aria-label='Last page'
              disabled={page >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              »
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
