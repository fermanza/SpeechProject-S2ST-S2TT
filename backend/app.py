from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect
import speech_recognition as sr
from io import BytesIO
import googletrans
import logging
from gtts import gTTS
from pydub import AudioSegment
import os
import uuid
import pyttsx3

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

recognizer = sr.Recognizer()
translator = googletrans.Translator()

# Configure logging
logging.basicConfig(level=logging.INFO)

# Temporary directories for .webm and .wav files
WEBM_DIR = "./temp_webm"
WAV_DIR = "./temp_wav"
SPEECH_DIR = "./temp_speech"

# Create directories if they don't exist
os.makedirs(WEBM_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(SPEECH_DIR, exist_ok=True)

BUFFER_THRESHOLD = 100000  # Example threshold for collected chunks

TEMP_BUFFER = BytesIO()


def text_to_speech(text, language, filename):
    language_map = {
        'English': 'en',
        'Spanish': 'es'
    }

    if language not in language_map:
        raise ValueError(f"Language not supported: {language}")

    language_code = language_map[language]
    engine = pyttsx3.init()

    # Set the language for the synthesis
    voices = engine.getProperty('voices')
    for voice in voices:
        if language_code in voice.languages:
            engine.setProperty('voice', voice.id)
            break
    else:
        raise ValueError(f"Language not supported: {language}")

    engine.save_to_file(text, filename)
    engine.runAndWait()
    return filename


def save_chunk_to_file(chunk_data):
    """ Save the received audio chunk to a file """
    app.logger.info("Saving chunk to file")
    try:
        file_path = os.path.join(WEBM_DIR, "chunk.webm")
        with open(file_path, "ab") as f:
            f.write(chunk_data)
        app.logger.info(f"Chunk saved to {file_path}")
        return file_path
    except Exception as e:
        app.logger.error(f"Error saving chunk to file: {e}")
        raise


def convert_webm_to_wav(webm_path):
    try:
        app.logger.info(f"Converting {webm_path} to WAV")
        wav_path = os.path.join(WAV_DIR, "chunk.wav")
        audio = AudioSegment.from_file(webm_path, format="webm")
        audio.export(wav_path, format="wav")
        app.logger.info(f"Converted {webm_path} to {wav_path}")
        return wav_path
    except Exception as e:
        app.logger.error(f"Error during conversion: {str(e)}")
        raise


def text_to_speech(text, lang, filename):
    """ Converts text to speech using gTTS """
    try:
        tts = gTTS(text=text, lang=lang)
        file_path = os.path.join(SPEECH_DIR, filename)
        tts.save(file_path)
        return file_path
    except Exception as e:
        app.logger.error(f"Error during text-to-speech conversion: {str(e)}")
        raise


@app.route("/translate", methods=["POST"])
def translate():
    try:
        app.logger.info("Received request to /translate")
        audio_chunk = request.files.get("audio_chunk")
        text = request.form.get("text")
        target_language = request.form.get("target_language")
        translation_type = request.form.get("translation_type")

        if not target_language:
            app.logger.error("Request missing target language")
            return jsonify({"error": "Target language missing"}), 400

        if not translation_type:
            app.logger.error("Request missing translation type")
            return jsonify({"error": "Translation type missing"}), 400

        if translation_type == 'text-to-speech':
            if not text:
                app.logger.error("Request missing text for text-to-speech")
                return jsonify({"error": "Text missing for text-to-speech"}), 400

            detected_lang = translator.detect(text).lang
            translated = translator.translate(text, src=detected_lang, dest=target_language)
            translated_text = translated.text

            speech_filename = f"{uuid.uuid4()}.wav"
            speech_path = text_to_speech(translated_text, target_language, speech_filename)
            with open(speech_path, "rb") as speech_file:
                translated_audio = speech_file.read()

            # Clean up speech file after sending
            os.remove(speech_path)

            return jsonify({
                "translated": translated_text,
                "translatedAudio": translated_audio,
                "language": detected_lang
            }), 200
        else:
            if not audio_chunk:
                app.logger.error("Request missing audio chunk")
                return jsonify({"error": "Audio chunk missing"}), 400

            webm_path = save_chunk_to_file(audio_chunk.read())

            chunk_size = os.path.getsize(webm_path)
            app.logger.info(f"Current chunk size: {chunk_size} bytes")

            if chunk_size < BUFFER_THRESHOLD:
                app.logger.info("Chunk size below threshold, waiting for more data")
                return jsonify({"message": "Chunk received, waiting for more data"}), 200

            wav_path = convert_webm_to_wav(webm_path)

            app.logger.info(f"Processing WAV file {wav_path}")

            with sr.AudioFile(wav_path) as source:
                audio_data = recognizer.record(source)
                app.logger.info("Audio data recorded")
                text = recognizer.recognize_google(audio_data)
                app.logger.info(f"Recognized text: {text}")

                detected_lang = translator.detect(text).lang
                app.logger.info(f"Detected language: {detected_lang}")
                if detected_lang is None:
                    app.logger.error("Detected language is none")
                    raise ValueError("Detected language is none")

                translated = translator.translate(text, src=detected_lang, dest=target_language)
                if translated is None or not translated:
                    raise ValueError("Translation result is none or empty")

                translated_text = translated.text
                app.logger.info(f"Translated text: {translated_text}")

                result = {"recognized": text, "translated": translated_text, "language": detected_lang}

                if translation_type == 'speech-to-speech':
                    speech_filename = f"{uuid.uuid4()}.wav"
                    speech_path = text_to_speech(translated_text, target_language, speech_filename)
                    with open(speech_path, "rb") as speech_file:
                        result["translatedAudio"] = speech_file.read()

                    # Clean up speech file after sending
                    os.remove(speech_path)

                # Clean up files after use
                os.remove(webm_path)
                os.remove(wav_path)

                return jsonify(result), 200

    except sr.UnknownValueError:
        app.logger.error("Could not understand audio")
        return jsonify({"error": "Could not understand audio"}), 400
    except sr.RequestError as e:
        app.logger.error(f"Could not request results; {e}")
        return jsonify({"error": f"Could not request results; {e}"}), 500
    except Exception as e:
        app.logger.error(f"Exception: {str(e)}")
        return jsonify({"error": str(e)}), 500


@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    global TEMP_BUFFER

    try:
        app.logger.info("Received audio chunk.")
        if not data:
            app.logger.error("No audio data received")
            return

        audio_chunk = BytesIO(data)
        app.logger.info(f"Audio chunk size: {audio_chunk.getbuffer().nbytes} bytes")
        TEMP_BUFFER.write(audio_chunk.read())

        audio_buffer_size = TEMP_BUFFER.getbuffer().nbytes
        if audio_buffer_size < BUFFER_THRESHOLD:
            return

        TEMP_BUFFER.seek(0)
        audio_wav_bytes = None
        try:
            audio_wav_bytes = convert_webm_to_wav(TEMP_BUFFER)
        except Exception as e:
            app.logger.error(f"Could not convert WebM to WAV: {e}")
            emit('error', {'message': f"Could not convert WebM to WAV: {str(e)}"})
            disconnect()
            return

        TEMP_BUFFER = BytesIO()

        with sr.AudioFile(audio_wav_bytes) as source:
            audio_data = recognizer.record(source)
            app.logger.info("Recorded audio from AudioSegment")
            text = recognizer.recognize_google(audio_data)
            app.logger.info(f"Recognized text: {text}")

            detected_lang = translator.detect(text).lang
            if not detected_lang:
                raise ValueError("Detected language is none")

            target_lang = 'es' if detected_lang == 'en' else 'en'
            translated = translator.translate(text, src=detected_lang, dest=target_lang)
            if translated is None or not translated:
                raise ValueError("Translation result is none or empty")

            translated_text = translated.text
            app.logger.info(f"Translated text: {translated_text}")

            emit('translation', {'translated': translated_text, 'detectedLanguage': detected_lang})
    except sr.UnknownValueError:
        app.logger.error("Speech Recognition could not understand audio")
        emit('error', {'message': "Could not understand audio"})
    except sr.RequestError as e:
        app.logger.error(f"Could not request results from Speech Recognition service; {e}")
        emit('error', {'message': "Error with Speech Recognition service"})
    except Exception as e:
        app.logger.error(f"Real-time translation error: {str(e)}")
        emit('error', {'message': f"Real-time translation error: {str(e)}"})
        disconnect()


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
