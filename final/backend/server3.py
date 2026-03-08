# Define ConvModel class (copied from notebook)
import torch.nn as nn
import subprocess
import uuid

# Map index to label. todo: must be identical to the final.ipynb
label_map = ['kezia', 'matthew', 'others']

def convert_to_wav(input_path):
    wav_path = f"/tmp/{uuid.uuid4()}.wav"
    subprocess.run([
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        wav_path
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wav_path

class ConvModel(nn.Module):
    def __init__(self, mel_freq_bins, time_steps, num_classes):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, kernel_size=3, padding=1)
        self.relu1 = nn.ReLU()
        self.pool1 = nn.MaxPool2d(2,2)
        self.conv2 = nn.Conv2d(16, 32, kernel_size=3, padding=1)
        self.relu2 = nn.ReLU()
        self.pool2 = nn.MaxPool2d(2,2)
        self.conv3 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.relu3 = nn.ReLU()
        self.pool3 = nn.MaxPool2d(2,2)
        # flat_features will be set dynamically
        self.fc1 = None
        self.relu4 = nn.ReLU()
        self.dropout = nn.Dropout(0.5)
        self.fc2 = nn.Linear(256, num_classes)
        self._initialized = False
    def forward(self, x):
        x = self.pool1(self.relu1(self.conv1(x)))
        x = self.pool2(self.relu2(self.conv2(x)))
        x = self.pool3(self.relu3(self.conv3(x)))
        x = x.view(x.size(0), -1)
        if not self._initialized:
            self.flat_features = x.shape[1]
            self.fc1 = nn.Linear(self.flat_features, 256)
            self._initialized = True
        x = self.relu4(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return x
import whisper
from flask import Flask, request, jsonify
import requests
import tempfile
import os
from flask_cors import CORS
import torch as t
import torchaudio
from torchaudio import transforms

app = Flask(__name__)
CORS(app, 
     resources={r"/*": {"origins": "*"}},
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "OPTIONS"],
     supports_credentials=False  # Must be False when origins="*"
)

# Load Whisper model once at startup
whisper_model = whisper.load_model("tiny")  # You can use "tiny", "base", "small", "medium", "large"

# Load our custom voice id verification model
checkpoint = t.load('../model/model_weights/audrey_model_weights_2026-03-06_01-17-48.pth', map_location='cpu')
config = checkpoint['config']
model = ConvModel(config['mel_freq_bins'], config['time_steps'], config['num_classes'])
model.load_state_dict(checkpoint['model_state_dict'], strict=False)
model.eval()

def preprocess_audio(audio_path, config):
    wav_path = convert_to_wav(audio_path)

    waveform, sr = torchaudio.load(wav_path)

    target_sr = config['sample_rate']
    if sr != target_sr:
        resampler = transforms.Resample(orig_freq=sr, new_freq=target_sr)
        waveform = resampler(waveform)

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0).unsqueeze(0)

    target_length = config['longest_audio_file_length']
    current_length = waveform.shape[1]

    if current_length < target_length:
        pad_size = target_length - current_length
        left_pad = pad_size // 2
        right_pad = pad_size - left_pad
        waveform = t.nn.functional.pad(waveform, (left_pad, right_pad))

    elif current_length > target_length:
        start = (current_length - target_length) // 2
        waveform = waveform[:, start:start + target_length]

    mel_transform = transforms.MelSpectrogram(
        sample_rate=config['sample_rate'],
        n_mels=config['mel_freq_bins']
    )

    spec = mel_transform(waveform)

    os.remove(wav_path)

    return spec.unsqueeze(0)

def predict_class(audio_path):
    spec = preprocess_audio(audio_path, config)
    with t.no_grad():
        output = model(spec)
        predicted_class = t.argmax(output, dim=1).item()


    return label_map[predicted_class]

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

@app.route('/check-i-agree', methods=['OPTIONS', 'POST'])
def check_i_agree():
    if request.method == 'OPTIONS':
        return '', 200
    audio_url = request.form.get('audio_url')
    transcription = transcribe_audio_url(audio_url)
    said_i_agree = transcription and "i agree" in transcription.lower()
    return jsonify({'said_i_agree': said_i_agree, 'transcription': transcription, 'audio_url': audio_url})

# verify voice command with our trained model on /model
@app.route('/verify-me', methods=['OPTIONS', 'POST'])
def verify_me():
    if request.method == 'OPTIONS':
        return '', 200

    file = request.files.get('audio')
    user_id = request.form.get('user_id')

    if not file:
        return jsonify({'error': 'No audio file provided'}), 400
    if not user_id:
        return jsonify({'error': 'No user ID provided'}), 400
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.read())
        tmp_path = tmp.name

    # Run Whisper transcription, and check if it is i agree
    result = whisper_model.transcribe(tmp_path)
    transcription = result["text"]
    said_i_agree = transcription and "i agree" in transcription.lower()
    if not said_i_agree:
        os.remove(tmp_path)
        return jsonify({
            'error': 'User did not say "I agree". Access denied.',
            'said_i_agree': False,
            'transcription': transcription,
            'predicted_label': None,
            'unlock': False,
            'success': False
        }), 403
    
    # Run voice verification with our model
    predicted_label = predict_class(tmp_path)
    unlock = predicted_label == user_id
    os.remove(tmp_path)
    # if not unlock:
    #     return jsonify({
    #         'error': f'Your voice didn\'t match registered user: {user_id}. Access denied.',
    #         'transcription': transcription,
    #         'predicted_label': predicted_label,
    #         'unlock': False,
    #         'success': False
    #     }), 403
    
    return jsonify({
        'transcription': transcription,
        'predicted_label': predicted_label,
        'unlock': unlock,
        'success': True
        }), 200

@app.route('/transcribe', methods=['OPTIONS', 'POST'])
def transcribe():
    print("/transcribe endpoint called")
    if request.method == 'OPTIONS':
        return '', 200
    file = request.files.get('audio')
    if not file:
        print("No audio file provided in request")
        return jsonify({'error': 'No audio file provided'}), 400
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.read())
        tmp_path = tmp.name
    print(f"Saved temp file for transcription: {tmp_path}")
    try:
        result = whisper_model.transcribe(tmp_path)
        print(f"Whisper transcription result: {result}")
        os.remove(tmp_path)
        return jsonify({'transcription': result["text"]})
    except Exception as e:
        print(f"Error during transcription: {e}")
        os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def index():
    return 'We Listen & We Don\'t Judge!', 200

if __name__ == '__main__':
    app.run(debug=True)