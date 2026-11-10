import { useEffect, useState } from 'react'

export function Terms ({ onPickTerm }) {
  const [terms, setTerms] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const prefix = search.trim().toLowerCase()
    if (!prefix) {
      setTerms([])
      setErr('')
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const debounce = window.setTimeout(async () => {
      setLoading(true)
      setErr('')
      try {
        const params = new URLSearchParams({ q: prefix, limit: '100' })
        const response = await fetch(`/terms?${params}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (controller.signal.aborted) return
        const items = Array.isArray(data?.terms) ? data.terms : []
        setTerms(items.map((item) => typeof item === 'string'
          ? { term: item, studyCount: null }
          : {
              term: String(item?.term ?? ''),
              studyCount: item?.study_count == null ? null : Number(item.study_count)
            }).filter((item) => item.term && (item.studyCount == null || Number.isFinite(item.studyCount))))
      } catch (error) {
        if (error.name !== 'AbortError') setErr(`Failed to fetch terms: ${error?.message || error}`)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)

    return () => {
      window.clearTimeout(debounce)
      controller.abort()
    }
  }, [search])

  const handlePick = (term) => {
    onPickTerm?.(term)
    setSearch('')
    setTerms([])
  }

  return (
    <div className='terms'>
      <div className='terms__controls'>
        <input
          type='search'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder='Type to find a term (e.g. ability)'
          aria-label='Search terms'
          className='input'
          autoComplete='off'
        />
        <button
          type='button'
          onClick={() => setSearch('')}
          className='btn btn--primary'
          disabled={!search}
        >
          Clear
        </button>
      </div>

      {loading && (
        <div className='terms__skeleton' aria-live='polite'>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className='terms__skeleton-row' />
          ))}
        </div>
      )}

      {err && <div className='alert alert--error'>{err}</div>}

      {!loading && !err && (
        <div className='terms__list' aria-live='polite'>
          {!search.trim() ? (
            <div className='terms__empty'>Start typing to see matching terms.</div>
          ) : terms.length === 0 ? (
            <div className='terms__empty'>No matching terms.</div>
          ) : (
            <ul className='terms__ul'>
              {terms.map(({ term, studyCount }) => (
                <li key={term} className='terms__li'>
                  <button
                    type='button'
                    className='terms__name'
                    title={`Add ${term} to the query`}
                    aria-label={`Add term ${term} to query${studyCount == null ? '' : `, appears in ${studyCount.toLocaleString()} studies`}`}
                    onClick={() => handlePick(term)}
                  >
                    <span>{term}</span>
                    {studyCount != null && <span className='terms__count'>({studyCount.toLocaleString()})</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
