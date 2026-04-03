import { useState, useEffect } from 'react';

/**
 * Hook that tracks the browser's online/offline status.
 * Returns true when the browser reports it is online, false when offline.
 *
 * Note: `navigator.onLine` can be unreliable — it only detects whether the
 * browser has a network interface, not whether the server is reachable.
 * Use this as a first-pass check; combine with actual fetch errors for
 * more accurate server reachability detection.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
