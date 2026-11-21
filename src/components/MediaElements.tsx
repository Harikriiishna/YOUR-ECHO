import React, { useEffect, useRef, useState } from 'react';
import { FileAudio, ImageIcon, Mic, Square, Upload, Volume2 } from 'lucide-react';
import { apiRequest, fetchProtectedMediaObjectUrl, uploadMediaFile } from '../lib/api';
import type { MediaMeta } from '../types/echo';

export function SafeImage({
  src,
  alt,
  className = '',
  fallbackTitle,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#131E36] to-[#1E1B4B] text-slate-400 p-6 ${className}`}
      >
        <ImageIcon className="w-7 h-7 mb-2 text-sky-400/70" />
        {fallbackTitle && <span className="text-xs text-center text-slate-300">{fallbackTitle}</span>}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function AuthMedia({
  mediaId,
  mimeTypeHint,
  alt = 'Uploaded media',
  className = '',
}: {
  mediaId: string;
  mimeTypeHint?: string;
  alt?: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState(mimeTypeHint || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setError(null);
    fetchProtectedMediaObjectUrl(mediaId)
      .then((res) => {
        if (!active) {
          URL.revokeObjectURL(res.url);
          return;
        }
        createdUrl = res.url;
        setObjectUrl(res.url);
        setMimeType(mimeTypeHint || res.mimeType);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load media');
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [mediaId, mimeTypeHint]);

  if (error) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0B1221] p-4 text-xs text-slate-400">
        {error}
      </div>
    );
  }

  if (!objectUrl) {
    return <div className="h-32 rounded-xl bg-white/[0.04] animate-pulse" />;
  }

  if (mimeType.startsWith('audio/')) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border border-white/10 bg-[#0B1221] px-4 py-3 ${className}`}>
        <Volume2 className="w-4 h-4 text-sky-400 shrink-0" />
        <audio controls src={objectUrl} className="w-full h-8" />
      </div>
    );
  }

  if (mimeType.startsWith('video/')) {
    return (
      <video controls src={objectUrl} className={`w-full rounded-xl bg-black max-h-80 ${className}`} />
    );
  }

  return <img src={objectUrl} alt={alt} className={`w-full object-cover rounded-xl ${className}`} />;
}

export function VoiceRecorder({
  contextType,
  onUploaded,
  onTranscribed,
}: {
  contextType: string;
  onUploaded: (media: MediaMeta) => void;
  onTranscribed?: (transcript: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) window.clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) return;

        setUploading(true);
        try {
          const uploaded = await uploadMediaFile(blob, `voice-${Date.now()}.webm`, contextType);
          onUploaded(uploaded);
          if (onTranscribed) {
            setTranscribing(true);
            try {
              const tr = await apiRequest<{ transcript: string }>('/ai/transcribe', {
                method: 'POST',
                body: JSON.stringify({ mediaId: uploaded.id }),
              });
              if (tr.transcript) onTranscribed(tr.transcript);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Transcription failed, audio saved.');
            } finally {
              setTranscribing(false);
            }
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload voice note.');
        } finally {
          setUploading(false);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError('Microphone permission is unavailable. You can still upload an audio file.');
    }
  };

  const stopRecording = () => {
    setRecording(false);
    recorderRef.current?.stop();
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadMediaFile(file, file.name, contextType);
      onUploaded(uploaded);
      if (onTranscribed) {
        setTranscribing(true);
        try {
          const tr = await apiRequest<{ transcript: string }>('/ai/transcribe', {
            method: 'POST',
            body: JSON.stringify({ mediaId: uploaded.id }),
          });
          if (tr.transcript) onTranscribed(tr.transcript);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Audio saved; transcription unavailable.');
        } finally {
          setTranscribing(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload audio.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={uploading || transcribing}
            className="touch-manipulation inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Mic className="w-4 h-4" />
            Record Voice
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="touch-manipulation inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/20 px-3.5 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/30 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop ({mm}:{ss})
          </button>
        )}

        <label className="touch-manipulation inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.08] cursor-pointer transition-colors whitespace-nowrap shrink-0 min-h-[40px]">
          <FileAudio className="w-4 h-4 text-violet-300" />
          Upload Audio
          <input type="file" accept="audio/*" onChange={handleAudioFile} className="hidden" />
        </label>

        {uploading && <span className="text-xs text-sky-300">Uploading audio...</span>}
        {transcribing && <span className="text-xs text-violet-300">Transcribing with ECHO AI...</span>}
      </div>
      {error && <p className="text-xs text-amber-300">{error}</p>}
    </div>
  );
}

export function MediaPicker({
  contextType,
  accept = 'image/*,video/*,audio/*',
  label = 'Attach Photo / Video / Audio',
  onUploaded,
}: {
  contextType: string;
  accept?: string;
  label?: string;
  onUploaded: (media: MediaMeta) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setError(null);
    for (const file of files) {
      setProgress(0);
      try {
        const uploaded = await uploadMediaFile(file, file.name, contextType, (pct) => setProgress(pct));
        onUploaded(uploaded);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setProgress(null);
      }
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-1.5">
      <label className="touch-manipulation inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer transition-colors whitespace-nowrap shrink-0 min-h-[40px]">
        <Upload className="w-4 h-4 text-sky-400" />
        {progress !== null ? `Uploading ${progress}%` : label}
        <input type="file" accept={accept} multiple onChange={onChange} className="hidden" />
      </label>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
