export function QueryBuilder ({ draftQuery, setDraftQuery, query, onSearch, onClear, onSaveHistory }) {
  const append = (token) => setDraftQuery((current) => (current ? `${current} ${token}` : token))

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSearch()
    }
  }

  return (
    <div className="qb">
      <div className="qb__heading">
        <div>
          <h2 className="card__title" id="query-heading">Build a query</h2>
          <p className="card__description">Combine terms and coordinates to explore related studies.</p>
        </div>
        {(query || draftQuery.trim()) && (
          <span className="studies__count" aria-live="polite">
            {!draftQuery.trim() && query ? 'Clear query to reset results' : draftQuery.trim() === query.trim() ? 'Query active' : 'Press Search to run'}
          </span>
        )}
      </div>
      <input
        value={draftQuery}
        onChange={(event) => setDraftQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. [−22, −4, 18] AND emotion"
        className="qb__input"
        aria-label="Search query"
        aria-describedby="query-help"
        autoComplete="off"
        spellCheck="false"
      />
      <p className="qb__hint" id="query-help">Use AND, OR, NOT, parentheses, terms, or MNI coordinates.</p>
      <div className="qb__toolbar" role="toolbar" aria-label="Query operators">
        {['AND', 'OR', 'NOT', '(', ')'].map((token) => (
          <button key={token} type="button" onClick={() => append(token)} aria-label={`Add ${token} to query`}>
            {token}
          </button>
        ))}
        <button className="qb__search" type="button" onClick={onSearch} disabled={!draftQuery.trim()}>
          Search
        </button>
        <button className="qb__save" type="button" onClick={() => onSaveHistory(draftQuery)} disabled={!draftQuery.trim()}>
          Save history
        </button>
        <button className="qb__clear" type="button" onClick={onClear} disabled={!draftQuery && !query}>Clear query</button>
      </div>
    </div>
  )
}
