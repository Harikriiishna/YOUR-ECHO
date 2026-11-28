import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import type { EchoObject } from '../types/echo';
import { AuthMedia } from './MediaElements';

export function SharedObjectViewer({
  slug,
  onClose,
}: {
  slug: string;
  onClose: () => void;
}) {
  const [sharedObject, setSharedObject] = useState<EchoObject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSharedObject(null);
    apiRequest<{ object: EchoObject }>(`/shared/object/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (active) setSharedObject(res.object);
      })
      .catch(() => {
        if (active) setSharedObject(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <div className="min-h-screen bg-transparent text-ink flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-2xl w-full rounded-2xl border border-hairline-strong bg-surface p-6 sm:p-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink">
            <span className="w-6 h-6 rounded-lg bg-brand-gradient inline-flex items-center justify-center text-[11px] font-bold text-accent-ink shadow-sm">
              E
            </span>
            <span className="text-sky-700 dark:text-sky-300">ECHO</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-ink-secondary hover:text-ink underline underline-offset-4"
          >
            Open ECHO App
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 py-4">
            <div className="h-4 w-40 rounded bg-tint animate-pulse" />
            <div className="h-8 w-2/3 rounded bg-tint animate-pulse" />
            <div className="h-28 w-full rounded-xl bg-tint animate-pulse" />
          </div>
        ) : sharedObject ? (
          <>
            <div className="text-xs text-amber-700 dark:text-amber-300/90">
              {sharedObject.category} · {sharedObject.acquisitionDate || 'Undated heirloom'} ·{' '}
              {sharedObject.location || 'Shared story'}
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink">{sharedObject.name}</h1>

            {sharedObject.photoMediaId && (
              <AuthMedia
                mediaId={sharedObject.photoMediaId}
                alt={sharedObject.name}
                className="max-h-80"
              />
            )}
            {sharedObject.voiceMediaId && (
              <AuthMedia mediaId={sharedObject.voiceMediaId} mimeTypeHint="audio/webm" />
            )}

            {sharedObject.description && (
              <p className="text-sm text-ink-secondary">{sharedObject.description}</p>
            )}
            <p className="text-base leading-relaxed text-ink-secondary whitespace-pre-wrap">
              {sharedObject.story}
            </p>
            {sharedObject.historicalNotes && (
              <div className="rounded-xl border border-hairline bg-inset p-3.5 text-xs text-ink-muted">
                <span className="font-semibold text-ink-secondary">Historical Notes: </span>
                {sharedObject.historicalNotes}
              </div>
            )}
            <div className="pt-4 border-t border-hairline text-xs text-ink-muted">
              Current Steward: {sharedObject.currentOwner || 'Private'}
              {sharedObject.previousOwners.length > 0 &&
                ` · Previous Owners: ${sharedObject.previousOwners.join(' -> ')}`}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">
            This shared object story is either private or no longer available.
          </p>
        )}
      </div>
    </div>
  );
}
