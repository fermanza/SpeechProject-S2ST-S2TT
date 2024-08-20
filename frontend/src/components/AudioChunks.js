import React, { useState, useRef, useEffect } from 'react';
import {
  Button,
  Container,
  Typography,
  CssBaseline,
  AppBar,
  Toolbar,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#ffffff',
    },
  },
});

const getSupportedMimeType = () => {
  const possibleTypes = [
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/ogg',
    'audio/wav',
  ];

  console.log('Checking supported MIME types...');
  for (const mimeType of possibleTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      console.log('Supported MIME type found:', mimeType);
      return mimeType;
    }
  }

  console.error('No supported MIME type found');
  return null;
};

const getCurrentFormattedTime = () => {
  const currentDateTime = new Date();
  const year = currentDateTime.getFullYear();
  const month = String(currentDateTime.getMonth() + 1).padStart(2, '0');
  const date = String(currentDateTime.getDate()).padStart(2, '0');
  const hours = String(currentDateTime.getHours()).padStart(2, '0');
  const minutes = String(currentDateTime.getMinutes()).padStart(2, '0');
  const seconds = String(currentDateTime.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
};

const pause = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

const AudioChunks = () => {
  const [recording, setRecording] = useState(false);
  const [recordedChunksDetails, setRecordedChunksDetails] = useState([]);
  const mediaRecorderRef = useRef(null);
  const resetInProgress = useRef(false); // Using useRef for a persistent flag

  useEffect(() => {
    return () => {
      console.log('Component unmounting, running cleanup');
      cleanup();
    };
  }, []);

  const isValidBlob = (blob) => {
    if (blob.size === 0 || !blob.type.startsWith('audio/')) {
      console.error('Invalid Blob data:', { size: blob.size, type: blob.type });
      return false;
    }
    return true;
  };

  const cleanup = () => {
    if (mediaRecorderRef.current) {
      console.log('Stopping media recorder');
      try {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      } catch (error) {
        console.error("Error during cleanup:", error);
      }
    }
    setRecording(false);
  };

  const calculateDuration = async (blob) => {
    if (!isValidBlob(blob)) {
      console.error('Invalid blob for duration calculation:', blob);
      return NaN;
    }

    const audioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new audioContextClass();
    const arrayBuffer = await blob.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      console.error("Read resulted in empty ArrayBuffer.");
      return NaN;
    }

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log('Audio data decoded successfully:', audioBuffer);
      return audioBuffer.duration;
    } catch (error) {
      console.error('Error decoding audio data. Retrying once...');
      // Retry once
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log('Audio data decoded successfully on retry:', audioBuffer);
        return audioBuffer.duration;
      } catch (error) {
        console.error('Retry failed to decode audio data:', error);
        return NaN;
      }
    } finally {
      audioContext.close();
    }
  };

  const startRecording = async () => {
    console.log("Starting recording...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        console.error("Your browser does not support the required audio format for recording.");
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      console.log("Creating MediaRecorder with stream and MIME type:", mimeType);
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = async (event) => {
        console.log("Data available event:", event);
        if (!resetInProgress.current && event.data.size > 0) {
          console.log("Received valid audio chunk size:", event.data.size);
          const chunkURL = URL.createObjectURL(event.data);
          console.log("Created chunk URL:", chunkURL);

          const duration = await calculateDuration(event.data);

          // Filter out chunks with duration less than 4 seconds
          if (duration >= 4) {
            const chunkDetails = {
              url: chunkURL,
              size: event.data.size,
              format: mimeType,
              duration: isNaN(duration) ? "N/A" : duration.toFixed(2),
              recordedTime: getCurrentFormattedTime(),
            };
            console.log("New chunk details: ", chunkDetails);
            setRecordedChunksDetails((prevDetails) => [...prevDetails, chunkDetails]);
          } else {
            console.warn("Audio chunk duration is less than 4 seconds, skipping...");
          }

          // Call resetMicrophone synchronously
          await resetMicrophone();
        } else {
          console.warn("Empty or invalid audio chunk received, skipping...");
        }
      };

      mediaRecorder.onstop = (event) => {
        console.log("Recording stopped event:", event);
        stream.getTracks().forEach(track => track.stop());
        playbackChunks();
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        cleanup();
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.onstart = () => {
        console.log("Recording started");
      };

      mediaRecorder.onpause = () => {
        console.log("Recording paused");
      };

      mediaRecorder.onresume = () => {
        console.log("Recording resumed");
      };

      mediaRecorder.start(5000); // Collect audio in 5-second chunks
      setRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
    }
  };

  const resetMicrophone = async () => {
    resetInProgress.current = true;
    console.log('Pausing microphone...');
    await pause(100);
    cleanup();
    await startRecording(); // Ensure promises are properly chained
    resetInProgress.current = false;
    console.log('Restarting recording after pause...');
  };

  const stopRecording = async () => {
    console.log('Stopping recording...');
    resetInProgress.current = false;
    await cleanup();
  };

  const playbackChunks = () => {
    if (!recordedChunksDetails.length) {
      console.warn('No chunks available for playback');
      return;
    }

    const audioElements = recordedChunksDetails.map((chunk) => {
      console.log('Creating audio element for chunk URL:', chunk.url);
      return new Audio(chunk.url);
    });

    let currentChunkIndex = 0;

    audioElements.forEach((audio, index) => {
      audio.onended = () => {
        console.log('Audio chunk ended:', audio.src);
        if (index < audioElements.length - 1) {
          currentChunkIndex++;
          console.log('Playing next audio chunk:', audioElements[currentChunkIndex].src);
          audioElements[currentChunkIndex].play();
        }
      };
    });

    if (audioElements.length > 0) {
      console.log('Playing first audio chunk:', audioElements[currentChunkIndex].src);
      audioElements[currentChunkIndex].play();
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position='static'>
        <Toolbar>
          <Typography variant='h6'>Audio Chunks Recorder</Typography>
        </Toolbar>
      </AppBar>
      <Container maxWidth='sm' style={{ textAlign: 'center', marginTop: '20px' }}>
        <Typography variant='h4' gutterBottom>
          Audio Chunks
        </Typography>
        <Button
          variant='contained'
          color='primary'
          onClick={recording ? stopRecording : startRecording}
          style={{ margin: '0 10px' }}
        >
          {recording ? 'Stop Recording' : 'Start Recording'}
        </Button>
        <TableContainer component={Paper} style={{ marginTop: '20px', marginLeft: '-400px', width: '1400px' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Size (KB)</TableCell>
                <TableCell>Format</TableCell>
                <TableCell>Duration (s)</TableCell>
                <TableCell>Recorded Time</TableCell>
                <TableCell>Audio Chunk</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {recordedChunksDetails.map((chunk, index) => (
                <TableRow key={index}>
                  <TableCell>{(chunk.size / 1024).toFixed(2)}</TableCell>
                  <TableCell>{chunk.format}</TableCell>
                  <TableCell>{chunk.duration}</TableCell>
                  <TableCell>{chunk.recordedTime}</TableCell>
                  <TableCell>
                    <audio controls src={chunk.url} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Container>
    </ThemeProvider>
  );
};

export default AudioChunks;