from flask import Flask, request, jsonify, send_from_directory, url_for
from flask_cors import CORS
from transformers import WhisperProcessor, WhisperForConditionalGeneration, MBartForConditionalGeneration, \
    MBart50Tokenizer
from gtts import gTTS
from langdetect import detect, LangDetectException
import logging
import os
import uuid
from pydub import AudioSegment
import soundfile as sf
import torch
import librosa
import concurrent.futures

app = Flask(__name__)
CORS(app, resources={r"/translate": {"origins": "http://localhost:3000"}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:3000')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'POST')
    return response


WEBM_DIR = "./temp_webm"
WAV_DIR = "./temp_wav"
SPEECH_DIR = "./temp_speech"

os.makedirs(WEBM_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(SPEECH_DIR, exist_ok=True)

# whisper_model_name = "openai/whisper-small"
whisper_model_name = "openai/whisper-base"
processor = WhisperProcessor.from_pretrained(whisper_model_name)
model = WhisperForConditionalGeneration.from_pretrained(whisper_model_name)

translation_model_name = "facebook/mbart-large-50-many-to-many-mmt"
tokenizer = MBart50Tokenizer.from_pretrained(translation_model_name)
translation_model = MBartForConditionalGeneration.from_pretrained(translation_model_name)

LANGUAGE_MAPPING = {
    'en': 'en_XX',
    'es': 'es_XX',
}


def resample_audio(file_path, target_sr=16000):
    y, sr = librosa.load(file_path, sr=None)
    y_resampled = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
    resampled_path = file_path.replace(".wav", "_resampled.wav")
    sf.write(resampled_path, y_resampled, target_sr)
    return resampled_path


def detect_language(text):
    try:
        return detect(text)
    except LangDetectException as e:
        logger.error(f"Language detection failed: {str(e)}")
        return 'unknown'


def get_target_language(detected_language):
    return 'es' if detected_language == 'en' else 'en'


def append_audio(output_path, new_audio_path):
    if not os.path.exists(output_path):
        os.rename(new_audio_path, output_path)
    else:
        original = AudioSegment.from_file(output_path)
        new_audio = AudioSegment.from_file(new_audio_path)
        combined = original + new_audio
        combined.export(output_path, format="wav")
        os.remove(new_audio_path)


def transcribe_audio(file_path):
    try:
        speech_array, sampling_rate = sf.read(file_path, dtype='float32')
        input_features = processor(speech_array, sampling_rate=sampling_rate, return_tensors="pt").input_features

        with torch.no_grad():
            predicted_ids = model.generate(input_features)

        return processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

    except Exception as e:
        logger.error(f"Error during transcription: {str(e)}")
        return None


@app.route("/translate", methods=["POST"])
def translate():
    try:
        session_id = request.form.get("session_id")
        if not session_id:
            return jsonify({"error": "Session ID missing"}), 400

        audio_file = request.files.get("audio_file")
        text = request.form.get("text")
        translation_type = request.form.get("translation_type")

        if not translation_type:
            return jsonify({"error": "Translation type missing"}), 400

        response_data = {}
        session_file_path = os.path.join(SPEECH_DIR, f"session_{session_id}.wav")

        if translation_type in ['t2st', 't2tt']:
            if not text:
                return jsonify({"error": "Text missing for text-to-text or text-to-speech"}), 400

            detected_lang_code = detect_language(text)
            target_lang_code = get_target_language(detected_lang_code)

            response_data.update({
                "detected_language": detected_lang_code,
                "target_language": target_lang_code
            })

            if translation_type == 't2st':
                tts = gTTS(text, lang=target_lang_code)
                temp_audio_path = f"{SPEECH_DIR}/t2st-{target_lang_code}-{uuid.uuid4()}.mp3"
                tts.save(temp_audio_path)
                wav_audio_path = temp_audio_path.replace(".mp3", ".wav")
                AudioSegment.from_mp3(temp_audio_path).export(wav_audio_path, format="wav")
                os.remove(temp_audio_path)
                append_audio(session_file_path, wav_audio_path)
                response_data["audio_url"] = url_for('download_file', filename=f"session_{session_id}.wav",
                                                     _external=True)

        elif translation_type in ['s2tt', 's2st']:
            if not audio_file:
                return jsonify({"error": "Audio file missing"}), 400

            audio_file_path = save_file(audio_file)
            try:
                wav_path = convert_webm_to_wav(audio_file_path)
                resampled_wav_path = resample_audio(wav_path)
            except Exception as e:
                logger.error(f"Failed to process audio: {str(e)}")
                return jsonify({"error": f"Failed to process audio: {str(e)}"}), 500

            with concurrent.futures.ThreadPoolExecutor() as executor:
                transcription_future = executor.submit(transcribe_audio, resampled_wav_path)
                detected_lang_code_future = executor.submit(detect_language, transcription_future.result())
                target_lang_code_future = executor.submit(get_target_language, detected_lang_code_future.result())

            try:
                recognized_text = transcription_future.result()
                if recognized_text is None:
                    raise RuntimeError("Transcription result is none")

                response_data["recognized_text"] = recognized_text
            except Exception as e:
                logger.error(f"Failed to transcribe audio: {str(e)}")
                return jsonify({"error": f"Failed to transcribe audio: {str(e)}"}), 500

            os.remove(audio_file_path)
            os.remove(wav_path)

            detected_lang_code = detected_lang_code_future.result()
            target_lang_code = target_lang_code_future.result()

            response_data.update({
                "recognized": recognized_text,
                "detected_language": detected_lang_code,
                "target_language": target_lang_code
            })

            if translation_type in ['s2tt', 's2st']:
                try:
                    tokenizer.src_lang = LANGUAGE_MAPPING[detected_lang_code]
                    encoded_input = tokenizer(recognized_text, return_tensors="pt")
                    forced_bos_token_id = tokenizer.lang_code_to_id[LANGUAGE_MAPPING[target_lang_code]]
                    translated_tokens = translation_model.generate(**encoded_input,
                                                                   forced_bos_token_id=forced_bos_token_id)
                    translated_text = tokenizer.decode(translated_tokens[0], skip_special_tokens=True)
                    response_data["translated_text"] = translated_text
                except KeyError as e:
                    logger.error(f"Language mapping key error: {str(e)}")
                    return jsonify({
                                       "error": f"Unsupported language for translation: {detected_lang_code} or {target_lang_code}"}), 400

                if translation_type == 's2st':
                    tts = gTTS(translated_text, lang=target_lang_code)
                    temp_audio_path = f"{SPEECH_DIR}/s2st-{target_lang_code}-{uuid.uuid4()}.mp3"
                    tts.save(temp_audio_path)
                    wav_audio_path = temp_audio_path.replace(".mp3", ".wav")
                    AudioSegment.from_mp3(temp_audio_path).export(wav_audio_path, format="wav")
                    os.remove(temp_audio_path)
                    append_audio(session_file_path, wav_audio_path)
                    response_data["audio_url"] = url_for('download_file', filename=f"session_{session_id}.wav",
                                                         _external=True)

        return jsonify(response_data), 200

    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500


def save_file(file):
    file_path = os.path.join(WEBM_DIR, f"{uuid.uuid4()}.webm")
    file.save(file_path)
    return file_path


def convert_webm_to_wav(webm_path):
    wav_path = webm_path.replace(".webm", ".wav")
    audio = AudioSegment.from_file(webm_path)
    audio = audio.set_channels(1)  # ensure mono channel
    audio.export(wav_path, format="wav")
    return wav_path


@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    return send_from_directory(SPEECH_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True, port=5500)
