import { useState } from 'react'

export function AccountDialog ({ onClose, onGuest = onClose, onSubmit, initialError = '' }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const secureContext = window.isSecureContext

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await onSubmit(mode, username, password)
      onClose()
    } catch (error) {
      setMessage(error?.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='workspace-modal-backdrop' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className='workspace-modal' role='dialog' aria-modal='true' aria-labelledby='account-dialog-title'>
        <button type='button' className='workspace-modal__close' onClick={onClose} aria-label='Close'>×</button>
        <h2 id='account-dialog-title'>{mode === 'login' ? 'Sign in to LoTUS-BF' : 'Create an account'}</h2>
        <p>Save your workspace, literature groups, and paper notes to your account.</p>
        {!secureContext && <div className='workspace-modal__security' role='note'>This page is using HTTP. Use guest mode here; set up HTTPS before entering an account password.</div>}
        <div className='workspace-modal__tabs'>
          <button type='button' aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setMessage('') }}>Sign in</button>
          <button type='button' aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setMessage('') }}>Create account</button>
        </div>
        <form onSubmit={submit}>
          <label>Username<input autoComplete='username' minLength={3} maxLength={32} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type='password' minLength={mode === 'register' ? 10 : 1} maxLength={256} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === 'register' && <small>Use 10 or more characters. Usernames accept letters, numbers, dot, underscore, and hyphen.</small>}
          {(message || initialError) && <div className='workspace-modal__error' role='alert'>{message || initialError}</div>}
          <button type='submit' className='workspace-modal__submit' disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <button type='button' className='workspace-modal__guest' onClick={onGuest}>Continue as guest</button>
      </section>
    </div>
  )
}
