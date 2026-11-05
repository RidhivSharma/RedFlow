import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles/tokens.css'
import App from './App'
import './styles/base.css'
import './styles/layout.css'
import './styles/sidebar.css'
import './styles/components.css'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Murmur settings: #root is missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
