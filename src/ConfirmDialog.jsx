import React, { useEffect, useRef } from 'react';

export default function ConfirmDialog({
  titleId,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
  destructive = false,
  openerRef,
}) {
  const cancelRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  const openerToRestoreRef = useRef(null);
  const descriptionId = `${titleId}-description`;

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    openerToRestoreRef.current = openerRef?.current ?? null;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancelRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openerToRestoreRef.current?.focus();
    };
  }, [openerRef]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-xl border p-4 space-y-3 shadow-2xl"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-main)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="font-bold text-base">
          {title}
        </h3>
        <div id={descriptionId} className="space-y-2">
          {message && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {message}
            </p>
          )}
          {children}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          className="w-full font-bold py-3 rounded-xl shadow-md cursor-pointer"
          style={
            destructive
              ? {
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-main)',
                  border: '2px solid var(--border-color)',
                }
              : { backgroundColor: 'var(--primary)', color: 'var(--text-inverse)' }
          }
        >
          {confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="w-full font-bold py-3 rounded-xl border cursor-pointer"
          style={{
            backgroundColor: 'transparent',
            borderColor: 'var(--border-color)',
            color: 'var(--text-main)',
          }}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
