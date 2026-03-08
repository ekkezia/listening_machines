import torch.nn as nn
import subprocess
import uuid
import os
import tempfile
import requests
from datetime import datetime, timezone, timedelta

from flask import Flask, request, jsonify
from flask_cors import CORS
import torch as t
import torchaudio
from torchaudio import transforms
import whisper
from supabase import create_client as create_supabase_client  # pip install supabase

# ── Supabase admin client (service role key bypasses RLS) ───────────────────
# SUPABASE_URL         = os.environ['SUPABASE_URL']          # e.g. https://xxx.supabase.co
# SUPABASE_SERVICE_KEY = os.environ['SUPABASE_SERVICE_KEY']  # Settings → API → service_role key
SUPABASE_URL="https://otlwnsunrsxmmtmmxbfs.supabase.co"
SUPABASE_SERVICE_KEY="sb_publishable__toHN6BlELOxz82MhJYFqA_q2ZJqDGC"  
supabase_admin = create_supabase_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Voice-ID model ───────────────────────────────────────────────────────────
label_map = ['kezia', 'matthew', 'others']

def convert_to_wav(input_path):
    wav_path = f"/tmp/{uuid.uuid4()}.wav"
    subprocess.run(["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", wav_path],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return wav_path

class ConvModel(nn.Module):
    def __init__(self, mel_freq_bins, time_steps, num_classes):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, kernel_size=3, padding=1)
        self.relu1 = nn.ReLU()
        self.pool1 = nn.MaxPool2d(2, 2)
        self.conv2 = nn.Conv2d(16, 32, kernel_size=3, padding=1)
        self.relu2 = nn.ReLU()
        self.pool2 = nn.MaxPool2d(2, 2)
        self.conv3 = nn.Conv2d(32, 64, kernel_size=3, padding=1)
        self.relu3 = nn.ReLU()
        self.pool3 = nn.MaxPool2d(2, 2)
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

checkpoint = t.load('../model/model_weights/audrey_model_weights_2026-03-06_01-17-48.pth', map_location='cpu')
config = checkpoint['config']
model = ConvModel(config['mel_freq_bins'], config['time_steps'], config['num_classes'])
model.load_state_dict(checkpoint['model_state_dict'], strict=False)
model.eval()

whisper_model = whisper.load_model("tiny")

# ── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app,
     resources={r"/*": {"origins": "*"}},
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "OPTIONS"],
     supports_credentials=False)

