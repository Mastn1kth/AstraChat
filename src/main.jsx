import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './onda-overrides.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { registerServiceWorker } from './utils/registerSW.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
