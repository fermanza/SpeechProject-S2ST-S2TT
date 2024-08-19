from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect
import speech_recognition as sr
from io import BytesIO
import googletrans
import logging
import av

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=True, engineio_logger=True)

recognizer = sr.Recognizer()
translator = googletrans.Translator()

# Configure logging
logging.basicConfig(level=logging.INFO)

# TEMP_BUFFER stores audio before processing
TEMP_BUFFER = BytesIO()
# Lowering BUFFER_THRESHOLD for testing
BUFFER_THRESHOLD = 100000  # 100 KB

def convert_webm_to_wav(webm_bytes):
    try:
        input_container = av.open(webm_bytes)
        output_buffer = BytesIO()

        input_stream = input_container.streams.audio[0]
        output_container = av.open(output_buffer, 'w', format='wav')
        output_stream = output_container.add_stream('pcm_s16le', rate=input_stream.rate)

        for frame in input_container.decode(input_stream):
            for packet in output_stream.encode(frame):
                output_container.mux(packet)
        for packet in output_stream.encode(None):
            output_container.mux(packet)

        output_container.close()
        output_buffer.seek(0)
        return output_buffer
    except Exception as e:
        app.logger.error(f"Error during conversion: {str(e)}")
        raise

@app.route("/translate", methods=["POST"])
def translate():
    global TEMP_BUFFER

    if "audio_chunk" not in request.files:
        app.logger.error("No audio chunk found in request")
        return jsonify({"error": "No audio chunk found"}), 400

    audio_chunk = request.files["audio_chunk"]

    try:
        app.logger.info("Appending audio chunk to buffer")
        TEMP_BUFFER.write(audio_chunk.read())

        audio_buffer_size = TEMP_BUFFER.getbuffer().nbytes
        app.logger.info(f"Audio buffer size: {audio_buffer_size} bytes")

        if audio_buffer_size < BUFFER_THRESHOLD:
            return jsonify({"message": "Chunk received"}), 200

        TEMP_BUFFER.seek(0)
        audio_wav_bytes = convert_webm_to_wav(TEMP_BUFFER)
        TEMP_BUFFER = BytesIO()

        with sr.AudioFile(audio_wav_bytes) as source:
            audio_data = recognizer.record(source)
            text = recognizer.recognize_google(audio_data)
            app.logger.info(f"Recognized text: {text}")

            detected_lang = translator.detect(text).lang
            app.logger.info(f"Detected language: {detected_lang}")
            if detected_lang is None:
                raise ValueError("Detected language is None")

            target_lang = 'es' if detected_lang == 'en' else 'en'
            translated = translator.translate(text, src=detected_lang, dest=target_lang)
            if translated is None or not translated:
                raise ValueError("Translation result is None or empty")

            translated_text = translated.text
            app.logger.info(f"Translated text: {translated_text}")
            return jsonify({
                "recognized": text,
                "translated": translated_text,
                "detectedLanguage": detected_lang
            }), 200

    except sr.UnknownValueError:
        app.logger.error("Could not understand audio")
        TEMP_BUFFER = BytesIO()
        return jsonify({"error": "Could not understand audio"}), 400
    except sr.RequestError as e:
        app.logger.error(f"Could not request results; {e}")
        TEMP_BUFFER = BytesIO()
        return jsonify({"error": f"Could not request results; {e}"}), 500
    except IndexError as e:
        app.logger.error(f"IndexError: {e}")
        TEMP_BUFFER = BytesIO()
        return jsonify({"error": f"IndexError: {e}"}), 500
    except Exception as e:
        app.logger.error(f"Exception: {str(e)}")
        TEMP_BUFFER = BytesIO()
        return jsonify({"error": str(e)}), 500

@socketio.on('audio_chunk')
def handle_audio_chunk(data):
    global TEMP_BUFFER

    app.logger.info("Received audio chunk.")
    try:
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
        audio_wav_bytes = convert_webm_to_wav(TEMP_BUFFER)
        TEMP_BUFFER = BytesIO()

        with sr.AudioFile(audio_wav_bytes) as source:
            audio_data = recognizer.record(source)
            app.logger.info("Recorded audio from AudioSegment.")
            text = recognizer.recognize_google(audio_data)
            app.logger.info(f"Recognized text: {text}")

            detected_lang = translator.detect(text).lang
            if not detected_lang:
                raise ValueError("Detected language is None")

            target_lang = 'es' if detected_lang == 'en' else 'en'
            translated = translator.translate(text, src=detected_lang, dest=target_lang)
            if translated is None or not translated:
                raise ValueError("Translation result is None or empty")

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