import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Send, ShieldAlert, Volume2, VolumeX } from 'lucide-react';
import {
  FullCareStateResponse,
  recordConsentApi,
  sendVoiceCoordinatorTurn,
  synthesizeTtsAudio,
  transcribeAudioClip,
} from '../services/coordinatorApi';
import { LanguageCode, UserRole } from '../types/carebridge';

interface VoiceStudioProps {
  state: FullCareStateResponse;
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  onStateUpdated: (newState: FullCareStateResponse) => void;
  role: UserRole;
  actorName: string;
  geminiConfigured: boolean;
}

function pcmFloatToBase64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const VoiceStudio: React.FC<VoiceStudioProps> = ({
  state,
  selectedCaseId,
  onSelectCase,
  onStateUpdated,
  role,
  actorName,
  geminiConfigured,
}) => {
  const activeCase = state.cases.find((c) => c.id === selectedCaseId) || state.cases[0];
  const [language, setLanguage] = useState<LanguageCode>(activeCase?.preferredLanguage || 'kn');
  const [consentChecked, setConsentChecked] = useState<boolean>(
    activeCase?.consentGranted || false
  );
  const [utterance, setUtterance] = useState('');
  const [sending, setSending] = useState(false);
  const [recordingClip, setRecordingClip] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastAgentTrace, setLastAgentTrace] = useState<string[]>([]);

  // Refs for WebSocket & AudioWorklet/ScriptProcessor cleanup (prevents stale closures)
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (activeCase) {
      setLanguage(activeCase.preferredLanguage);
      setConsentChecked(activeCase.consentGranted);
    }
  }, [activeCase?.id, activeCase?.consentGranted, activeCase?.preferredLanguage]);

  useEffect(() => {
    return () => {
      stopLiveCall();
    };
  }, []);

  const caseTranscripts = state.transcripts.filter((t) => t.caseId === activeCase?.id);

  const playWavBase64OrFallback = async (audioBase64: string | undefined, text: string) => {
    if (!autoSpeak) return;
    if (audioBase64) {
      try {
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
        await audio.play();
        return;
      } catch {
        // Fallback to browser SpeechSynthesis if autoplay policy blocks Audio
      }
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = language === 'kn' ? 'kn-IN' : 'en-IN';
      window.speechSynthesis.speak(utter);
    }
  };

  const play24kPcmChunk = (base64Pcm: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    src.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;
  };

  const stopLiveCall = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    nextStartTimeRef.current = 0;
    setLiveConnected(false);
    setLiveConnecting(false);
  };

  const startLiveGeminiCall = async () => {
    if (!activeCase) return;
    setVoiceError(null);
    setLiveConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/api/voice/live?caseId=${encodeURIComponent(
        activeCase.id
      )}&language=${language}&role=${role}&actorName=${encodeURIComponent(actorName)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const base64 = pcmFloatToBase64(e.inputBuffer.getChannelData(0));
            ws.send(JSON.stringify({ audio: base64 }));
          }
        };
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ready') {
          setLiveConnecting(false);
          setLiveConnected(true);
        } else if (msg.type === 'audio' && msg.audio) {
          play24kPcmChunk(msg.audio);
        } else if (msg.type === 'stateUpdated' && msg.state) {
          onStateUpdated(msg.state);
          if (msg.action) {
            setLastAgentTrace((prev) => [msg.action, ...prev].slice(0, 5));
          }
        } else if (msg.type === 'error') {
          setVoiceError(msg.message || 'Gemini Live API error');
          stopLiveCall();
        }
      };

      ws.onerror = () => {
        setVoiceError(
          'WebSocket connection to Gemini Live API failed. You can use Push-to-Talk or Typed Voice Turn below.'
        );
        stopLiveCall();
      };

      ws.onclose = () => {
        setLiveConnected(false);
        setLiveConnecting(false);
      };
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? `Microphone unavailable (${err.message}). Use Push-to-Talk or sample Kannada/English utterances below.`
          : 'Microphone unavailable.'
      );
      stopLiveCall();
    }
  };

  const togglePushToTalkClip = async () => {
    setVoiceError(null);
    if (recordingClip) {
      mediaRecorderRef.current?.stop();
      setRecordingClip(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = String(reader.result || '');
          const base64 = dataUrl.split(',')[1];
          if (!base64) return;
          setSending(true);
          try {
            const { transcript } = await transcribeAudioClip({
              audioBase64: base64,
              mimeType: blob.type || 'audio/webm',
              language,
            });
            if (transcript) {
              await submitUtterance(transcript);
            } else {
              setVoiceError('No speech detected in audio clip.');
            }
          } catch (err) {
            setVoiceError(err instanceof Error ? err.message : 'Transcription failed.');
          } finally {
            setSending(false);
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingClip(true);
    } catch (err) {
      setVoiceError(
        err instanceof Error
          ? `Microphone access denied or unavailable (${err.message}). Use the text/sample voice controls.`
          : 'Microphone unavailable.'
      );
    }
  };

  const submitUtterance = async (textToSend: string) => {
    if (!activeCase || !textToSend.trim()) return;
    setVoiceError(null);
    setSending(true);
    try {
      const res = await sendVoiceCoordinatorTurn({
        caseId: activeCase.id,
        utterance: textToSend.trim(),
        language,
        grantConsentExplicitly: consentChecked,
        actorName,
        actorRole: role,
        includeTts: autoSpeak,
      });
      onStateUpdated(res.state);
      setLastAgentTrace(res.executedActions);
      setUtterance('');
      await playWavBase64OrFallback(res.audioBase64, res.replyText);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Voice turn failed.');
    } finally {
      setSending(false);
    }
  };

  const handlePlayGreeting = async () => {
    if (!activeCase) return;
    const greeting =
      language === 'kn'
        ? `ನಮಸ್ಕಾರ ${activeCase.patientName} ಅವರೇ. ನಿಮ್ಮ ವೈದ್ಯರು ಅನುಮೋದಿಸಿರುವ ತಪಾಸಣಾ ವರದಿಯ ಬಗ್ಗೆ ತಿಳಿಸಲು CareBridge AI ಕರೆ ಮಾಡಿದೆ. ಮುಂದುವರಿಯಲು ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೀರಾ?`
        : `Hello ${activeCase.patientName}. CareBridge AI is calling with clinician-approved follow-up details for your ${activeCase.screeningType}. Do you consent to proceed?`;
    try {
      const { audioBase64 } = await synthesizeTtsAudio(greeting);
      await playWavBase64OrFallback(audioBase64, greeting);
    } catch {
      await playWavBase64OrFallback(undefined, greeting);
    }
  };

  const handleDirectConsentAndAck = async () => {
    if (!activeCase) return;
    setVoiceError(null);
    setSending(true);
    try {
      const res = await recordConsentApi({
        caseId: activeCase.id,
        consentGranted: true,
        resultAcknowledged: true,
        language,
        actorName,
        actorRole: role,
      });
      onStateUpdated(res.state);
      setLastAgentTrace(['PatientVoiceAgent: Recorded Consent & Result Acknowledgement']);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Failed to record consent.');
    } finally {
      setSending(false);
    }
  };

  const samplePrompts =
    language === 'kn'
      ? [
          {
            label: 'Consent & Acknowledge (ಕನ್ನಡ)',
            text: 'ಹೌದು, ನಾನು ಒಪ್ಪಿಗೆ ನೀಡುತ್ತೇನೆ ಮತ್ತು ನನ್ನ ತಪಾಸಣಾ ವರದಿಯ ಮಾಹಿತಿಯನ್ನು ಅರ್ಥಮಾಡಿಕೊಂಡಿದ್ದೇನೆ.',
          },
          {
            label: 'Book Consultation (ಕನ್ನಡ)',
            text: 'ನನಗೆ ನವೆಂಬರ್ 23 ರಂದು ಬೆಳಿಗ್ಗೆ 10:30 ಕ್ಕೆ ಆಸ್ಪತ್ರೆಯಲ್ಲಿ ವೈದ್ಯರ ಭೇಟಿ ಬೇಕು.',
          },
          {
            label: 'Test Clinical Guardrail (ಕನ್ನಡ)',
            text: 'ನನಗೆ ರೋಗ ಇದೆಯಾ? ಯಾವ ಔಷಧಿ ಮತ್ತು ಮಾತ್ರೆ ತೆಗೆದುಕೊಳ್ಳಬೇಕು?',
          },
        ]
      : [
          {
            label: 'Consent & Acknowledge',
            text: 'Yes, I give my consent and I acknowledge receiving my clinician-approved screening summary.',
          },
          {
            label: 'Request Telehealth Visit',
            text: 'Please schedule a telehealth doctor consultation for 2026-11-23 at 11:00 AM IST.',
          },
          {
            label: 'Test Clinical Safety Guardrail',
            text: 'Do I have diabetes? What medicine and dosage should I start taking?',
          },
        ];

  if (!activeCase) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
        Create a patient case via Result Intake first to begin voice coordination.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      {/* Left Panel: Patient Context, Language, Consent & Live Microphone */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="border-b border-slate-100 pb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Agent 2: Bilingual Voice Console
            </h2>
            <button
              type="button"
              onClick={() => setAutoSpeak((v) => !v)}
              aria-label={autoSpeak ? 'Mute AI spoken output' : 'Enable AI spoken output'}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {autoSpeak ? <Volume2 className="w-4 h-4 text-teal-700" /> : <VolumeX className="w-4 h-4" />}
              <span>{autoSpeak ? 'Speech On' : 'Muted'}</span>
            </button>
          </div>

          <div>
            <label htmlFor="voice-case-select" className="block text-xs font-medium text-slate-600 mb-1">
              Active Patient Case
            </label>
            <select
              id="voice-case-select"
              value={activeCase.id}
              onChange={(e) => onSelectCase(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
            >
              {state.cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.patientName} ({c.patientCode}) — {c.screeningType}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-600 mb-1.5">Voice Language</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setLanguage('kn')}
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                  language === 'kn' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                ಕನ್ನಡ (Kannada)
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                  language === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>

        {/* Consent & Approved Summary */}
        <div className="space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-teal-700 rounded border-slate-300"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              Patient verbal consent confirmed for AI voice coordination & shared record updates.
            </span>
          </label>

          <div className="p-3.5 bg-slate-50 rounded-lg space-y-1">
            <p className="text-xs font-semibold text-slate-700">Clinician-Approved Script</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              {activeCase.clinicianApprovedSummary || activeCase.clinicianProtocol}
            </p>
          </div>
        </div>

        {/* Microphone Controls */}
        <div className="space-y-2.5 pt-2 border-t border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {liveConnected ? (
              <button
                type="button"
                onClick={stopLiveCall}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Live Voice</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startLiveGeminiCall}
                disabled={liveConnecting || !geminiConfigured}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                <span>{liveConnecting ? 'Connecting...' : 'Start Gemini Live Call'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={togglePushToTalkClip}
              disabled={sending || !geminiConfigured}
              className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-lg border transition-colors ${
                recordingClip
                  ? 'bg-red-50 text-red-700 border-red-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              } disabled:opacity-50`}
            >
              {recordingClip ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>{recordingClip ? 'Stop & Transcribe' : 'Push-to-Talk Mic'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handlePlayGreeting}
            className="w-full py-2 px-3 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
          >
            Play Spoken Bilingual Greeting ({language === 'kn' ? 'ಕನ್ನಡ' : 'English'})
          </button>

          <button
            type="button"
            disabled={sending || (activeCase.consentGranted && activeCase.resultAcknowledged)}
            onClick={handleDirectConsentAndAck}
            className="w-full py-2 px-3 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-45 rounded-lg transition-colors"
          >
            {activeCase.consentGranted && activeCase.resultAcknowledged
              ? 'Consent & Result Acknowledged'
              : 'Record Verbal Consent & Acknowledge'}
          </button>

          {!geminiConfigured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              GEMINI_API_KEY is not configured in Secrets. Configure it to enable live Gemini voice
              responses and TTS.
            </p>
          )}

          {voiceError && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{voiceError}</span>
            </div>
          )}
        </div>
      </section>

      {/* Right 2 Columns: Live Conversation Transcript & Coordinator Action Input */}
      <section className="xl:col-span-2 bg-white border border-slate-200 rounded-xl flex flex-col min-h-[560px]">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Live Conversation Transcript & Coordinator Trace
            </h2>
            <p className="text-xs text-slate-500">
              {activeCase.patientName} · Consent:{' '}
              {activeCase.consentGranted ? 'Granted' : 'Pending'} · Result:{' '}
              {activeCase.resultAcknowledged ? 'Acknowledged' : 'Pending'}
            </p>
          </div>

          {liveConnected && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live Audio Stream Active</span>
            </div>
          )}
        </div>

        {/* Transcript History */}
        <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[420px]">
          {caseTranscripts.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-sm font-medium text-slate-700">No conversation turns recorded yet.</p>
              <p className="text-xs text-slate-500">
                Use the microphone, play the greeting, or pick a Kannada/English test utterance below.
              </p>
            </div>
          ) : (
            caseTranscripts.map((turn) => {
              const isPatient = turn.speaker === 'patient';
              return (
                <div
                  key={turn.id}
                  className={`flex flex-col ${isPatient ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-xl rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      isPatient
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-900'
                    }`}
                  >
                    <p>{turn.text}</p>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <span>{isPatient ? activeCase.patientName : 'CareBridge Voice Agent'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{turn.language === 'kn' ? 'Kannada' : 'English'}</span>
                    {turn.agentAction && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-teal-700 font-medium">{turn.agentAction}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Coordinator Action Execution Banner */}
        {lastAgentTrace.length > 0 && (
          <div className="mx-5 mb-3 px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-800">
            <span className="font-semibold">Central Coordinator Executed:</span>{' '}
            {lastAgentTrace.join(' · ')}
          </div>
        )}

        {/* Quick Utterance Prompts + Text Input */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50 space-y-3 rounded-b-xl">
          <div className="flex flex-wrap gap-2">
            {samplePrompts.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={sending}
                onClick={() => submitUtterance(p.text)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitUtterance(utterance);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Speak or type patient utterance"
              placeholder={
                language === 'kn'
                  ? 'ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಸಂದೇಶವನ್ನು ನಮೂದಿಸಿ...'
                  : 'Type or speak patient response in English or Kannada...'
              }
              value={utterance}
              onChange={(e) => setUtterance(e.target.value)}
              className="flex-1 px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-700"
            />
            <button
              type="submit"
              disabled={sending || !utterance.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>{sending ? 'Coordinating...' : 'Send Voice Turn'}</span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};
