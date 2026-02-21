import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Set asset path for self-hosted fonts
// @ts-ignore
window.EXCALIDRAW_ASSET_PATH = '/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
