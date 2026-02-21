import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Viewer from './Viewer'
import DrawingsBrowser from './DrawingsBrowser'
import AdminPage from './AdminPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DrawingsBrowser />} />
        <Route path="/d/:id" element={<Viewer />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
