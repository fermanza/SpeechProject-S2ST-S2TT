import React, {useState} from 'react';
import {BrowserRouter as Router, Route, Routes, Navigate} from 'react-router-dom';
import Login from './components/Login';
import SeamlessCommunication from './components/SeamlessCommunication';

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login setIsAuthenticated={setIsAuthenticated}/>}/>
                <Route path="/seamless" element={isAuthenticated ? <SeamlessCommunication/> : <SeamlessCommunication/>}/>
                <Route path="/" element={<Navigate to="/login"/>}/>
            </Routes>
        </Router>
    );
};

export default App;