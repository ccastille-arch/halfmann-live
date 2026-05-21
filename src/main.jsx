import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import HalfmannLiveView from './components/HalfmannLiveView'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HalfmannLiveView />
  </StrictMode>,
)
