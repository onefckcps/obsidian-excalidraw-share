import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Viewer from './Viewer'
import Landing from './Landing'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/d/:id" element={<Viewer />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
