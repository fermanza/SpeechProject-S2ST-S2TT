import React, { useState, useRef, useEffect } from 'react';
import {
  Container,
  Typography,
  CssBaseline,
  AppBar,
  Toolbar,
  Paper,
  Box,
  ThemeProvider,
  createTheme,
  Backdrop,
  CircularProgress,
  Snackbar
} from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#ffffff',
    },
  },
});

const languageMapping = {
  en: 'English',
  es: 'Spanish',
  // Add other mappings as needed
};

const getFullLanguageName = (code) => languageMapping[code] || code;

const getSupportedMimeType = () => {
  const possibleTypes = [
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/ogg',
    'audio/wav',
  ];

  for (const mimeType of possibleTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return null;
};

const generateSessionId = () => 'session-' + Date.now();

const generateUniqueUrl = (baseUrl) => `${baseUrl}?t=${new Date().getTime()}`;

const SeamlessCommunication = () => {
  const [recording, setRecording] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentSpeaker, setCurrentSpeaker] = useState(1);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const resetInProgress = useRef(false);
  const audioElementRef = useRef(null);
  const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5500';
  const threshold = process.env.REACT_APP_THRESHOLD || 2000;
  const silenceThreshold = 0.06;
  const initialCaptureDelay = 1500;
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceDetectedRef = useRef(false);
  const voiceDetectedRef = useRef(false);

  const [loading, setLoading] = useState(false); // Loading state for the backdrop
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      startRecordingStream();
    }, initialCaptureDelay);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, []);

  const isValidBlob = (blob) => {
    if (blob.size === 0 || !blob.type.startsWith('audio/')) {
      console.error('Invalid Blob:', blob);
      return false;
    }
    return true;
  };

  const cleanup = () => {
    try {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }

      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
        if (mediaRecorderRef.current.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        }
        mediaRecorderRef.current = null;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      setRecording(false);
      audioChunksRef.current = [];
    } catch (error) {
      console.error('Error during cleanup:', error);
      setSnackbarMessage('Error during cleanup');
      setOpenSnackbar(true);
    }
  };

  const detectVoice = (analyser, bufferLength, dataArray) => {
    const detect = () => {
      analyser.getByteTimeDomainData(dataArray);
      const average = dataArray.reduce((acc, val) => acc + Math.abs(val - 128), 0) / bufferLength;

      if (average / 128 > silenceThreshold) {
        voiceDetectedRef.current = true;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }
        silenceDetectedRef.current = false;
      } else {
        if (!silenceDetectedRef.current && voiceDetectedRef.current) {
          silenceDetectedRef.current = true;
          silenceTimerRef.current = setTimeout(async () => {
            silenceDetectedRef.current = false;
            voiceDetectedRef.current = false;
            await sendAudioToBackend();
          }, threshold);
        }
      }

      requestAnimationFrame(detect);
    };

    detect();
  };

  const resetVariables = () => {
    audioElementRef.current = null;
    silenceDetectedRef.current = false;
    voiceDetectedRef.current = false;
    audioChunksRef.current = [];
  };

  const startRecordingStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (!resetInProgress.current && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        } else if (event.data.size === 0) {
          console.warn('Received empty chunk, skipping.');
        }
      };

      mediaRecorder.onstop = () => {
        if (mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start(100);
      setRecording(true);

      detectVoice(analyser, bufferLength, dataArray);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setSnackbarMessage('Error accessing microphone');
      setOpenSnackbar(true);
    }
  };

  const sendAudioToBackend = async () => {
    if (audioChunksRef.current.length === 0) {
      console.error("No audio chunks to send.");
      setSnackbarMessage('No audio chunks to send');
      setOpenSnackbar(true);
      cleanup();
      await resumeRecordingSession();
      return;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

    audioChunksRef.current = [];

    if (!isValidBlob(audioBlob)) {
      console.error('Invalid audio blob:', audioBlob);
      setSnackbarMessage('Invalid audio blob');
      setOpenSnackbar(true);
      cleanup();
      await resumeRecordingSession();
      return;
    }

    const formData = new FormData();
    formData.append('audio_chunk', audioBlob, 'audio.webm');
    formData.append('target_language', 'en');
    formData.append('translation_type', 's2st');
    formData.append('session_id', generateSessionId());

    setLoading(true); // Show loading indicator

    try {
      const response = await fetch(`${backendUrl}/translate`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Backend server error');
      }

      const result = await response.json();

      cleanup();

      const hasValidResult = result.recognized && result.translated && result.detected_language && result.translated_language;

      if (hasValidResult) {
        setConversations((prevConversations) => [
          ...prevConversations,
          {
            speaker: currentSpeaker,
            recognizedText: result.recognized || '',
            translatedText: result.translated || '',
            detectedLanguage: getFullLanguageName(result.detected_language || ''),
            translatedLanguage: getFullLanguageName(result.translated_language || 'en'),
            audioUrl: generateUniqueUrl(result.audio_url || '')
          }
        ]);

        setCurrentSpeaker((prevSpeaker) => (prevSpeaker === 1 ? 2 : 1));
      }

      if (audioElementRef.current && result.audio_url) {
        audioElementRef.current.src = generateUniqueUrl(result.audio_url);
        audioElementRef.current.play();
        audioElementRef.current.onended = async () => {
          setLoading(false); // Hide loading indicator
          await resumeRecordingSession();
        };
      } else {
        setLoading(false); // Hide loading indicator
        await resumeRecordingSession();
      }

    } catch (error) {
      console.error('Error sending audio to backend:', error);
      setSnackbarMessage('Error sending audio to backend');
      setOpenSnackbar(true);
      cleanup();
      setLoading(false); // Hide loading indicator
      await resumeRecordingSession();
    }
  };

  const resumeRecordingSession = async () => {
    resetVariables();
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay before starting the recording again.
    await startRecordingStream();
  };

  const handleCloseSnackbar = () => {
    setOpenSnackbar(false);
    setSnackbarMessage('');
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">Seamless Communication</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" style={{ textAlign: 'center', marginTop: '20px' }}>
        <Typography variant="h4" gutterBottom>
          Seamless Communication S2ST
        </Typography>
        {conversations.map((conv, i) => (
          <Box
            key={i}
            component={Paper}
            style={{
              marginTop: '20px',
              padding: '20px',
              textAlign: conv.speaker === 1 ? 'left' : 'right',
            }}
          >
            <Typography variant="h5">Translation Results</Typography>
            {(conv.recognizedText || conv.translatedText) && (
              <>
                <Typography variant="body1">
                  <strong>Recognized Text:</strong> {conv.recognizedText}
                </Typography>
                <Typography variant="body1">
                  <strong>Translated Text:</strong> {conv.translatedText}
                </Typography>
                <Typography variant="body1">
                  <strong>Detected Language:</strong> {conv.detectedLanguage}
                </Typography>
                <Typography variant="body1">
                  <strong>Translated Language:</strong> {conv.translatedLanguage}
                </Typography>
              </>
            )}
            {conv.audioUrl && (
              <Box
                style={{
                  marginTop: '20px',
                  textAlign: 'center',
                }}
              >
                <audio ref={audioElementRef} controls>
                  <source src={conv.audioUrl} type="audio/wav" />
                </audio>
              </Box>
            )}
          </Box>
        ))}
      </Container>
      <Backdrop
        sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={loading}>
        <CircularProgress color="inherit" />
      </Backdrop>
      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        open={openSnackbar}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        message={snackbarMessage}Nov
      />
    </ThemeProvider>
  );
};

export default SeamlessCommunication;