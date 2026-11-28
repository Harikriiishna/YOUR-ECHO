interface BrowserSpeechRecognitionAlternative {
  transcript?: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal?: boolean;
  0?: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognitionInstance;

export interface LiveSpeechCaptureSession {
  stop: () => string;
  stopAndWait: (timeoutMs?: number) => Promise<string>;
  cancel: () => void;
}

function getSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function describeSpeechError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied for speech recognition.';
    case 'audio-capture':
      return 'No microphone was found for speech recognition.';
    case 'network':
      return 'Speech recognition needs a network connection in this browser.';
    case 'no-speech':
      return 'No speech was detected yet. Keep speaking clearly.';
    default:
      return 'Speech recognition could not continue.';
  }
}

export function isBrowserSpeechSupported(): boolean {
  return getSpeechCtor() !== null;
}

export function startBrowserSpeechCapture(options?: {
  onInterim?: (transcript: string) => void;
  onStart?: () => void;
  onError?: (errorCode: string, message: string) => void;
  onEnd?: () => void;
}): LiveSpeechCaptureSession {
  const Ctor = getSpeechCtor();
  if (!Ctor) {
    options?.onError?.('unsupported', 'SpeechRecognition is not supported in this browser.');
    return {
      stop: () => '',
      stopAndWait: async () => '',
      cancel: () => undefined,
    };
  }

  let finalSegments: string[] = [];
  let latestInterim = '';
  let stopped = false;
  let fatalError = false;
  let ended = false;
  let waitResolvers: Array<() => void> = [];

  const resolveWaiters = () => {
    const waiters = waitResolvers;
    waitResolvers = [];
    for (const resolve of waiters) resolve();
  };

  const getCombinedText = () =>
    [...finalSegments, latestInterim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';

  recognition.onstart = () => {
    options?.onStart?.();
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const text = res?.[0]?.transcript?.trim() || '';
      if (!text) continue;
      if (res.isFinal) {
        finalSegments.push(text);
      } else {
        interim = interim ? `${interim} ${text}` : text;
      }
    }
    latestInterim = interim;
    options?.onInterim?.(getCombinedText());
  };

  recognition.onerror = (event) => {
    const code = event?.error || 'unknown';
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      fatalError = true;
    }
    if (code !== 'aborted') {
      options?.onError?.(code, describeSpeechError(code));
    }
  };

  recognition.onend = () => {
    ended = true;
    resolveWaiters();
    if (!stopped && !fatalError) {
      ended = false;
      try {
        recognition.start();
      } catch {
        options?.onEnd?.();
      }
      return;
    }
    options?.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    options?.onError?.('start-failed', 'Unable to start SpeechRecognition.');
    return {
      stop: () => '',
      stopAndWait: async () => '',
      cancel: () => undefined,
    };
  }

  return {
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // Ignore stop errors
      }
      return getCombinedText();
    },
    stopAndWait: async (timeoutMs = 280) => {
      stopped = true;
      if (!ended) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const timer = window.setTimeout(finish, timeoutMs);
          waitResolvers.push(() => {
            window.clearTimeout(timer);
            finish();
          });
          try {
            recognition.stop();
          } catch {
            window.clearTimeout(timer);
            finish();
          }
        });
      }
      return getCombinedText();
    },
    cancel: () => {
      stopped = true;
      finalSegments = [];
      latestInterim = '';
      resolveWaiters();
      try {
        recognition.abort();
      } catch {
        // Ignore abort errors
      }
    },
  };
}
