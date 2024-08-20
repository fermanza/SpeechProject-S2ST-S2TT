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
    Paper,
    Select,
    MenuItem,
    FormControl,
    InputLabel
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

    for (const mimeType of possibleTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }
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

const AudioChunks = () => {
    const [recording, setRecording] = useState(false);
    const [recordedChunksDetails, setRecordedChunksDetails] = useState([]);
    const [targetLanguage, setTargetLanguage] = useState("Spanish"); // Default target language
    const mediaRecorderRef = useRef(null);
    const resetInProgress = useRef(false);

    useEffect(() => {
        return () => {
            cleanup();
        };
    }, []);

    const isValidBlob = (blob) => {
        if (blob.size === 0 || !blob.type.startsWith('audio/')) {
            return false;
        }
        return true;
    };

    const cleanup = () => {
        if (mediaRecorderRef.current) {
            try {
                mediaRecorderRef.current.stop();
                mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
                mediaRecorderRef.current = null;
            } catch (error) {
                console.error("Error during cleanup:", error);
            }
        }
        setRecording(false);
    };

    const calculateDuration = async (blob) => {
        if (!isValidBlob(blob)) {
            console.warn("Invalid audio blob:", blob);
            return NaN;
        }

        const audioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new audioContextClass();
        const arrayBuffer = await blob.arrayBuffer();

        if (arrayBuffer.byteLength === 0) {
            console.warn("Array buffer is empty for blob:", blob);
            return NaN;
        }

        try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            return audioBuffer.duration;
        } catch (error) {
            console.error("Error decoding audio data:", error.message);
            return NaN;
        } finally {
            audioContext.close();
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = getSupportedMimeType();
            if (!mimeType) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = async (event) => {
                if (!resetInProgress.current && event.data.size > 0) {
                    const duration = await calculateDuration(event.data);
                    if (duration >= 4) {
                        const chunkURL = URL.createObjectURL(event.data);
                        const chunkDetails = {
                            url: chunkURL,
                            size: event.data.size,
                            format: mimeType,
                            duration: isNaN(duration) ? "N/A" : duration.toFixed(2),
                            recordedTime: getCurrentFormattedTime(),
                            recognizedText: "Processing...",
                            translatedText: "Processing..."
                        };

                        // Add the chunkDetails to the state immediately
                        setRecordedChunksDetails((prevDetails) => [...prevDetails, chunkDetails]);

                        // Send the chunk to backend for processing
                        await sendChunkToBackend(event.data, chunkDetails);
                    } else {
                        console.log(`Skipped chunk with duration of ${duration} seconds`);
                    }
                }
            };

            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.onerror = (event) => {
                console.error("Error during recording:", event.error);
                cleanup();
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start(10000);  // Collect audio in 10-second chunks
            setRecording(true);
        } catch (err) {
            console.error("Error accessing microphone:", err);
        }
    };

    const resetMicrophone = async () => {
        resetInProgress.current = true;
        cleanup();
        await startRecording();
        resetInProgress.current = false;
    };

    const stopRecording = () => {
        resetInProgress.current = false;
        cleanup();
    };

    const sendChunkToBackend = async (audioChunk, chunkDetails) => {
        const formData = new FormData();
        formData.append('audio_chunk', audioChunk, 'chunk.webm');  // Append the audio chunk
        formData.append('target_language', targetLanguage); // Append the target language

        try {
            const response = await fetch('http://localhost:5000/translate', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorResponse = await response.text();  // Use text(), not json(), to better log the exact error
                console.error('Backend server error:', errorResponse);
                throw new Error('Backend server error');
            }

            const result = await response.json();

            // Update the chunk details in the state with recognized and translated text
            setRecordedChunksDetails((prevDetails) => {
                return prevDetails.map(chunk => {
                    if (chunk.url === chunkDetails.url) {
                        return {
                            ...chunk,
                            recognizedText: result.recognized || 'N/A',
                            translatedText: result.translated || 'N/A'
                        };
                    }
                    return chunk;
                });
            });
        } catch (error) {
            console.error('Error sending chunk to backend:', error);
        } finally {
            await resetMicrophone();
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
                <FormControl variant="outlined" style={{ minWidth: 200, marginBottom: '20px' }}>
                    <InputLabel id="target-language-label">Target Language</InputLabel>
                    <Select
                        labelId="target-language-label"
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        label="Target Language"
                    >
                        <MenuItem value="Spanish">Spanish</MenuItem>
                        <MenuItem value="French">French</MenuItem>
                        <MenuItem value="German">German</MenuItem>
                        {/* Add more languages as needed */}
                    </Select>
                </FormControl>
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
                                <TableCell>Recognized Text</TableCell>
                                <TableCell>Translated Text</TableCell>
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
                                    <TableCell>{chunk.recognizedText || 'N/A'}</TableCell>
                                    <TableCell>{chunk.translatedText || 'N/A'}</TableCell>
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