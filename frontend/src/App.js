import React, {useState} from 'react';
import {BrowserRouter as Router, Route, Routes, Navigate} from 'react-router-dom';
import Login from './components/Login';
import Translate from './components/Translate';
import SeamlessCommunication from './components/SeamlessCommunication';
import Send from "./components/Send";

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated}/>}/>
                <Route path="/translate" element={isAuthenticated ? <Translate/> : <Translate/>}/>
                <Route path="/seamless" element={isAuthenticated ? <SeamlessCommunication/> : <SeamlessCommunication/>}/>
                <Route path="/send" element={isAuthenticated ? <Send/> : <Send/>}/>
                <Route path="/" element={<Navigate to="/login"/>}/>
            </Routes>
        </Router>
    );
};

export default App;