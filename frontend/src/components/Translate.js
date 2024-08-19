import React, { useState, useRef, useEffect } from 'react';
import { Button, Container, Typography, CssBaseline, AppBar, Toolbar } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import io from 'socket.io-client';

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
        'audio/ogg; codecs=opus',
        'audio/ogg',
        'audio/webm; codecs=opus',
        'audio/webm',
        'audio/wav'
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
    const [streaming, setStreaming] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [detectedLanguage, setDetectedLanguage] = useState(null);
    const [targetLanguage, setTargetLanguage] = useState('Spanish');
    const mediaRecorderRef = useRef(null);
    const TEMP_BUFFER = useRef(new Blob()); // Temporary buffer for gathered chunks

    const cleanup = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current = null;
        }
        TEMP_BUFFER.current = new Blob();
        setRecording(false);
        setStreaming(false);
    };

    useEffect(() => {
        // Clean up the state on unmount
        return () => {
            cleanup();
        };
    }, []);

    const uploadAudioChunk = async (audioBlob) => {
        const formData = new FormData();
        formData.append('audio_chunk', audioBlob, 'chunk.webm');

        try {
            const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/translate`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.message === "Chunk received") {
                console.info('Chunk received, continue recording...');
                return;
            }

            if (data.recognized || data.translated || data.detectedLanguage) {
                setRecognizedText((prev) => prev + ' ' + (data.recognized || ''));
                setTranslatedText((prev) => prev + ' ' + (data.translated || ''));
                if (data.detectedLanguage) {
                    let language = data.detectedLanguage;
                    let targetLang = 'Spanish'; // Default target language
                    if (language === 'en') {
                        language = 'English';
                        targetLang = 'Spanish';
                    } else if (language === 'es') {
                        language = 'Spanish';
                        targetLang = 'English';
                    }
                    setDetectedLanguage(language);
                    setTargetLanguage(targetLang);
                }
            } else {
                console.warn('Incomplete data received from the server', data);
            }
        } catch (error) {
            console.error('Error sending audio data:', error);
        }
    };

    const startRecording = () => {
        setRecognizedText('');
        setTranslatedText('');
        setDetectedLanguage(null);

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then((stream) => {
                const mimeType = getSupportedMimeType();
                if (!mimeType) {
                    console.error('Your browser does not support the required audio format for recording.');
                    return;
                }

                const mediaRecorder = new MediaRecorder(stream, { mimeType });
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0) {
                        try {
                            await uploadAudioChunk(event.data);
                        } catch (error) {
                            console.error('Error during audio chunk upload:', error);
                        }
                    } else {
                        console.warn('Empty audio chunk received, skipping...');
                    }
                };

                mediaRecorder.start(1000); // Collect audio in 1-second chunks
                setRecording(true);
            }).catch((err) => {
                console.error('Error accessing microphone:', err);
            });
    };

    const stopRecording = () => {
        cleanup();
    };

    const startStreaming = () => {
        setRecognizedText('');
        setTranslatedText('');
        setDetectedLanguage(null);

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then((stream) => {
                const mimeType = getSupportedMimeType();
                if (!mimeType) {
                    console.error('Your browser does not support the required audio format for streaming.');
                    return;
                }

                const mediaRecorder = new MediaRecorder(stream, { mimeType });
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0) {
                        try {
                            await uploadAudioChunk(event.data);
                        } catch (error) {
                            console.error('Error during audio chunk upload:', error);
                        }
                    } else {
                        console.warn('Empty audio chunk received, skipping...');
                    }
                };

                mediaRecorder.start(3000); // Collect audio in 3-second chunks
                setStreaming(true);
            }).catch((err) => {
                console.error('Error accessing microphone:', err);
            });
    };

    const stopStreaming = () => {
        cleanup();
    };

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <AppBar position='static'>
                <Toolbar>
                    <Typography variant='h6'>Audio Translator</Typography>
                </Toolbar>
            </AppBar>
            <Container maxWidth='sm' style={{ textAlign: 'center', marginTop: '20px' }}>
                <Typography variant='h4' gutterBottom>
                    Audio Translation
                </Typography>
                <Button
                    variant='contained'
                    color='primary'
                    onClick={recording ? stopRecording : startRecording}
                    style={{ margin: '0 10px' }}
                    disabled={streaming}
                >
                    {recording ? 'Stop Recording' : 'Start Recording'}
                </Button>
                <Button
                    variant='contained'
                    color='secondary'
                    onClick={streaming ? stopStreaming : startStreaming}
                    style={{ margin: '0 10px' }}
                    disabled={recording}
                >
                    {streaming ? 'Stop Streaming' : 'Start Streaming'}
                </Button>
                {recognizedText && (
                    <Typography variant='body1' style={{ marginTop: '20px' }}>
                        Recognized Text: {recognizedText}
                    </Typography>
                )}
                {translatedText && (
                    <Typography variant='body1' style={{ marginTop: '20px' }}>
                        Translated Text: {translatedText}
                    </Typography>
                )}
                {detectedLanguage && translatedText && (
                    <Typography variant='body2' color='textSecondary' style={{ marginTop: '20px' }}>
                        {`Detected Language: ${detectedLanguage}. Translating to ${targetLanguage}.`}
                    </Typography>
                )}
            </Container>
        </ThemeProvider>
    );
};

export default Translate;