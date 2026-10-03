import React from 'react';

export function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl animate-in">
      <span className="flex-1">{message}</span>
      <button type="button" className="text-white/80 hover:text-white text-lg leading-none" onClick={onClose} aria-label="Fermer">
        ×
      </button>
    </div>
  );
}
