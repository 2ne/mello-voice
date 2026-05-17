import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SurfaceProvider } from '@/lib/surface-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SurfaceProvider value={1}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </SurfaceProvider>
  </StrictMode>,
)
