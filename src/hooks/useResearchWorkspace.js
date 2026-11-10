import { useCallback, useEffect, useMemo, useState } from 'react'

const GUEST_KEY = 'lotus-bf-guest-workspace-v1'

function readGuestData () {
  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_KEY) || '{}')
    return {
      groups: Array.isArray(value.groups) ? value.groups : [],
      papers: Array.isArray(value.papers) ? value.papers.map((paper) => ({
        ...paper,
        paper_note: paper.paper_note ?? (Array.isArray(paper.keywords) ? paper.keywords.join('; ') : '')
      })) : [],
      lastState: value.lastState && typeof value.lastState === 'object' ? value.lastState : {}
    }
  } catch {
    return { groups: [], papers: [], lastState: {} }
  }
}

async function request (path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
  return payload
}

function paperKey (paper) {
  return String(paper.study_id ?? paper.pmid ?? paper.PMID ?? paper.doi ?? paper.DOI ?? paper.title ?? '')
}

function paperFromGroupEntry (entry) {
  const { paper_key, note, paper_note, keywords, ...paper } = entry
  return { paper_key, note, paper_note: paper_note ?? (Array.isArray(keywords) ? keywords.join('; ') : ''), ...paper }
}

export function useResearchWorkspace () {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [guestData, setGuestData] = useState(readGuestData)
  const [accountState, setAccountState] = useState({})
  const [accountGroups, setAccountGroups] = useState([])
  const [accountPapers, setAccountPapers] = useState([])
  const [error, setError] = useState('')

  const refreshAccount = useCallback(async () => {
    const [workspace, groupData, paperData] = await Promise.all([
      request('/workspace/state'),
      request('/workspace/groups'),
      request('/workspace/papers')
    ])
    setAccountState(workspace.state || {})
    setAccountGroups(groupData.groups || [])
    setAccountPapers(paperData.papers || [])
    return workspace.state || {}
  }, [])

  useEffect(() => {
    let alive = true
    request('/auth/me')
      .then(async (data) => {
        if (!alive) return
        if (data.user) {
          setUser(data.user)
          const [workspace, groupData, paperData] = await Promise.all([
            request('/workspace/state'), request('/workspace/groups'), request('/workspace/papers')
          ])
          if (!alive) return
          setAccountState(workspace.state || {})
          setAccountGroups(groupData.groups || [])
          setAccountPapers(paperData.papers || [])
        }
      })
      .catch((e) => { if (alive) setError(e.message || String(e)) })
      .finally(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem(GUEST_KEY, JSON.stringify(guestData)) } catch {
      // Guest data remains usable for the current browser session if storage is unavailable.
    }
  }, [guestData])

  const groups = user ? accountGroups : guestData.groups
  const papers = user ? accountPapers : guestData.papers
  const workspaceState = user ? accountState : guestData.lastState
  const notesByStudy = useMemo(() => Object.fromEntries(papers.map((paper) => [paper.paper_key, paper.paper_note || ''])), [papers])

  const signIn = useCallback(async (mode, username, password) => {
    setError('')
    const endpoint = mode === 'register' ? '/auth/register' : '/auth/login'
    const data = await request(endpoint, {
      method: 'POST', body: JSON.stringify({ username, password })
    })
    try {
      await refreshAccount()
      setUser(data.user)
    } catch (e) {
      setError(e.message || String(e))
      throw e
    }
    return data.user
  }, [refreshAccount])

  const signOut = useCallback(async () => {
    try { await request('/auth/logout', { method: 'POST' }) } finally {
      setUser(null)
      setAccountState({})
      setAccountGroups([])
      setAccountPapers([])
    }
  }, [])

  const saveWorkspaceState = useCallback(async (state) => {
    if (user) {
      const data = await request('/workspace/state', { method: 'PUT', body: JSON.stringify(state) })
      setAccountState(data.state || state)
    } else {
      setGuestData((current) => ({ ...current, lastState: state }))
    }
  }, [user])

  const createGroup = useCallback(async (name) => {
    if (user) {
      const data = await request('/workspace/groups', { method: 'POST', body: JSON.stringify({ name }) })
      setAccountGroups(data.groups || [])
      return
    }
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > 80) throw new Error('Group name must be 1–80 characters.')
    if (guestData.groups.some((group) => group.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('A group with that name already exists.')
    setGuestData((current) => ({ ...current, groups: [...current.groups, { id: `guest-${Date.now()}`, name: cleanName, papers: [] }] }))
  }, [guestData.groups, user])

  const deleteGroup = useCallback(async (groupId) => {
    if (user) {
      const data = await request(`/workspace/groups/${groupId}`, { method: 'DELETE' })
      setAccountGroups(data.groups || [])
      return
    }
    setGuestData((current) => ({ ...current, groups: current.groups.filter((group) => String(group.id) !== String(groupId)) }))
  }, [user])

  const savePaperNote = useCallback(async (paper, paperNote) => {
    const key = paperKey(paper)
    if (user) {
      await request('/workspace/papers', {
        method: 'PUT', body: JSON.stringify({ paper_key: key, paper, paper_note: paperNote })
      })
      await refreshAccount()
      return
    }
    setGuestData((current) => {
      const existing = current.papers.find((item) => item.paper_key === key)
      const nextPaper = { ...existing, ...paper, paper_key: key, paper_note: paperNote }
      return { ...current, papers: [...current.papers.filter((item) => item.paper_key !== key), nextPaper] }
    })
  }, [refreshAccount, user])

  const addPaperToGroup = useCallback(async (groupId, paper, note = '') => {
    const key = paperKey(paper)
    const paperNote = paper.paper_note ?? notesByStudy[key] ?? ''
    if (user) {
      const data = await request(`/workspace/groups/${groupId}/papers`, {
        method: 'POST', body: JSON.stringify({ paper_key: key, paper, paper_note: paperNote, note })
      })
      setAccountGroups(data.groups || [])
      await refreshAccount()
      return
    }
    const entry = { ...paper, paper_key: key, paper_note: paperNote, note }
    setGuestData((current) => ({
      ...current,
      papers: current.papers.some((item) => item.paper_key === key)
        ? current.papers.map((item) => item.paper_key === key ? { ...item, ...entry } : item)
        : [...current.papers, entry],
      groups: current.groups.map((group) => String(group.id) !== String(groupId)
        ? group
        : { ...group, papers: [...(group.papers || []).filter((item) => item.paper_key !== key), entry] })
    }))
  }, [notesByStudy, refreshAccount, user])

  const updateGroupNote = useCallback(async (groupId, key, note) => {
    if (user) {
      const data = await request(`/workspace/groups/${groupId}/papers/${encodeURIComponent(key)}`, {
        method: 'PUT', body: JSON.stringify({ note })
      })
      setAccountGroups(data.groups || [])
      return
    }
    setGuestData((current) => ({
      ...current,
      groups: current.groups.map((group) => String(group.id) !== String(groupId) ? group : {
        ...group,
        papers: group.papers.map((paper) => paper.paper_key !== key ? paper : { ...paper, note })
      })
    }))
  }, [user])

  const removePaperFromGroup = useCallback(async (groupId, key) => {
    if (user) {
      const data = await request(`/workspace/groups/${groupId}/papers/${encodeURIComponent(key)}`, { method: 'DELETE' })
      setAccountGroups(data.groups || [])
      return
    }
    setGuestData((current) => ({
      ...current,
      groups: current.groups.map((group) => String(group.id) !== String(groupId)
        ? group : { ...group, papers: group.papers.filter((paper) => paper.paper_key !== key) })
    }))
  }, [user])

  const membershipsByStudy = useMemo(() => {
    const memberships = {}
    groups.forEach((group) => (group.papers || []).forEach((entry) => {
      if (!memberships[entry.paper_key]) memberships[entry.paper_key] = []
      memberships[entry.paper_key].push({ groupId: group.id, groupName: group.name, note: entry.note || '', paper: paperFromGroupEntry(entry) })
    }))
    return memberships
  }, [groups])

  return {
    user, ready, error, groups, papers, workspaceState, notesByStudy, membershipsByStudy,
    signIn, signOut, saveWorkspaceState, createGroup, deleteGroup, savePaperNote,
    addPaperToGroup, updateGroupNote, removePaperFromGroup, refreshAccount,
    mode: user ? 'account' : 'guest'
  }
}
