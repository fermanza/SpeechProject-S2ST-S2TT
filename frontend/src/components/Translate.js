import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import {
    Button,
    Container,
    Typography,
    CssBaseline,
    AppBar,
    Toolbar,
    Paper,
    Box,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
    Radio,
    RadioGroup,
    FormControlLabel,
    FormLabel,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import AudioPlayer from './AudioPlayer';

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

const Translate = () => {
    const [recording, setRecording] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [detectedLanguage, setDetectedLanguage] = useState('');
    const [translatedLanguage, setTranslatedLanguage] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('Spanish'); // Default target language
    const [translationType, setTranslationType] = useState('speech-to-text'); // Default translation type
    const [textToTranslateInput, setTextToTranslateInput] = useState('');
    const [translatedAudioUrl, setTranslatedAudioUrl] = useState('');
    const [audioSource, setAudioSource] = useState('file'); // Default audio source
    const mediaRecorderRef = useRef(null);
    const resetInProgress = useRef(false);
    const audioPlayerRef = useRef(null);

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
                console.error('Error during cleanup:', error);
            }
        }
        setRecording(false);
    };

    const calculateDuration = async (blob) => {
        if (!isValidBlob(blob)) {
            console.warn('Invalid audio blob:', blob);
            return NaN;
        }

        const audioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new audioContextClass();
        const arrayBuffer = await blob.arrayBuffer();

        if (arrayBuffer.byteLength === 0) {
            console.warn('Array buffer is empty for blob:', blob);
            return NaN;
        }

        try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            return audioBuffer.duration;
        } catch (error) {
            console.error('Error decoding audio data:', error.message);
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
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = async (event) => {
                if (!resetInProgress.current && event.data.size > 0) {
                    const duration = await calculateDuration(event.data);
                    if (duration >= 4) {
                        const chunkDetails = {
                            url: URL.createObjectURL(event.data),
                        };

                        // Send the chunk to backend for processing
                        await sendChunkToBackend(event.data, chunkDetails);
                    } else {
                        console.log(`Skipped chunk with duration of ${duration} seconds`);
                    }
                }
            };

            mediaRecorder.onstop = () => {
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorder.onerror = (event) => {
                console.error('Error during recording:', event.error);
                cleanup();
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorder.start(10000); // Collect audio in 10-second chunks
            setRecording(true);
        } catch (err) {
            console.error('Error accessing microphone:', err);
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

    const handleTextToTranslateSubmit = async () => {
        const formData = new FormData();
        formData.append('text', textToTranslateInput);
        formData.append('target_language', targetLanguage);
        formData.append('translation_type', translationType); // Ensure this field is set correctly

        try {
            const response = await fetch('http://localhost:5000/translate', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorResponse = await response.text();
                console.error('Backend server error:', errorResponse);
                throw new Error('Backend server error');
            }

            const result = await response.json();

            if (translationType === 'text-to-speech') {
                const translatedAudioBlob = new Blob([result.translatedAudio], { type: 'audio/wav' });
                const translatedAudioUrl = URL.createObjectURL(translatedAudioBlob);
                setTranslatedAudioUrl(translatedAudioUrl);
            } else if (translationType === 'text-to-text') {
                setTranslatedText(result.translated);
            }
        } catch (error) {
            console.error('Error sending text to backend:', error);
        }
    };

    const sendChunkToBackend = async (audioChunk, chunkDetails) => {
        const formData = new FormData();
        formData.append('audio_chunk', audioChunk, 'chunk.webm'); // Append the audio chunk
        formData.append('target_language', targetLanguage); // Append the target language
        formData.append('translation_type', translationType); // Append the translation type

        try {
            const response = await fetch('http://localhost:5000/translate', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorResponse = await response.text(); // Use text(), not json(), to better log the exact error
                console.error('Backend server error:', errorResponse);
                throw new Error('Backend server error');
            }

            const result = await response.json();

            // Handle the responses based on translation type
            if (translationType === 'speech-to-text' || translationType === 'speech-to-speech') {
                // Append the new recognized text and translated text to the existing state variables
                setRecognizedText((prevText) => prevText + result.recognized + ' ');
                setTranslatedText((prevText) => prevText + result.translated + ' ');
            }

            if (translationType === 'speech-to-speech') {
                // Play the translated speech
                const translatedAudioBlob = new Blob([result.translatedAudio], { type: 'audio/wav' });
                const translatedAudioUrl = URL.createObjectURL(translatedAudioBlob);
                setTranslatedAudioUrl(translatedAudioUrl);
            }

            // Set detected language based on detected language
            const lang = result.language;
            setDetectedLanguage(lang === 'es' ? 'Spanish' : 'English');
            // Set translated language based on detected language
            setTranslatedLanguage(lang === 'es' ? 'English' : 'Spanish');
        } catch (error) {
            console.error('Error sending chunk to backend:', error);
        } finally {
            await resetMicrophone();
        }
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <AppBar position="static">
                <Toolbar>
                    <Typography variant="h6">Audio Chunks Translator</Typography>
                </Toolbar>
            </AppBar>
            <Container maxWidth="md" style={{ textAlign: 'center', marginTop: '20px' }}>
                <Typography variant="h4" gutterBottom>
                    Translate Audio Chunks
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
                        <MenuItem value="English">English</MenuItem>
                    </Select>
                </FormControl>
                <FormControl variant="outlined" style={{ minWidth: 200, marginBottom: '20px' }}>
                    <InputLabel id="translation-type-label">Translation Type</InputLabel>
                    <Select
                        labelId="translation-type-label"
                        value={translationType}
                        onChange={(e) => setTranslationType(e.target.value)}
                        label="Translation Type"
                    >
                        <MenuItem value="speech-to-text">S2TT (Speech to Text translation)</MenuItem>
                        <MenuItem value="speech-to-speech">S2ST (Speech to Speech translation)</MenuItem>
                        <MenuItem value="text-to-text">T2TT (Text to Text translation)</MenuItem>
                        <MenuItem value="text-to-speech">T2ST (Text to Speech translation)</MenuItem>
                    </Select>
                </FormControl>
                {translationType === 'text-to-text' && (
                    <Box component={Paper} style={{ marginTop: '20px', padding: '20px', textAlign: 'left' }}>
                        <TextField
                            label="Enter Text"
                            multiline
                            rows={4}
                            variant="outlined"
                            fullWidth
                            value={textToTranslateInput}
                            onChange={(e) => setTextToTranslateInput(e.target.value)}
                        />
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleTextToTranslateSubmit}
                            style={{ marginTop: '10px' }}
                        >
                            Translate Text
                        </Button>
                    </Box>
                )}
                {translationType === 'text-to-speech' && (
                    <Box component={Paper} style={{ marginTop: '20px', padding: '20px', textAlign: 'left' }}>
                        <TextField
                            label="Enter Text"
                            multiline
                            rows={4}
                            variant="outlined"
                            fullWidth
                            value={textToTranslateInput}
                            onChange={(e) => setTextToTranslateInput(e.target.value)}
                        />
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleTextToTranslateSubmit}
                            style={{ marginTop: '10px' }}
                        >
                            Convert to Speech
                        </Button>
                    </Box>
                )}
                {(translationType === 'speech-to-text' || translationType === 'speech-to-speech') && (
                    <>
                        <FormControl component="fieldset" style={{ marginBottom: '20px' }}>
                            <FormLabel component="legend">Audio Source</FormLabel>
                            <RadioGroup
                                row
                                aria-label="audio-source"
                                name="audio-source"
                                value={audioSource}
                                onChange={(e) => setAudioSource(e.target.value)}
                            >
                                <FormControlLabel value="file" control={<Radio />} label="File" />
                                <FormControlLabel value="microphone" control={<Radio />} label="Microphone" />
                            </RadioGroup>
                        </FormControl>
                        {audioSource === 'microphone' ? (
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={recording ? stopRecording : startRecording}
                                style={{ margin: '0 10px' }}
                            >
                                {recording ? 'Stop Streaming' : 'Start Streaming'}
                            </Button>
                        ) : (
                            <Button
                                component="label"
                                variant="contained"
                                color="primary"
                                style={{ margin: '0 10px' }}
                            >
                                Upload Audio
                                <input
                                    type="file"
                                    accept="audio/*"
                                    hidden
                                    onChange={(e) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                            // Handle the file upload logic
                                            console.log('File selected:', file);
                                            // If you need to trigger sendChunkToBackend with the file
                                            // sendChunkToBackend(file);
                                        }
                                    }}
                                />
                            </Button>
                        )}
                    </>
                )}
                <Box component={Paper} style={{ marginTop: '20px', padding: '20px', textAlign: 'left' }}>
                    <Typography variant="h5">Translation Results</Typography>
                    <br />
                    {(translationType === 'speech-to-text' || translationType === 'speech-to-speech') && (
                        <>
                            <Typography variant="body1">
                                <strong>Recognized Text:</strong> {recognizedText}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Translated Text:</strong> {translatedText}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Detected Language:</strong> {detectedLanguage}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Translated Language:</strong> {translatedLanguage}
                            </Typography>
                        </>
                    )}
                    {translationType === 'text-to-text' && (
                        <Box style={{ marginTop: '20px', textAlign: 'center' }}>
                            <TextField
                                label="Translated Text"
                                multiline
                                rows={4}
                                variant="outlined"
                                fullWidth
                                value={translatedText}
                                InputProps={{
                                    readOnly: true,
                                }}
                            />
                        </Box>
                    )}
                    {(translationType === 'speech-to-speech' || translationType === 'text-to-speech') && (
                        <Box style={{ marginTop: '20px', textAlign: 'center', pointerEvents: translatedAudioUrl ? 'auto' : 'none', opacity: translatedAudioUrl ? 1 : 0.5 }}>
                            <AudioPlayer ref={audioPlayerRef} />
                        </Box>
                    )}
                </Box>
            </Container>
        </ThemeProvider>
    );
};

export default Translate;