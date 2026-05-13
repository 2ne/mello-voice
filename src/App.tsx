import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import MainWindow from './components/MainWindow'
import OverlayRoot from './components/OverlayRoot'

function App() {
  const windowLabel = getCurrentWindow().label
  const isOverlay = windowLabel === 'overlay'

  useEffect(() => {
    document.documentElement.style.overflow = isOverlay ? 'hidden' : ''
    document.body.style.overflow = isOverlay ? 'hidden' : ''
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [isOverlay])

  // WebView2 still shows its system context menu (incl. Quit) unless the default is prevented.
  // Capture phase ensures this runs before host behaviour; our own handlers still receive the event.
  useEffect(() => {
    if (!isOverlay) return
    const blockHostMenu = (e: Event) => e.preventDefault()
    document.addEventListener('contextmenu', blockHostMenu, { capture: true })
    return () => document.removeEventListener('contextmenu', blockHostMenu, { capture: true })
  }, [isOverlay])

  return isOverlay ? <OverlayRoot /> : <MainWindow />
}

export default App
