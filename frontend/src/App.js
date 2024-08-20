import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Translate from './components/Translate';
import AudioChunks from "./components/AudioChunks";
import Send from "./components/Send";
import TranslateChunks from "./components/TranslateChunks.js";

const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated} />} />
        <Route path="/translate" element={isAuthenticated ? <Translate /> : <Translate />} />
          <Route path="/chunks" element={isAuthenticated ? <AudioChunks /> : <AudioChunks />} />
          <Route path="/send" element={isAuthenticated ? <Send /> : <Send />} />
          <Route path="/translatechunks" element={isAuthenticated ? <TranslateChunks /> : <TranslateChunks />} />
        <Route path="/" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
};

export default App;