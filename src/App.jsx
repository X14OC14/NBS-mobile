import React, { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Square, Upload, Plus, Trash2, Volume2, VolumeX, Music2, X } from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Instrument definitions (16 vanilla NBS instruments), synthesized with WebAudio
// ───────────────────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  { id: 0, name: "Harp",           color: "#c98a3e", kind: "tone",  wave: "sine",     decay: 1.1, shift: 0  },
  { id: 1, name: "Double Bass",    color: "#8a6a45", kind: "tone",  wave: "triangle", decay: 1.0, shift: -1 },
  { id: 2, name: "Bass Drum",      color: "#a8503f", kind: "kick",  decay: 0.5 },
  { id: 3, name: "Snare Drum",     color: "#b06a55", kind: "snare", decay: 0.3 },
  { id: 4, name: "Click",          color: "#7a7a76", kind: "click", decay: 0.08 },
  { id: 5, name: "Guitar",         color: "#a8813e", kind: "tone",  wave: "sawtooth", decay: 0.8, shift: 0  },
  { id: 6, name: "Flute",          color: "#6f9e8e", kind: "tone",  wave: "sine",     decay: 0.9, shift: 1  },
  { id: 7, name: "Bell",           color: "#b8a25a", kind: "tone",  wave: "sine",     decay: 1.8, shift: 2, bright: true },
  { id: 8, name: "Chime",          color: "#8ea6ac", kind: "tone",  wave: "sine",     decay: 2.2, shift: 2, bright: true },
  { id: 9, name: "Xylophone",      color: "#c9c4b8", kind: "tone",  wave: "triangle", decay: 0.4, shift: 2  },
  { id: 10, name: "Iron Xylophone",color: "#93989c", kind: "tone",  wave: "square",   decay: 0.5, shift: 0  },
  { id: 11, name: "Cow Bell",      color: "#6b6b68", kind: "tone",  wave: "square",   decay: 0.55, shift: 1, detune: true },
  { id: 12, name: "Digeridoo",     color: "#5c4a35", kind: "tone",  wave: "sawtooth", decay: 1.3, shift: -1, tremolo: true },
  { id: 13, name: "Bit",           color: "#7a9284", kind: "tone",  wave: "square",   decay: 0.3, shift: 0  },
  { id: 14, name: "Banjo",         color: "#ab8a4b", kind: "tone",  wave: "sawtooth", decay: 0.45, shift: 0  },
  { id: 15, name: "Pling",         color: "#a985a0", kind: "tone",  wave: "sine",     decay: 0.5, shift: 2  },
];
const instrumentById = (id) => INSTRUMENTS[id] || INSTRUMENTS[0];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_MIN = 0, KEY_MAX = 87; // full piano range, key -> midi = key+21
const VANILLA_MIN = 33, VANILLA_MAX = 57; // F#3..F#5, the "in range" keys NBS highlights

