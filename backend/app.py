from flask import Flask, request, jsonify, send_from_directory, url_for
from flask_cors import CORS
import speech_recognition as sr
from transformers import MBartForConditionalGeneration, MBart50Tokenizer
import logging
from pydub import AudioSegment
import uuid
import torch
import soundfile as sf
from transformers import WhisperProcessor, WhisperForConditionalGeneration
from gtts import gTTS
from langdetect import detect, LangDetectException
import os
import librosa

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)

# Force download the model
WhisperForConditionalGeneration.from_pretrained("openai/whisper-large-v2")
WhisperProcessor.from_pretrained("openai/whisper-large-v2")

# Initialize models and processors
processor = WhisperProcessor.from_pretrained("openai/whisper-large-v2")
try:
    model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-large-v2")
except FileNotFoundError as e:
    app.logger.error(f"Model files not found. Ensure the model is downloaded correctly: {str(e)}")
    raise e
except Exception as e:
    app.logger.error(f"Error loading model: {str(e)}", exc_info=True)
    raise e

# Initialize translation model and tokenizer
translation_model_name = "facebook/mbart-large-50-many-to-one-mmt"
try:
    tokenizer = MBart50Tokenizer.from_pretrained(translation_model_name, clean_up_tokenization_spaces=True)
    translation_model = MBartForConditionalGeneration.from_pretrained(translation_model_name,
                                                                      ignore_mismatched_sizes=True)
    app.logger.info(f"Model and tokenizer for {translation_model_name} loaded successfully.")
except Exception as e:
    app.logger.error(f"Failed to load model {translation_model_name}: {e}")
    raise e

recognizer = sr.Recognizer()

# Configure logging
logging.basicConfig(level=logging.INFO)

WEBM_DIR = "./temp_webm"
WAV_DIR = "./temp_wav"
SPEECH_DIR = "./temp_speech"

