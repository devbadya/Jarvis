import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root is missing from index.html')

// Precaches the app shell and the ONNX runtime so the app starts without a
// network connection. Model weights are cached separately by Transformers.js.
registerSW({ immediate: true })

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
