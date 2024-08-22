from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO
import speech_recognition as sr
import googletrans
import logging
from pydub import AudioSegment
import os
import uuid
import pyttsx3
import torch
from seamless_communication.models.inference import Translator as SeamlessTranslator

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

recognizer = sr.Recognizer()
google_translator = googletrans.Translator()
# Initialize Seamless Translator
seamless_translator = SeamlessTranslator(
    "seamlessM4T_large",
    "vocoder_36langs",
    torch.device("cuda:0")
)

# Configure logging
logging.basicConfig(level=logging.INFO)

WEBM_DIR = "./temp_webm"
WAV_DIR = "./temp_wav"
SPEECH_DIR = "./temp_speech"

# Create directories if they don't exist
os.makedirs(WEBM_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(SPEECH_DIR, exist_ok=True)

BUFFER_THRESHOLD = 100000  # Example threshold for collected chunks

@app.route("/translate", methods=["POST"])
def translate():
    try:
        app.logger.info("Received request to /translate")
        audio_chunk = request.files.get("audio_chunk")
        text = request.form.get("text")
        target_language = request.form.get("target_language")
        translation_type = request.form.get("translation_type")

        if not target_language:
            return jsonify({"error": "Target language missing"}), 400

        if not translation_type:
            return jsonify({"error": "Translation type missing"}), 400

        if translation_type == 'text-to-speech':
            if not text:
                return jsonify({"error": "Text missing for text-to-speech"}), 400

            detected_lang = google_translator.detect(text).lang
            translated = google_translator.translate(text, src=detected_lang, dest=target_language)
            translated_text = translated.text

            speech_filename = f"{uuid.uuid4()}.wav"
            speech_path = text_to_speech_google(translated_text, target_language, speech_filename)
            with open(speech_path, "rb") as speech_file:
                translated_audio = speech_file.read()

            os.remove(speech_path)

            return jsonify({
                "translated": translated_text,
                "translatedAudio": translated_audio,
                "language": detected_lang
            }), 200

        elif translation_type == 'text-to-text':
            if not text:
                return jsonify({"error": "Text missing for text-to-text"}), 400

            detected_lang = google_translator.detect(text).lang
            translated = google_translator.translate(text, src=detected_lang, dest=target_language)
            translated_text = translated.text

            return jsonify({
                "translated": translated_text,
                "language": detected_lang
            }), 200

        elif translation_type == 'speech-to-text' or translation_type == 'speech-to-speech':
            if not audio_chunk:
                return jsonify({"error": "Audio chunk missing"}), 400

            webm_path = save_chunk_to_file(audio_chunk.read())
            chunk_size = os.path.getsize(webm_path)

            if chunk_size < BUFFER_THRESHOLD:
                return jsonify({"message": "Chunk received, waiting for more data"}), 200

            wav_path = convert_webm_to_wav(webm_path)

            recognized_text, _, _ = seamless_translator.predict(wav_path, "s2tt", 'eng')
            os.remove(webm_path)
            os.remove(wav_path)

            if translation_type == 'speech-to-speech':
                translated_text, _, translated_audio = seamless_translator.predict(recognized_text, "t2st", target_language)

                audio_path = os.path.join(SPEECH_DIR, f"{uuid.uuid4()}.wav")
                translated_audio.save(audio_path)
                with open(audio_path, "rb") as audio_file:
                    translated_audio_data = audio_file.read()

                os.remove(audio_path)

                return jsonify({
                    "recognized": recognized_text,
                    "translated": translated_text,
                    "translatedAudio": translated_audio_data,
                    "language": target_language
                }), 200

            else:  # 'speech-to-text'
                translated_text, _, _ = seamless_translator.predict(recognized_text, "t2tt", target_language)

                return jsonify({
                    "recognized": recognized_text,
                    "translated": translated_text,
                    "language": target_language
                }), 200

    except sr.UnknownValueError:
        return jsonify({"error": "Could not understand audio"}), 400
    except sr.RequestError as e:
        return jsonify({"error": f"Could not request results; {e}"}), 500
    except Exception as e:
        app.logger.error(f"Exception: {str(e)}")
        return jsonify({"error": str(e)}), 500


def save_chunk_to_file(chunk_data):
    file_path = os.path.join(WEBM_DIR, f"chunk_{uuid.uuid4()}.webm")
    with open(file_path, "wb") as f:
        f.write(chunk_data)
    return file_path


def convert_webm_to_wav(webm_path):
    wav_path = os.path.join(WAV_DIR, f"chunk_{uuid.uuid4()}.wav")
    audio = AudioSegment.from_file(webm_path, format="webm")
    audio.export(wav_path, format="wav")
    return wav_path


def text_to_speech_google(text, language, filename):
    gtts = gTTS(text=text, lang=language)
    file_path = os.path.join(SPEECH_DIR, filename)
    gtts.save(file_path)
    return file_path


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)