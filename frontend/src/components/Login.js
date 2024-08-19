import React, { useState } from 'react';
import { Container, TextField, Button, Typography, CssBaseline } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#ffffff'
    }
  }
});

const Login = ({ setIsAuthenticated }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = () => {
    if (username === process.env.REACT_APP_LOGIN_USER && password === process.env.REACT_APP_LOGIN_PASSWORD) {
      setIsAuthenticated(true);
      navigate('/translate');
    } else {
      setError('Invalid username or password');
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="xs" style={{ textAlign: 'center', marginTop: '20px' }}>
        <Typography variant="h4" gutterBottom>Login</Typography>
        <TextField
          label="Username"
          variant="outlined"
          fullWidth
          margin="normal"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          variant="outlined"
          fullWidth
          margin="normal"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <Typography variant="body2" color="error" style={{ marginTop: '10px' }}>
            {error}
          </Typography>
        )}
        <Button
          variant="contained"
          color="primary"
          fullWidth
          style={{ marginTop: '20px' }}
          onClick={handleLogin}
        >
          Login
        </Button>
      </Container>
    </ThemeProvider>
  );
};

export default Login;