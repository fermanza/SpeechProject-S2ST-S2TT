import React, {useState, useRef} from 'react';

const AudioRecorder = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [recognizedText, setRecognizedText] = useState("");
    const [translatedText, setTranslatedText] = useState("");
    const [detectedLanguage, setDetectedLanguage] = useState(null);
    const mediaRecorderRef = useRef(null);
    const fileIdRef = useRef(`file-${Date.now()}`);  // Use a unique identifier for fileId

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
    };

    const sendChunkToAPI = (chunk, fileId) => {
        const formData = new FormData();
        formData.append("audio_chunk", chunk);

        fetch("http://localhost:5000/translate", {
            method: "POST",
            body: formData,
            headers: {
                "File-Id": fileId
            }
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Server error: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Success:", data);
                setRecognizedText(data.recognized);
                setTranslatedText(data.translated);
                setDetectedLanguage(data.detectedLanguage);
            })
            .catch((error) => {
                console.error("Error uploading audio chunk:", error);
            });
    };

    const handleDataAvailable = (event) => {
        if (event.data.size > 0) {
            sendChunkToAPI(event.data, fileIdRef.current);
        }
    };

    const startRecording = () => {
        if (isRecording) return;  // Prevent multiple recording sessions
        setIsRecording(true);

        navigator.mediaDevices.getUserMedia({audio: true})
            .then(stream => {
                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;
                mediaRecorder.ondataavailable = handleDataAvailable;
                mediaRecorder.start(1000); // Adjust the time interval as needed
            })
            .catch(error => {
                console.error("Error accessing media devices.", error);
                setIsRecording(false);
            });
    };

    return (
        <div>
            <button onClick={startRecording} disabled={isRecording}>
                Start Recording
            </button>
            <button onClick={stopRecording} disabled={!isRecording}>
                Stop Recording
            </button>
            {recognizedText && (
                <div>
                    <h3>Recognized Text:</h3>
                    <p>{recognizedText}</p>
                </div>
            )}
            {translatedText && (
                <div>
                    <h3>Translated Text:</h3>
                    <p>{translatedText}</p>
                </div>
            )}
            {detectedLanguage && (
                <div>
                    <h3>Detected Language:</h3>
                    <p>{detectedLanguage}</p>
                </div>
            )}
        </div>
    );
};

export default AudioRecorder;