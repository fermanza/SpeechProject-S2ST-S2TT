import * as React from 'react';
import {useState, useRef, useEffect} from 'react';
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
import {ThemeProvider, createTheme} from '@mui/material/styles';
import AudioPlayer from './AudioPlayer';

// Theme definition
const theme = createTheme({
    palette: {
        mode: 'light',
        background: {
            default: '#ffffff',
        },
    },
});

// Static language mapping
const languageMapping = {
    en: 'English',
    es: 'Spanish',
    // Add other mappings as needed
};

// Function to get full language name
const getFullLanguageName = (code) => languageMapping[code] || code;

// Function to get supported MIME type
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

// Function to generate session ID
const generateSessionId = () => 'session-' + Date.now();

// Function to generate a unique URL
const generateUniqueUrl = (baseUrl) => `${baseUrl}?t=${new Date().getTime()}`;

// Main Translate component
const Translate = () => {
    const [recording, setRecording] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [detectedLanguage, setDetectedLanguage] = useState('');
    const [translatedLanguage, setTranslatedLanguage] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('Spanish'); // Default target language
    const [translationType, setTranslationType] = useState('s2tt'); // Default translation type
    const [textToTranslateInput, setTextToTranslateInput] = useState('');
    const [translatedAudioUrl, setTranslatedAudioUrl] = useState('');
    const [audioSource, setAudioSource] = useState('file'); // Default audio source
    const mediaRecorderRef = useRef(null);
    const resetInProgress = useRef(false);
    const audioPlayerRef = useRef(null);
    const backendUrl = process.env.REACT_APP_BACKEND_URL;

    // Generate or obtain your sessionId here
    const sessionId = useRef(generateSessionId()).current; // Generate session ID once and keep it stable

    useEffect(() => {
        return () => cleanup();
    }, []);

    // Function to check if the blob is valid
    const isValidBlob = (blob) => {
        if (blob.size === 0 || !blob.type.startsWith('audio/')) {
            return false;
        }
        return true;
    };

    // Cleanup function
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

    // Function to calculate the duration of an audio blob
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

    // Function to start recording audio
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            const mimeType = getSupportedMimeType();
            if (!mimeType) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }

            const mediaRecorder = new MediaRecorder(stream, {mimeType});
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

    // Function to reset the microphone
    const resetMicrophone = async () => {
        resetInProgress.current = true;
        cleanup();
        await startRecording();
        resetInProgress.current = false;
    };

    // Function to stop recording audio
    const stopRecording = () => {
        resetInProgress.current = false;
        cleanup();
    };

    // Function to handle translation type change
    const handleChange = (event) => {
        const {value} = event.target;
        if (['s2tt', 's2st', 't2tt', 't2st'].includes(value)) {
            setTranslationType(value);

            // Reset the relevant state variables
            setRecognizedText('');
            setTranslatedText('');
            setDetectedLanguage('');
            setTranslatedLanguage('');
            setTranslatedAudioUrl('');
        } else {
            console.error(`Invalid translation type: ${value}`);
            setTranslationType(''); // or set a default value
        }
    };

    // Function to handle text translation submit
    const handleTextToTranslateSubmit = async () => {
        const formData = new FormData();
        formData.append('text', textToTranslateInput); // Append text to translate
        formData.append('target_language', targetLanguage); // Append the target language
        formData.append('translation_type', translationType); // Append translation type (t2tt, t2st, etc.)
        formData.append('input_language', detectedLanguage); // Append input language
        formData.append('session_id', sessionId); // Append session ID

        try {
            const response = await fetch(`${backendUrl}/translate`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorResponse = await response.text();
                console.error('Backend server error:', errorResponse);
                throw new Error('Backend server error');
            }

            const result = await response.json();

            if (translationType === 't2st' || translationType === 's2st') {
                setTranslatedText(result.translated); // Set the translated text
                const audioUrl = generateUniqueUrl(`${backendUrl}${result.audio_url}`); // Construct the audio file URL
                setTranslatedAudioUrl(audioUrl); // Set the audio URL for playback
            } else if (translationType === 't2tt') {
                setTranslatedText(result.translated); // Set the translated text for text-to-text translation
            }

            // Set detected and translated languages
            setDetectedLanguage(result.detected_language || ''); // Assuming detected_language is in the response
            setTranslatedLanguage(result.translated_language || targetLanguage); // Use response or target language
        } catch (error) {
            console.error('Error sending text to backend:', error);
        }
    };

    // Function to send audio chunk to the backend
    const sendAudioToBackend = async () => {
        if (audioChunksRef.current.length === 0) {
            console.error("No audio chunks to send.");
            resumeRecordingSession();
            return;
        }

        const audioBlob = new Blob(audioChunksRef.current, {type: 'audio/webm'});
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
        // formData.append('target_language', 'en'); // Removed target language parameter
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

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline/>
            <AppBar position="static">
                <Toolbar>
                    <Typography variant="h6">Audio Chunks Translator</Typography>
                </Toolbar>
            </AppBar>
            <Container maxWidth="md" style={{textAlign: 'center', marginTop: '20px'}}>
                <Typography variant="h4" gutterBottom>
                    Translate Audio Chunks
                </Typography>
                <FormControl variant="outlined" style={{minWidth: 200, marginBottom: '20px'}}>
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
                <FormControl variant="outlined" style={{minWidth: 200, marginBottom: '20px'}}>
                    <InputLabel id="translation-type-label">Translation Type</InputLabel>
                    <Select value={translationType} onChange={handleChange}>
                        <MenuItem value="s2tt">S2TT - Speech-to-Text</MenuItem>
                        <MenuItem value="s2st">S2ST - Speech-to-Speech</MenuItem>
                        <MenuItem value="t2tt">T2TT - Text-to-Text</MenuItem>
                        <MenuItem value="t2st">T2ST - Text-to-Speech</MenuItem>
                    </Select>
                </FormControl>
                {(translationType === 't2tt' || translationType === 't2st') && (
                    <Box component={Paper} style={{marginTop: '20px', padding: '20px', textAlign: 'left'}}>
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
                            style={{marginTop: '10px'}}
                        >
                            {translationType === 't2st' ? 'Convert to Speech' : 'Translate Text'}
                        </Button>
                    </Box>
                )}
                {(translationType === 's2tt' || translationType === 's2st') && (
                    <>
                        <FormControl component="fieldset" style={{marginBottom: '20px'}}>
                            <FormLabel component="legend">Audio Source</FormLabel>
                            <RadioGroup
                                row
                                aria-label="audio-source"
                                name="audio-source"
                                value={audioSource}
                                onChange={(e) => setAudioSource(e.target.value)}
                            >
                                <FormControlLabel value="file" control={<Radio/>} label="File"/>
                                <FormControlLabel value="microphone" control={<Radio/>} label="Microphone"/>
                            </RadioGroup>
                        </FormControl>
                        {audioSource === 'microphone' ? (
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={recording ? stopRecording : startRecording}
                                style={{margin: '0 10px'}}
                            >
                                {recording ? 'Stop Streaming' : 'Start Streaming'}
                            </Button>
                        ) : (
                            <Button
                                component="label"
                                variant="contained"
                                color="primary"
                                style={{margin: '0 10px'}}
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
                <Box component={Paper} style={{marginTop: '20px', padding: '20px', textAlign: 'left'}}>
                    <Typography variant="h5">Translation Results</Typography>
                    <br/>
                    {(translationType === 's2st' || translationType === 's2tt') && (
                        <>
                            <Typography variant="body1">
                                <strong>Recognized Text:</strong> {recognizedText}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Translated Text:</strong> {translatedText}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Detected Language:</strong> {getFullLanguageName(detectedLanguage)}
                            </Typography>
                            <Typography variant="body1">
                                <strong>Translated Language:</strong> {getFullLanguageName(translatedLanguage)}
                            </Typography>
                        </>
                    )}
                    {translationType === 't2tt' && (
                        <Box style={{marginTop: '20px', textAlign: 'center'}}>
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
                    {(translationType === 's2st' || translationType === 't2st') && (
                        <Box
                            style={{
                                marginTop: '20px',
                                textAlign: 'center',
                                pointerEvents: translatedAudioUrl ? 'auto' : 'none',
                                opacity: translatedAudioUrl ? 1 : 0.5,
                            }}
                        >
                            {
                                sessionId && translatedAudioUrl ?
                                    <AudioPlayer ref={audioPlayerRef} sessionId={sessionId}
                                                 audioUrl={translatedAudioUrl}/>
                                    :
                                    <AudioPlayer ref={audioPlayerRef}/>
                            }
                        </Box>
                    )}
                </Box>
            </Container>
        </ThemeProvider>
    );
};

export default Translate;