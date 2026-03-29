'use client';

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        .then(() => {
          console.log('Service Worker registrato');
        })
        .catch((err) => {
          console.error('Errore registrazione Service Worker:', err);
        });
    }
  }, []);

  return null;
}