# Create directories if they don't exist
os.makedirs(WEBM_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(SPEECH_DIR, exist_ok=True)

BUFFER_THRESHOLD = 20000

LANGUAGE_MAPPING = {
    'en': 'en_XX',  # Language code mapping for MarianMT
    'es': 'es_XX',
    # Add more mappings as needed
}


def resample_audio(file_path, target_sr=16000):
    y, sr = librosa.load(file_path, sr=None)
    y_resampled = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
    resampled_path = file_path.replace(".wav", "_resampled.wav")
    sf.write(resampled_path, y_resampled, target_sr)
    return resampled_path


def detect_language(text):
    """
    Use langdetect to detect the language from the text.
    """
    try:
        detected_lang_code = detect(text)
        app.logger.info(f"Detected language: {detected_lang_code} for text: '{text}'")
        return detected_lang_code
    except LangDetectException as e:
        app.logger.error(f"Language detection failed: {str(e)}")
        return 'unknown'


@app.route("/translate", methods=["POST"])
def translate():
    try:
        app.logger.info("Received request to /translate")
        session_id = request.form.get("session_id")
        if not session_id:
            return jsonify({"error": "Session ID missing"}), 400

        audio_chunk = request.files.get("audio_chunk")
        text = request.form.get("text")
        translation_type = request.form.get("translation_type")

        if not translation_type:
            return jsonify({"error": "Translation type missing"}), 400

        response_data = {}

        if translation_type != 's2st':
            response_data["status"] = "success"

        session_file_path = os.path.join(SPEECH_DIR, f"session_{session_id}.wav")

        if translation_type in ['t2st', 't2tt']:
            if not text:
                return jsonify({"error": "Text missing for text-to-text or text-to-speech"}), 400

            detected_lang_code = detect_language(text)
            source_language = LANGUAGE_MAPPING.get(detected_lang_code, 'en')

            app.logger.info(f"Detected language: {detected_lang_code} for text: {text}")

            # Infer the target language based on the detected language
            if detected_lang_code == 'en':
                target_language_code = 'es'  # For example, hardcoded to translate English to Spanish
            else:
                target_language_code = 'en'  # Default to English for other languages

            target_language = LANGUAGE_MAPPING.get(target_language_code)

            if not target_language:
                return jsonify({"error": f"Target language '{target_language_code}' not supported"}), 400

            app.logger.info(f"Source language: {source_language}, Target language: {target_language}")

            # Initialize the MBart50Tokenizer and MBartForConditionalGeneration models
            translation_model_name = 'facebook/mbart-large-50-many-to-many-mmt'
            tokenizer = MBart50Tokenizer.from_pretrained(translation_model_name)
            translation_model = MBartForConditionalGeneration.from_pretrained(translation_model_name)

            # Encode the source text with the source language token
            tokenizer.src_lang = source_language
            encoded_input = tokenizer(text, return_tensors="pt")

            # Prepare decoder inputs so that the model starts decoding with the target language token
            forced_bos_token_id = tokenizer.lang_code_to_id[target_language]

            # Generate the translation
            translated_tokens = translation_model.generate(**encoded_input, forced_bos_token_id=forced_bos_token_id)
            translated_text = tokenizer.decode(translated_tokens[0], skip_special_tokens=True)

            app.logger.info(f"Translation result: {translated_text}")

            if translation_type == 't2st':
                tts = gTTS(translated_text, lang=target_language_code)
                temp_audio_path = f"{SPEECH_DIR}/t2st-{target_language_code}-{uuid.uuid4()}.mp3"
                tts.save(temp_audio_path)
                wav_audio_path = temp_audio_path.replace(".mp3", ".wav")
                AudioSegment.from_mp3(temp_audio_path).export(wav_audio_path, format="wav")
                os.remove(temp_audio_path)
                append_audio(session_file_path, wav_audio_path)
                response_data["audio_url"] = url_for('download_file', filename=f"session_{session_id}.wav",
                                                     _external=True)

            response_data.update({
                "translated": translated_text,
                "detected_language": detected_lang_code,
                "translated_language": target_language_code
            })

        elif translation_type in ['s2tt', 's2st']:
            if not audio_chunk:
                return jsonify({"error": "Audio chunk missing"}), 400

            webm_path = save_chunk_to_file(audio_chunk.read())

            chunk_size = os.path.getsize(webm_path)
            if chunk_size < BUFFER_THRESHOLD:
                return jsonify({"message": "Chunk received, waiting for more data"}), 200

            try:
                wav_path = convert_webm_to_wav(webm_path)
            except Exception as e:
                return jsonify({"error": f"Failed to convert .webm to .wav: {str(e)}"}), 500

            resampled_wav_path = resample_audio(wav_path)

            try:
                speech_array, sampling_rate = sf.read(resampled_wav_path)
                input_features = processor(speech_array, sampling_rate=sampling_rate,
                                           return_tensors="pt").input_features

                with torch.no_grad():
                    predicted_ids = model.generate(input_features, use_cache=True)

                recognized_text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
            except Exception as e:
                return jsonify({"error": f"Failed to process audio with Whisper: {str(e)}"}), 500

            os.remove(webm_path)
            os.remove(wav_path)

            detected_lang_code = detect_language(recognized_text)
            source_language = LANGUAGE_MAPPING.get(detected_lang_code, 'en')

            if not source_language:
                return jsonify({"error": f"Detected language '{detected_lang_code}' not supported"}), 400

            app.logger.info(f"Detected language: {detected_lang_code} for text: {recognized_text}")

            # Infer the target language based on the detected language
            if detected_lang_code == 'en':
                target_language_code = 'es'  # For example, hardcoded to translate English to Spanish
            else:
                target_language_code = 'en'  # Default to English for other languages

            target_language = LANGUAGE_MAPPING.get(target_language_code)

            if not target_language:
                return jsonify({"error": f"Target language '{target_language_code}' not supported"}), 400

            app.logger.info(f"Source language: {source_language}, Target language: {target_language}")

            # Initialize the MBart50Tokenizer and MBartForConditionalGeneration models
            translation_model_name = 'facebook/mbart-large-50-many-to-many-mmt'
            tokenizer = MBart50Tokenizer.from_pretrained(translation_model_name)
            translation_model = MBartForConditionalGeneration.from_pretrained(translation_model_name)

            # Encode the source text with the source language token
            tokenizer.src_lang = source_language
            encoded_input = tokenizer(recognized_text, return_tensors="pt")

            # Prepare decoder inputs so that the model starts decoding with the target language token
            forced_bos_token_id = tokenizer.lang_code_to_id[target_language]

            # Generate the translation
            translated_tokens = translation_model.generate(**encoded_input, forced_bos_token_id=forced_bos_token_id)
            translated_text = tokenizer.decode(translated_tokens[0], skip_special_tokens=True)

            app.logger.info(f"Recognized: {recognized_text}")
            app.logger.info(f"Translation result: {translated_text}")

            if translation_type == 's2st':
                temp_audio_path = text_to_speech_google(translated_text, target_language_code,
                                                        f"s2st-{target_language_code}-{uuid.uuid4()}.mp3")
                wav_audio_path = temp_audio_path.replace(".mp3", ".wav")
                AudioSegment.from_mp3(temp_audio_path).export(wav_audio_path, format="wav")
                os.remove(temp_audio_path)
                append_audio(session_file_path, wav_audio_path)
                response_data["audio_url"] = url_for('download_file', filename=f"session_{session_id}.wav",
                                                     _external=True)

            response_data.update({
                "recognized": recognized_text,
                "translated": translated_text,
                "detected_language": detected_lang_code,
                "translated_language": target_language_code
            })

        return jsonify(response_data), 200

    except sr.UnknownValueError:
        return jsonify({"error": "Could not understand audio"}), 400
    except sr.RequestError as e:
        return jsonify({"error": f"Could not request results; {e}"}), 500
    except Exception as e:
        app.logger.error("An error occurred during translation", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/audio/session/<path:filename>', methods=['GET'])
def download_file(filename):
    directory = os.path.join(app.root_path, 'temp_speech')
    return send_from_directory(directory, filename)


def save_chunk_to_file(chunk_data):
    try:
        file_name = f"chunk_{uuid.uuid4()}.webm"
        file_path = os.path.join(WEBM_DIR, file_name)
        with open(file_path, "wb") as f:
            f.write(chunk_data)
        app.logger.info(f"Saved chunk to {file_path}")
        return file_path
    except Exception as e:
        app.logger.error(f"Failed to save chunk to file: {str(e)}")
        raise


def convert_webm_to_wav(webm_path):
    try:
        wav_path = os.path.join(WAV_DIR, f"chunk_{uuid.uuid4()}.wav")
        audio = AudioSegment.from_file(webm_path, format="webm")
        audio.export(wav_path, format="wav")
        app.logger.info(f"Converted {webm_path} to {wav_path}")
        return wav_path
    except Exception as e:
        app.logger.error(f"Failed to convert .webm to .wav: {str(e)}")
        raise


def append_audio(output_path, new_audio_path):
    if not os.path.exists(output_path):
        os.rename(new_audio_path, output_path)
    else:
        original = AudioSegment.from_file(output_path)
        new_audio = AudioSegment.from_file(new_audio_path)
        combined = original + new_audio
        combined.export(output_path, format="wav")
        os.remove(new_audio_path)


def text_to_speech_google(text, language, filename):
    gtts = gTTS(text=text, lang=language)
    file_path = os.path.join(SPEECH_DIR, filename)
    gtts.save(file_path)
    return file_path


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5500, debug=True)
