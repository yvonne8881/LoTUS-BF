import { useEffect, useState } from 'react'

function SavedPaperRow ({ groupId, paper, onSaveNote, onRemove }) {
  const [note, setNote] = useState(paper.note || '')
  const [saved, setSaved] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setNote(paper.note || '')
    setSaved(true)
  }, [paper.note])

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      await onSaveNote(groupId, paper.paper_key, note)
      setSaved(true)
    } catch (error) { setMessage(error?.message || String(error)) } finally { setBusy(false) }
  }

  return (
    <article className='group-paper'>
      <div className='group-paper__title-row'>
        <div>
          <h4>{paper.title || `Study ${paper.study_id}`}</h4>
          <p>{[paper.year, paper.journal].filter(Boolean).join(' · ')}</p>
        </div>
        <button type='button' onClick={() => onRemove(groupId, paper.paper_key)}>Remove</button>
      </div>
      {paper.paper_note && <p className='group-paper__paper-note'><strong>Paper note:</strong> {paper.paper_note}</p>}
      <label className='group-paper__note-label'>Note<textarea value={note} maxLength={12000} placeholder='Add a note for this group…' onChange={(event) => { setNote(event.target.value); setSaved(false) }} /></label>
      <div className='group-paper__footer'>{message && <span role='alert'>{message}</span>}<button type='button' className='group-paper__save' disabled={saved || busy} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button></div>
    </article>
  )
}

export function WorkspaceDrawer ({ groups, onClose, onCreateGroup, onDeleteGroup, onSaveNote, onRemovePaper, accountName, onSignIn, error = '' }) {
  const [activeId, setActiveId] = useState(groups[0]?.id ?? null)
  const [newGroupName, setNewGroupName] = useState('')
  const [message, setMessage] = useState('')
  const activeGroup = groups.find((group) => String(group.id) === String(activeId)) || groups[0]

  useEffect(() => {
    if (!groups.some((group) => String(group.id) === String(activeId))) setActiveId(groups[0]?.id ?? null)
  }, [groups, activeId])

  const create = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      await onCreateGroup(newGroupName)
      setNewGroupName('')
    } catch (e) { setMessage(e?.message || String(e)) }
  }

  const removeGroup = async () => {
    if (!activeGroup) return
    if (!window.confirm(`Delete “${activeGroup.name}” and its group notes?`)) return
    try {
      await onDeleteGroup(activeGroup.id)
      setMessage('')
    } catch (e) { setMessage(e?.message || String(e)) }
  }

  return (
    <div className='workspace-drawer-overlay'>
      <button className='workspace-drawer-backdrop' type='button' aria-label='Close groups' onClick={onClose} />
      <aside className='workspace-drawer' role='dialog' aria-modal='true' aria-labelledby='workspace-drawer-title'>
        <header className='workspace-drawer__header'>
          <div><h2 id='workspace-drawer-title'>Literature groups</h2><p>{accountName ? `Signed in as ${accountName}` : 'Guest groups are saved in this browser'}</p></div>
          <button type='button' onClick={onClose} aria-label='Close groups'>×</button>
        </header>
        {!accountName && <button type='button' className='workspace-drawer__sign-in' onClick={onSignIn}>Sign in to sync groups across devices</button>}
        <form className='workspace-drawer__create' onSubmit={create}>
          <input aria-label='New group name' placeholder='e.g. tDCS stroke studies' maxLength={80} value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} />
          <button type='submit' disabled={!newGroupName.trim()}>Create group</button>
        </form>
        {(message || error) && <p className='workspace-drawer__error' role='alert'>{message || error}</p>}
        <div className='workspace-drawer__body'>
          <nav className='workspace-drawer__group-list' aria-label='Your groups'>
            {groups.length === 0 && <p className='workspace-drawer__empty'>Create a group to start collecting papers.</p>}
            {groups.map((group) => (
              <button type='button' key={group.id} aria-current={String(group.id) === String(activeGroup?.id)} onClick={() => setActiveId(group.id)}>
                <span>{group.name}</span><small>{group.papers?.length || 0}</small>
              </button>
            ))}
          </nav>
          <section className='workspace-drawer__papers'>
            {activeGroup ? (
              <>
                <div className='workspace-drawer__group-heading'><h3>{activeGroup.name}</h3><button type='button' onClick={removeGroup}>Delete group</button></div>
                {activeGroup.papers?.length
                  ? activeGroup.papers.map((paper) => <SavedPaperRow key={paper.paper_key} groupId={activeGroup.id} paper={paper} onSaveNote={onSaveNote} onRemove={onRemovePaper} />)
                  : <p className='workspace-drawer__empty'>No papers in this group yet.</p>}
              </>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  )
}
