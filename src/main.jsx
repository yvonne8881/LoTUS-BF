// src/main.jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css' // 沒有這檔可刪掉這行

class ErrorBoundary extends React.Component {
  constructor (props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError (error) {
    return { error }
  }

  componentDidCatch (error, info) {
    console.error('[LoTUS-BF] Render error:', error, info)
  }

  render () {
    if (this.state.error) {
      const err = this.state.error
      return (
        <div style={{ padding: 16, fontFamily: 'ui-sans-serif, system-ui' }}>
          <h2>執行時發生錯誤</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 8 }}>
            {String(err?.stack || err?.message || err)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

console.log('[main] booting...') // smoke test：打開 DevTools 會看到

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