function keyToMidi(key) { return key + 21; }
function keyToFreq(key) { const m = keyToMidi(key); return 440 * Math.pow(2, (m - 69) / 12); }
function keyToName(key) {
  const m = keyToMidi(key);
  const name = NOTE_NAMES[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${name}${octave}`;
}

// ───────────────────────────────────────────────────────────────────────────
// .nbs binary parser (supports classic + new format, versions 0-5, best-effort)
// ───────────────────────────────────────────────────────────────────────────
function parseNBS(buffer) {
  const view = new DataView(buffer);
  let p = 0;
  const u8 = () => view.getUint8(p++);
  const i8 = () => view.getInt8(p++);
  const u16 = () => { const v = view.getUint16(p, true); p += 2; return v; };
  const i16 = () => { const v = view.getInt16(p, true); p += 2; return v; };
  const i32 = () => { const v = view.getInt32(p, true); p += 4; return v; };
  const str = () => {
    const len = i32();
    if (len < 0 || p + len > buffer.byteLength) throw new Error("Corrupt string field");
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(u8());
    return s;
  };
  const eof = () => p >= buffer.byteLength;

  const firstLen = u16();
  let version = 0, newFormat = false, songLengthOld = firstLen;
  if (firstLen === 0) {
    newFormat = true;
    version = u8();
    u8(); // vanilla instrument count, unused here
  }
  const songLength = newFormat ? u16() : songLengthOld;
  const layerCount = u16();
  const name = str();
  const author = str();
  const originalAuthor = str();
  const description = str();
  const tempo = u16() / 100;
  u8(); // auto-save
  u8(); // auto-save duration
  u8(); // time signature
  i32(); i32(); i32(); i32(); i32(); // minutes spent, clicks, blocks added/removed
  str(); // song origin file
  if (version >= 4) { u8(); u8(); u16(); } // loop, maxLoopCount, loopStartTick

  const notes = [];
  let tick = -1;
  try {
    while (!eof()) {
      const jumpTicks = i16();
      if (jumpTicks === 0) break;
      tick += jumpTicks;
      let layer = -1;
      while (!eof()) {
        const jumpLayers = i16();
        if (jumpLayers === 0) break;
        layer += jumpLayers;
        const instrument = u8();
        const key = u8();
        let velocity = 100, panning = 100, pitch = 0;
        if (version >= 4) { velocity = u8(); panning = u8(); pitch = i16(); }
        notes.push({ tick, layer, instrument, key, velocity, panning, pitch });
      }
    }
  } catch (e) { /* truncated file — keep whatever notes we got */ }

  const layers = [];
  try {
    for (let i = 0; i < layerCount && !eof(); i++) {
      const lname = str();
      if (version >= 4) u8(); // lock
      const volume = u8();
      let stereo = 100;
      if (version >= 2 && !eof()) stereo = u8();
      layers.push({ name: lname || `Layer ${i + 1}`, volume, muted: false });
    }
  } catch (e) { /* ignore trailing custom-instrument section */ }
  while (layers.length < layerCount) layers.push({ name: `Layer ${layers.length + 1}`, volume: 100, muted: false });

  return {
    version, tempo: tempo || 10, songLength, name: name || "Untitled", author, originalAuthor, description,
    layers: layers.length ? layers : [{ name: "Layer 1", volume: 100, muted: false }],
    notes,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Synth
// ───────────────────────────────────────────────────────────────────────────
function useSynth() {
  const ctxRef = useRef(null);
  const noiseBufferRef = useRef(null);
  const nodesRef = useRef([]);

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new Ctx();
      const buf = ctxRef.current.createBuffer(1, ctxRef.current.sampleRate * 1, ctxRef.current.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferRef.current = buf;
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const stopAll = useCallback(() => {
    nodesRef.current.forEach((n) => { try { n.stop(0); } catch (e) {} });
    nodesRef.current = [];
  }, []);

  const playNote = useCallback((instrumentId, key, velocity = 100, when = 0) => {
    const ctx = ensureCtx();
    const t0 = ctx.currentTime + Math.max(0, when);
    const inst = instrumentById(instrumentId);
    const gainAmt = Math.min(1, (velocity / 100) * 0.35);
    const master = ctx.createGain();
    master.gain.value = gainAmt;
    master.connect(ctx.destination);

    if (inst.kind === "kick" || inst.kind === "snare" || inst.kind === "click") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBufferRef.current;
      const filt = ctx.createBiquadFilter();
      const env = ctx.createGain();
      if (inst.kind === "kick") { filt.type = "lowpass"; filt.frequency.value = 160; }
      else if (inst.kind === "snare") { filt.type = "bandpass"; filt.frequency.value = 1800; filt.Q.value = 0.7; }
      else { filt.type = "highpass"; filt.frequency.value = 4000; }
      env.gain.setValueAtTime(1, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + inst.decay);
      src.connect(filt); filt.connect(env); env.connect(master);
      src.start(t0); src.stop(t0 + inst.decay + 0.05);
      nodesRef.current.push(src);
      if (inst.kind === "kick") {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(120, t0);
        osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
        const og = ctx.createGain();
        og.gain.setValueAtTime(1, t0);
        og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
        osc.connect(og); og.connect(master);
        osc.start(t0); osc.stop(t0 + 0.25);
        nodesRef.current.push(osc);
      }
      return;
    }

    const freq = keyToFreq(key) * Math.pow(2, inst.shift || 0);
    const osc = ctx.createOscillator();
    osc.type = inst.wave || "sine";
    osc.frequency.value = freq;
    if (inst.detune) osc.detune.value = 8;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(1, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + inst.decay);
    osc.connect(env); env.connect(master);
    if (inst.bright) {
      const osc2 = ctx.createOscillator();
      osc2.type = "sine"; osc2.frequency.value = freq * 2.01;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      osc2.connect(g2); g2.connect(env);
      osc2.start(t0); osc2.stop(t0 + inst.decay + 0.1);
      nodesRef.current.push(osc2);
    }
    if (inst.tremolo) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = freq * 0.02;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + inst.decay + 0.1);
      nodesRef.current.push(lfo);
    }
    osc.start(t0); osc.stop(t0 + inst.decay + 0.1);
    nodesRef.current.push(osc);
  }, [ensureCtx]);

  return { ensureCtx, playNote, stopAll, ctxRef };
}

// ───────────────────────────────────────────────────────────────────────────
// Main component
// ───────────────────────────────────────────────────────────────────────────
const COL_W = 26, ROW_H = 34, DEFAULT_LEN = 64;

export default function NoteBlockStudioMobile() {
  const [audioReady, setAudioReady] = useState(false);
  const [song, setSong] = useState({
    name: "New song", author: "", tempo: 10, songLength: DEFAULT_LEN,
    layers: [{ name: "Layer 1", volume: 100, muted: false }],
  });
  const [notes, setNotes] = useState([]); // {id, tick, layer, instrument, key, velocity}
  const [selectedInstrument, setSelectedInstrument] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const [lastKey, setLastKey] = useState(45);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fileError, setFileError] = useState("");
  const [toast, setToast] = useState("");

  const nextId = useRef(1);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const rafRef = useRef(null);
  const playStateRef = useRef({ startTime: 0, startTick: 0 });
  const { ensureCtx, playNote, stopAll, ctxRef } = useSynth();

  const maxTick = Math.max(song.songLength, ...notes.map((n) => n.tick + 1), DEFAULT_LEN);

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(""), 2200); return () => clearTimeout(t); }
  }, [toast]);

  const selectedNote = notes.find((n) => n.id === selectedNoteId) || null;
  const sortedNotes = [...notes].sort((a, b) => a.tick - b.tick || a.layer - b.layer);
  const noteOrder = selectedNote ? sortedNotes.findIndex((n) => n.id === selectedNote.id) + 1 : null;

  function handleEnableAudio() {
    ensureCtx();
    setAudioReady(true);
    playNote(0, 45, 60, 0);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseNBS(reader.result);
        setSong({
          name: parsed.name, author: parsed.author, tempo: parsed.tempo,
          songLength: parsed.songLength, layers: parsed.layers,
        });
        setNotes(parsed.notes.map((n) => ({ id: nextId.current++, ...n })));
        setSelectedNoteId(null);
        setPlayhead(0);
        setToast(`Loaded "${parsed.name || file.name}" — ${parsed.notes.length} notes, ${parsed.layers.length} layers`);
      } catch (err) {
        setFileError("Gagal parse file .nbs ini — mungkin format/versinya nggak didukung.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  function addLayer() {
    setSong((s) => ({ ...s, layers: [...s.layers, { name: `Layer ${s.layers.length + 1}`, volume: 100, muted: false }] }));
  }
  function removeLayer(idx) {
    setSong((s) => ({ ...s, layers: s.layers.filter((_, i) => i !== idx) }));
    setNotes((ns) => ns.filter((n) => n.layer !== idx).map((n) => (n.layer > idx ? { ...n, layer: n.layer - 1 } : n)));
  }
  function toggleMute(idx) {
    setSong((s) => ({ ...s, layers: s.layers.map((l, i) => (i === idx ? { ...l, muted: !l.muted } : l)) }));
  }

  function gridClick(e) {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const y = e.clientY - rect.top + scrollRef.current.scrollTop;
    const tick = Math.floor(x / COL_W);
    const layer = Math.floor(y / ROW_H);
    if (layer < 0 || layer >= song.layers.length || tick < 0) return;
    const existing = notes.find((n) => n.tick === tick && n.layer === layer);
    if (existing) { setSelectedNoteId(existing.id); return; }
    const id = nextId.current++;
    setNotes((ns) => [...ns, { id, tick, layer, instrument: selectedInstrument, key: lastKey, velocity: 100 }]);
    setSelectedNoteId(id);
    if (audioReady) playNote(selectedInstrument, lastKey, 100, 0);
  }

  function pianoTap(key) {
    setLastKey(key);
    if (!audioReady) { handleEnableAudio(); return; }
    if (selectedNote) {
      setNotes((ns) => ns.map((n) => (n.id === selectedNote.id ? { ...n, key } : n)));
      playNote(selectedNote.instrument, key, selectedNote.velocity, 0);
    } else {
      playNote(selectedInstrument, key, 100, 0);
    }
  }

  function deleteSelected() {
    if (!selectedNote) return;
    setNotes((ns) => ns.filter((n) => n.id !== selectedNote.id));
    setSelectedNoteId(null);
  }

  function assignInstrumentToSelected(id) {
    setSelectedInstrument(id);
    if (selectedNote) setNotes((ns) => ns.map((n) => (n.id === selectedNote.id ? { ...n, instrument: id } : n)));
  }

  function stopPlayback() {
    stopAll();
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  function playFromHere() {
    if (!audioReady) { handleEnableAudio(); }
    const ctx = ensureCtx();
    const startTick = playhead >= maxTick - 1 ? 0 : playhead;
    const startTime = ctx.currentTime + 0.08;
    playStateRef.current = { startTime, startTick };
    const ticksPerSec = song.tempo || 10;
    notes
      .filter((n) => n.tick >= startTick && !(song.layers[n.layer] && song.layers[n.layer].muted))
      .forEach((n) => {
        const when = (n.tick - startTick) / ticksPerSec + 0.08;
        playNote(n.instrument, n.key, n.velocity, when);
      });
    setIsPlaying(true);
    const tick = () => {
      const elapsed = ctx.currentTime - playStateRef.current.startTime;
      const cur = playStateRef.current.startTick + elapsed * ticksPerSec;
      if (cur >= maxTick) { setPlayhead(0); setIsPlaying(false); return; }
      setPlayhead(cur);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); stopAll(); }, [stopAll]);

  const timeStr = (t) => {
    const secs = t / (song.tempo || 10);
    const m = Math.floor(secs / 60), s = (secs % 60).toFixed(2);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(5, "0")}`;
  };

  return (
    <div className="w-full h-full min-h-screen flex flex-col" style={{ background: BG, color: TEXT, fontFamily: MONO }}>
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b" style={{ borderColor: BORDER, background: PANEL }}>
        <div className="flex items-center gap-2 min-w-0">
          <Music2 size={16} color={ACCENT} />
          <div className="min-w-0">
            <div className="text-[13px] truncate" style={{ color: TEXT }}>{song.name}</div>
            <div className="text-[10px] truncate" style={{ color: MUTED }}>
              {song.author ? `by ${song.author} · ` : ""}{(song.tempo).toFixed(2)} t/s
            </div>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current.click()}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-sm shrink-0"
          style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT }}
        >
          <Upload size={13} /> .nbs
        </button>
        <input ref={fileInputRef} type="file" accept=".nbs" onChange={handleFile} className="hidden" />
      </div>

      {fileError && (
        <div className="px-3 py-1.5 text-[11px]" style={{ background: "#2a1512", color: DANGER }}>{fileError}</div>
      )}
      {toast && (
        <div className="px-3 py-1.5 text-[11px]" style={{ background: SURFACE, color: ACCENT2 }}>{toast}</div>
      )}

      {!audioReady && (
        <button
          onClick={handleEnableAudio}
          className="mx-3 mt-2 py-2 text-[11px] rounded-sm"
          style={{ background: ACCENT, color: "#171310" }}
        >
          Tap to enable audio
        </button>
      )}

      {/* Transport */}
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: BORDER }}>
        <button onClick={isPlaying ? stopPlayback : playFromHere}
          className="flex items-center justify-center w-8 h-8 rounded-sm"
          style={{ background: ACCENT, color: "#171310" }}>
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button onClick={() => { stopPlayback(); setPlayhead(0); }}
          className="flex items-center justify-center w-8 h-8 rounded-sm"
          style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT }}>
          <Square size={13} />
        </button>
        <div className="flex-1 text-[11px] tabular-nums" style={{ color: MUTED }}>
          {timeStr(playhead)} / {timeStr(maxTick)} · tick {Math.floor(playhead)}/{maxTick}
        </div>
        <button onClick={addLayer} className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-sm"
          style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT }}>
          <Plus size={12} /> layer
        </button>
      </div>

      {/* Instrument palette */}
      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b" style={{ borderColor: BORDER }}>
        {INSTRUMENTS.map((inst) => (
          <button key={inst.id} onClick={() => assignInstrumentToSelected(inst.id)}
            className="flex flex-col items-center gap-1 px-2 py-1 rounded-sm shrink-0"
            style={{
              background: selectedInstrument === inst.id ? SURFACE : "transparent",
              border: `1px solid ${selectedInstrument === inst.id ? inst.color : BORDER}`,
            }}>
            <div style={{ width: 8, height: 8, background: inst.color, borderRadius: 1 }} />
            <span className="text-[9px] whitespace-nowrap" style={{ color: selectedInstrument === inst.id ? TEXT : MUTED }}>
              {inst.name}
            </span>
          </button>
        ))}
      </div>

      {/* Layer labels + grid */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex flex-col shrink-0" style={{ width: 88, borderRight: `1px solid ${BORDER}` }}>
          <div style={{ height: 22, borderBottom: `1px solid ${BORDER}` }} />
          {song.layers.map((l, i) => (
            <div key={i} className="flex items-center justify-between 