# ── Helpers ──────────────────────────────────────────────────────────────────
def preprocess_audio(audio_path, cfg):
    wav_path = convert_to_wav(audio_path)
    waveform, sr = torchaudio.load(wav_path)
    target_sr = cfg['sample_rate']
    if sr != target_sr:
        waveform = transforms.Resample(orig_freq=sr, new_freq=target_sr)(waveform)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0).unsqueeze(0)
    target_len = cfg['longest_audio_file_length']
    cur_len = waveform.shape[1]
    if cur_len < target_len:
        pad = target_len - cur_len
        waveform = t.nn.functional.pad(waveform, (pad // 2, pad - pad // 2))
    elif cur_len > target_len:
        start = (cur_len - target_len) // 2
        waveform = waveform[:, start:start + target_len]
    spec = transforms.MelSpectrogram(sample_rate=cfg['sample_rate'], n_mels=cfg['mel_freq_bins'])(waveform)
    os.remove(wav_path)
    return spec.unsqueeze(0)

def predict_class(audio_path):
    spec = preprocess_audio(audio_path, config)
    with t.no_grad():
        output = model(spec)
        predicted_class = t.argmax(output, dim=1).item()
    return label_map[predicted_class]

def transcribe_audio_url(audio_url):
    response = requests.get(audio_url)
    if response.status_code != 200:
        return None
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(response.content)
        tmp_path = tmp.name
    result = whisper_model.transcribe(tmp_path)
    os.remove(tmp_path)
    return result["text"]

def parse_iso(ts):
    """Parse ISO timestamp string → aware datetime."""
    if ts is None:
        return None
    ts = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(ts)

# ── Routes ───────────────────────────────────────────────────────────────────
@app.route('/', methods=['GET'])
def index():
    return 'We Listen & We Don\'t Judge!', 200

@app.route('/check-i-agree', methods=['OPTIONS', 'POST'])
def check_i_agree():
    if request.method == 'OPTIONS':
        return '', 200
    audio_url = request.form.get('audio_url')
    transcription = transcribe_audio_url(audio_url)
    said_i_agree = bool(transcription and "i agree" in transcription.lower())
    return jsonify({'said_i_agree': said_i_agree, 'transcription': transcription, 'audio_url': audio_url})

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

    result = whisper_model.transcribe(tmp_path)
    transcription = result["text"]
    said_i_agree = bool(transcription and "i agree" in transcription.lower())

    if not said_i_agree:
        os.remove(tmp_path)
        return jsonify({
            'error': 'User did not say "I agree". Access denied.',
            'said_i_agree': False,
            'transcription': transcription,
            'predicted_label': None,
            'unlock': False,
            'success': False,
        }), 403

    predicted_label = predict_class(tmp_path)
    unlock = predicted_label == user_id
    os.remove(tmp_path)

    return jsonify({
        'transcription': transcription,
        'predicted_label': predicted_label,
        'unlock': unlock,
        'success': True,
    }), 200

@app.route('/verify-shared-unlock', methods=['OPTIONS', 'POST'])
def verify_shared_unlock():
    """
    Called once both requester_audio_url and partner_audio_url are set.
    1. Fetch the unlock_request row from Supabase.
    2. Download both audio files from the i-agree storage bucket.
    3. Run the voice-ID model on each — predictions must match the respective user IDs.
    4. Check that agreed_at timestamps are within 5 seconds of each other.
    5. On success → mark status=unlocked in DB, delete files from storage.
    6. On failure → clear audio URLs so users can retry.
    """
    if request.method == 'OPTIONS':
        return '', 200

    body = request.get_json(silent=True) or {}
    request_id = body.get('request_id')
    if not request_id:
        return jsonify({'error': 'No request_id provided'}), 400

    # 1. Fetch unlock request
    try:
        res = supabase_admin.table('unlock_requests').select('*').eq('id', request_id).single().execute()
        unlock_req = res.data
    except Exception as e:
        return jsonify({'error': f'Could not fetch unlock request: {e}'}), 500

    if not unlock_req:
        return jsonify({'error': 'Unlock request not found'}), 404

    requester_id        = unlock_req['requester_id']
    partner_id          = unlock_req['partner_id']
    requester_audio_url = unlock_req.get('requester_audio_url')
    partner_audio_url   = unlock_req.get('partner_audio_url')
    requester_agreed_at = unlock_req.get('requester_agreed_at')
    partner_agreed_at   = unlock_req.get('partner_agreed_at')

    if not requester_audio_url or not partner_audio_url:
        return jsonify({'error': 'Both audio recordings must be uploaded before verification.'}), 400

    # 2. Timestamp check — must agree within 5 seconds of each other
    req_time = parse_iso(requester_agreed_at)
    par_time = parse_iso(partner_agreed_at)
    if req_time and par_time:
        diff_seconds = abs((req_time - par_time).total_seconds())
        if diff_seconds > 5:
            _clear_audio_urls(request_id)
            return jsonify({
                'success': False,
                'error': f'Recordings too far apart ({diff_seconds:.1f}s). Both must agree within 5 seconds.',
            }), 403

    # 3. Extract storage paths from public URLs
    # URL format: https://<project>.supabase.co/storage/v1/object/public/i-agree/<path>
    def extract_path(url):
        marker = '/object/public/i-agree/'
        idx = url.find(marker)
        return url[idx + len(marker):] if idx != -1 else url.split('/')[-1]

    requester_path = extract_path(requester_audio_url)
    partner_path   = extract_path(partner_audio_url)

    # 4. Download audio blobs from Supabase storage
    try:
        requester_bytes = supabase_admin.storage.from_('i-agree').download(requester_path)
        partner_bytes   = supabase_admin.storage.from_('i-agree').download(partner_path)
    except Exception as e:
        return jsonify({'error': f'Failed to download audio files: {e}'}), 500

    # 5. Save to temp files and run voice-ID model
    req_tmp = par_tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as f:
            f.write(requester_bytes)
            req_tmp = f.name
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as f:
            f.write(partner_bytes)
            par_tmp = f.name

        requester_predicted = predict_class(req_tmp)
        partner_predicted   = predict_class(par_tmp)
    except Exception as e:
        return jsonify({'error': f'Voice model error: {e}'}), 500
    finally:
        if req_tmp and os.path.exists(req_tmp): os.remove(req_tmp)
        if par_tmp and os.path.exists(par_tmp): os.remove(par_tmp)

    # 6. Always clean up storage after verification attempt
    try:
        supabase_admin.storage.from_('i-agree').remove([requester_path, partner_path])
    except Exception as e:
        print(f'[verify-shared-unlock] Storage cleanup warning: {e}')

    # 7. Check predictions match user IDs
    requester_match = requester_predicted == requester_id
    partner_match   = partner_predicted   == partner_id
    now_iso = datetime.now(timezone.utc).isoformat()

    if requester_match and partner_match:
        # Success → mark unlocked, clear audio URLs
        supabase_admin.table('unlock_requests').update({
            'status': 'unlocked',
            'unlocked_at': now_iso,
            'requester_audio_url': None,
            'partner_audio_url': None,
        }).eq('id', request_id).execute()

        return jsonify({
            'success': True,
            'requester_predicted': requester_predicted,
            'partner_predicted': partner_predicted,
        }), 200
    else:
        # Failure → clear audio URLs so both can retry
        _clear_audio_urls(request_id)
        errors = []
        if not requester_match:
            errors.append(f"Requester voice mismatch (expected '{requester_id}', got '{requester_predicted}')")
        if not partner_match:
            errors.append(f"Partner voice mismatch (expected '{partner_id}', got '{partner_predicted}')")

        return jsonify({
            'success': False,
            'error': '; '.join(errors),
            'requester_predicted': requester_predicted,
            'partner_predicted': partner_predicted,
        }), 403

def _clear_audio_urls(request_id):
    """Reset audio URLs so users can retry recording."""
    try:
        supabase_admin.table('unlock_requests').update({
            'requester_audio_url': None,
            'partner_audio_url': None,
            'requester_agreed_at': None,
            'partner_agreed_at': None,
        }).eq('id', request_id).execute()
    except Exception as e:
        print(f'[_clear_audio_urls] Warning: {e}')

@app.route('/transcribe', methods=['OPTIONS', 'POST'])
def transcribe():
    print("/transcribe endpoint called")
    if request.method == 'OPTIONS':
        return '', 200
    file = request.files.get('audio')
    if not file:
        return jsonify({'error': 'No audio file provided'}), 400
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(file.read())
        tmp_path = tmp.name
    try:
        result = whisper_model.transcribe(tmp_path)
        os.remove(tmp_path)
        return jsonify({'transcription': result["text"]})
    except Exception as e:
        os.remove(tmp_path)
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)