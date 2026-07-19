// SPEAKER — shared wrapp-kit element for ON-DEVICE speech. Wraps relay.speak() (local TTS: a local
// engine or the OS voice — no cloud, no connector, no credits) into a tiny queue+player any wrapp
// can call to give Claude a voice. Prompt-free and daemon-light: the ONLY platform call is
// relay.speak, which returns a playable data: URL. Falls back silently (returns false) when the
// user has no local TTS, so callers degrade to text.
//
//   const say = mountSpeaker(relay);         // relay from the connect chip
//   await say.speak("hey, it's Maya");        // resolves true if spoken, false if no local TTS
//   say.stop();                               // cut playback
//   say.destroy();

export function mountSpeaker(relay, opts = {}) {
  let audio = null;
  let available = null; // lazily probed: null unknown, true/false once known
  const voice = opts.voice;

  function stop() { if (audio) { try { audio.pause(); } catch { /* gone */ } audio = null; } }

  async function speak(text) {
    text = String(text || "").trim();
    if (!text || !relay || available === false) return false;
    let clip = null;
    try { clip = await relay.speak(text, voice ? { voice } : undefined); } catch { clip = null; }
    if (!clip || !clip.audio) { available = false; return false; }
    available = true;
    stop();
    return await new Promise((resolve) => {
      audio = new Audio(clip.audio);
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
      audio.play().catch(() => resolve(false));
    });
  }

  return {
    speak,
    stop,
    /** true/false/null(unknown-until-first-speak) — lets a wrapp hide a voice toggle when absent. */
    get available() { return available; },
    destroy() { stop(); },
  };
}
