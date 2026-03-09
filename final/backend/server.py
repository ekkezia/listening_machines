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
from supabase import create_client as create_supabase_client

# ── Supabase admin client (service role key bypasses RLS) ───────────────────
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

def parse_iso(ts):
    if ts is None:
        return None
    ts = ts.replace('Z', '+00:00')
    return datetime.fromisoformat(ts)

def _mark_verification_failed(request_id, requester_id=None, partner_id=None):
    """Set status=verification_failed and clear user pointers + timestamps."""
    try:
        supabase_admin.table('unlock_requests').update({
            'status': 'verification_failed',
            'requester_agreed_at': None,
            'partner_agreed_at': None,
            'requester_recording_started_at': None,
            'partner_recording_started_at': None,
            'requester_verified': False,
            'partner_verified': False,
        }).eq('id', request_id).execute()
    except Exception as e:
        print(f'[_mark_verification_failed] Warning: {e}')
    for uid in [requester_id, partner_id]:
        if uid:
            try:
                supabase_admin.table('users').update({
                    'active_unlock_request_id': None,
                }).eq('id', uid).execute()
            except Exception as e:
                print(f'[_mark_verification_failed] Warning clearing pointer for {uid}: {e}')

# ── Routes ───────────────────────────────────────────────────────────────────
@app.route('/', methods=['GET'])
def index():
    return "We Listen & We Don't Judge!", 200


@app.route('/verify-me', methods=['OPTIONS', 'POST'])
def verify_me():
    """
    Each user calls this independently with their own 'I agree' recording.
    Steps:
      1. Transcribe audio — must contain 'I agree'.
      2. Run voice-ID model — predicted label must match user_id.
    Returns success/failure. The CLIENT then writes verified=true + agreed_at to the DB.
    No storage bucket involved — audio only lives in memory for the duration of this call.
    """
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

    try:
        # 1. Transcribe — must say "I agree"
        result = whisper_model.transcribe(tmp_path)
        transcription = result["text"]
        said_i_agree = bool(transcription and "i agree" in transcription.lower())

        if not said_i_agree:
            return jsonify({
                'success': False,
                'error': 'Did not detect "I agree" in the recording.',
                'transcription': transcription,
            }), 200

        # 2. Voice-ID — predicted label must match user_id
        predicted_label = predict_class(tmp_path)
        voice_match = predicted_label == user_id

        if not voice_match:
            return jsonify({
                'success': True, # technically the verification process succeeded — we just didn't get a match. Client can use this info to decide how to proceed (e.g. allow retry, show warning, etc.)
                'error': 'Voice did not match the registered profile.',
                'transcription': transcription,
                'predicted_label': predicted_label,
            }), 200

        return jsonify({
            'success': True,
            'transcription': transcription,
            'predicted_label': predicted_label,
        }), 200

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route('/verify-shared-unlock', methods=['OPTIONS', 'POST'])
def verify_shared_unlock():
    """
    Called by whoever finishes verifying last (i.e. when both requester_verified
    AND partner_verified are true in the DB).

    This endpoint does NOT run voice-ID — each user already verified themselves
    individually via /verify-me. This only checks consent TIMING:
    both users' agreed_at timestamps must be within TIMING_WINDOW_SECONDS.

    On success  → status='unlocked', clears active_unlock_request_id on both users.
    On failure  → status='verification_failed', clears pointers + resets verified flags.
    """
    TIMING_WINDOW_SECONDS = 30  # generous; tighten in production

    if request.method == 'OPTIONS':
        return '', 200

    body = request.get_json(silent=True) or {}
    request_id = body.get('request_id')
    if not request_id:
        return jsonify({'error': 'No request_id provided'}), 400

    # Fetch the unlock request row
    try:
        res = supabase_admin.table('unlock_requests').select('*').eq('id', request_id).single().execute()
        unlock_req = res.data
    except Exception as e:
        return jsonify({'error': f'Could not fetch unlock request: {e}'}), 500

    if not unlock_req:
        return jsonify({'error': 'Unlock request not found'}), 404

    requester_id  = unlock_req['requester_id']
    partner_id    = unlock_req['partner_id']
    req_verified  = unlock_req.get('requester_verified', False)
    par_verified  = unlock_req.get('partner_verified', False)
    req_agreed_at = unlock_req.get('requester_agreed_at')
    par_agreed_at = unlock_req.get('partner_agreed_at')

    # Safety check — both must be individually verified
    if not req_verified or not par_verified:
        return jsonify({
            'success': False,
            'error': 'Both users must complete individual voice verification first.',
        }), 400

    # Timing check
    req_time = parse_iso(req_agreed_at)
    par_time = parse_iso(par_agreed_at)

    if req_time and par_time:
        diff_seconds = abs((req_time - par_time).total_seconds())
        if diff_seconds > TIMING_WINDOW_SECONDS:
            _mark_verification_failed(request_id, requester_id, partner_id)
            return jsonify({
                'success': False,
                'error': (
                    f'Consent too far apart ({diff_seconds:.0f}s). '
                    f'Both users must agree within {TIMING_WINDOW_SECONDS}s of each other.'
                ),
            }), 200

    # All checks passed — mark unlocked
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        supabase_admin.table('unlock_requests').update({
            'status': 'unlocked',
            'unlocked_at': now_iso,
        }).eq('id', request_id).execute()

        for uid in [requester_id, partner_id]:
            supabase_admin.table('users').update({
                'active_unlock_request_id': None,
            }).eq('id', uid).execute()

    except Exception as e:
        return jsonify({'error': f'Failed to mark unlocked: {e}'}), 500

    return jsonify({'success': True}), 200


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