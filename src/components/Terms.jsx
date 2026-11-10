import { useEffect, useMemo, useState } from 'react'

export function Terms ({ onPickTerm }) {
  const [terms, setTerms] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const ac = new AbortController()
    const load = async () => {
      setLoading(true)
      setErr('')
      try {
        const res = await fetch('/terms', { signal: ac.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!alive) return
        setTerms(Array.isArray(data?.terms) ? data.terms : [])
      } catch (e) {
        if (!alive) return
        setErr(`Failed to fetch terms: ${e?.message || e}`)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false; ac.abort() }
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return terms
    return terms.filter(t => t.toLowerCase().includes(s))
  }, [terms, search])

  return (
    <div className='terms'>
      <div className='terms__controls'>
        <input
          type='search'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Find a term to add'
          aria-label='Search terms'
          className='input'
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
        <div className='terms__skeleton'>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className='terms__skeleton-row' />
          ))}
        </div>
      )}

      {err && (
        <div className='alert alert--error'>
          {err}
        </div>
      )}

      {!loading && !err && (
        <div className='terms__list'>
          {filtered.length === 0 ? (
            <div className='terms__empty'>{search ? 'No matching terms. Try another keyword.' : 'No terms available.'}</div>
          ) : (
            <ul className='terms__ul'>
              {filtered.slice(0, 500).map((t, idx) => (
                <li key={`${t}-${idx}`} className='terms__li'>
                  <button
                    type='button'
                    className='terms__name'
                    title={`Add ${t} to the query`}
                    aria-label={`Add term ${t} to query`}
                    onClick={() => onPickTerm?.(t)}
                  >
                    {t}
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

