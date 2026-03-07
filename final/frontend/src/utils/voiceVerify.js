/**
 * voiceVerify.js
 *
 * Two-layer voice verification:
 *   transcribeAndMatch(phrase, timeoutMs?) — Web Speech API implementation.
 *   checkVoiceCommand(phrase) — designated entry point; check voice commands that are not dependent to user voice (no need to fetch model)
 *   swap body for your API.
 */

export const COMMANDS = ['record me', 'record for us', 'listen to me', 'listen to us', 'i agree', 'stop recording', 'stop listening', 'connect us'];

/**
 * Opens a single-use Web Speech API session and returns true if the user
 * says something that includes `phrase` (case-insensitive) within `timeoutMs`.
 */
export function transcribeAndMatch(phrase, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[voiceVerify] SpeechRecognition not supported — defaulting to false.');
      return resolve(false);
    }

    const normalized = phrase.trim().toLowerCase();
    if (!COMMANDS.includes(normalized)) {
      console.warn(`[voiceVerify] "${phrase}" is not in the supported phrases list.`);
    }

    const rec = new SR();
    rec.lang            = 'en-US';
    rec.continuous      = false;
    rec.interimResults  = false;
    rec.maxAlternatives = 3;

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { rec.abort(); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      console.warn('[voiceVerify] Timed out waiting for phrase:', phrase);
      settle(false);
    }, timeoutMs);

    rec.onresult = (event) => {
      for (let r = 0; r < event.results.length; r++) {
        for (let a = 0; a < event.results[r].length; a++) {
          const transcript = event.results[r][a].transcript.trim().toLowerCase();
          console.log('[voiceVerify] Heard:', transcript, '| Expecting:', normalized);
          if (transcript.includes(normalized)) {
            settle(true);
            return;
          }
        }
      }
      settle(false);
    };

    rec.onerror = (e) => {
      console.warn('[voiceVerify] Recognition error:', e.error);
      settle(false);
    };

    rec.onend = () => settle(false);

    try {
      rec.start();
    } catch (e) {
      console.warn('[voiceVerify] Could not start recognition:', e);
      settle(false);
    }
  });
}

/**
 * Designated verification entry point.
 * Swap the body of this function with your own API call when ready.
 */
export async function checkVoiceCommand(phrase) {
  return transcribeAndMatch(phrase);
}
