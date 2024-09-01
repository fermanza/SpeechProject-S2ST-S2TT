import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import {
  Container,
  Typography,
  CssBaseline,
  AppBar,
  Toolbar,
  Paper,
  Box,
  ThemeProvider,
  createTheme
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
  const resetInProgress = useRef(false);
  const audioElementRef = useRef(null);
  const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5500'; // Fallback to localhost:5500 if not set
  const threshold = process.env.REACT_APP_THRESHOLD || 2000; // Increase to 2000ms (2 seconds)
  const silenceThreshold = 0.05; // Define what to consider as silence (adjust as needed)
  const initialCaptureDelay = 2000; // Initial delay of 2 seconds before starting capture

  const sessionId = useRef(generateSessionId()).current;
  const audioChunksRef = useRef([]);
  const silenceTimerRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceDetectedRef = useRef(false);
  const voiceDetectedRef = useRef(false); // Flag to track voice detection

  useEffect(() => {
    // Adding a delay before the microphone starts capturing voice
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
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }
    setRecording(false);
    audioChunksRef.current = [];
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

      console.log('Stream obtained:', stream);
      console.log('Using mimeType:', mimeType);

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
        console.log('MediaRecorder stopped.');
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.onerror = (event) => {
        console.error('Error during recording:', event.error);
        cleanup();
      };

      mediaRecorder.start(100);
      setRecording(true);
      console.log('Recording started');

      detectVoice(analyser, bufferLength, dataArray);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const detectVoice = (analyser, bufferLength, dataArray) => {
    const detect = () => {
      analyser.getByteTimeDomainData(dataArray);
      const average = dataArray.reduce((acc, val) => acc + Math.abs(val - 128), 0) / bufferLength;

      if (average / 128 > silenceThreshold) {
        voiceDetectedRef.current = true;
        // console.log('Voice detected');
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }
        silenceDetectedRef.current = false;
      } else {
        if (!silenceDetectedRef.current && voiceDetectedRef.current) {
          silenceDetectedRef.current = true;
          // console.log('Silence detected, starting timer');
          silenceTimerRef.current = setTimeout(async () => {
            silenceDetectedRef.current = false;
            voiceDetectedRef.current = false;
            console.log('Silence lasted long enough, sending audio to backend');
            await sendAudioToBackend();
          }, threshold);
        }
      }

      requestAnimationFrame(detect);
    };

    detect();
  };

  const sendAudioToBackend = async () => {
    if (audioChunksRef.current.length === 0) {
      console.error("No audio chunks to send.");
      resumeRecordingSession();
      return;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    console.log('Blob size:', audioBlob.size);
    console.log('Blob type:', audioBlob.type);

    // Clear chunks after they're included in the blob
    audioChunksRef.current = [];

    if (!isValidBlob(audioBlob)) {
      console.error('Invalid audio blob:', audioBlob);
      resumeRecordingSession();
      return;
    }

    console.log('Sending audio to backend');

    const formData = new FormData();
    formData.append('audio_chunk', audioBlob, 'audio.webm'); // Append the audio blob
    formData.append('target_language', 'en'); // Fixed target language to English for simplicity
    formData.append('translation_type', 's2st'); // Append the translation type
    formData.append('session_id', sessionId);

    try {
      const response = await fetch(`${backendUrl}/translate`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Backend server error');
        resetVariables();
      }

      console.log('Response from backend:', response);

      const result = await response.json();

      resetVariables(); // Reset variables after successful response

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

      // Toggle speaker for next turn
      setCurrentSpeaker((prevSpeaker) => (prevSpeaker === 1 ? 2 : 1));

      // Auto-play the translated audio
      if (audioElementRef.current) {
        audioElementRef.current.src = generateUniqueUrl(result.audio_url || '');
        audioElementRef.current.play();
      }
    } catch (error) {
      console.error('Error sending audio to backend:', error);
      resetVariables(); // Reset variables in case of an error
    } finally {
      setTimeout(async () => {
        await startRecordingStream();
      }, 200);
    }
  };

  const resumeRecordingSession = async () => {
    console.log('Resuming recording session after error...');
    resetVariables(); // Reset variables when resuming
    setTimeout(async () => {
      await startRecordingStream();
    }, 200);
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
              textAlign: conv.speaker === 1 ? 'left' : 'right'
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
                  pointerEvents: conv.audioUrl ? 'auto' : 'none',
                  opacity: conv.audioUrl ? 1 : 0.5,
                }}
              >
                <audio controls>
                  <source src={conv.audioUrl} type="audio/wav" />
                </audio>
              </Box>
            )}
          </Box>
        ))}
      </Container>
    </ThemeProvider>
  );
};

export default SeamlessCommunication;