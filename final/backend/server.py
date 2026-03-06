import whisper
from flask import Flask, request, jsonify
import requests
import tempfile
import os
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# Load Whisper model once at startup
whisper_model = whisper.load_model("tiny")  # You can use "tiny", "base", "small", "medium", "large"

def transcribe_audio_url(audio_url):
    # Download audio file
    response = requests.get(audio_url)
    if response.status_code != 200:
        return None
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(response.content)
        tmp_path = tmp.name
    # Run Whisper transcription
    result = whisper_model.transcribe(tmp_path)
    os.remove(tmp_path)
    return result["text"]

@app.route('/check-i-agree', methods=['POST'])
def check_i_agree():
    audio_url = request.form.get('audio_url')
    transcription = transcribe_audio_url(audio_url)
    said_i_agree = transcription and "i agree" in transcription.lower()
    return jsonify({'said_i_agree': said_i_agree, 'transcription': transcription, 'audio_url': audio_url})

@app.route('/transcribe', methods=['POST'])
@app.route('/transcribe', methods=['OPTIONS', 'POST'])
def transcribe():
    if request.method == 'OPTIONS':
        return '', 200
    file = request.files.get('audio')
    if not file:
        return jsonify({'error': 'No audio file provided'}), 400
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.read())
        tmp_path = tmp.name
    result = whisper_model.transcribe(tmp_path)
    os.remove(tmp_path)
    return jsonify({'transcription': result["text"]})

@app.route('/', methods=['GET'])
def index():
    return 'We Listen & We Don\'t Judge!', 200

if __name__ == '__main__':
    app.run(debug=True)