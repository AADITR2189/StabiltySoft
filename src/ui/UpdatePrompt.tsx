// Offline-ready and new-version notices of the installed app (service worker).
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // look for a new version every hour while the app is open
      if (reg) setInterval(() => { if (navigator.onLine) void reg.update(); }, 3600e3);
    },
    onRegisterError() { /* previews and some browsers do not allow service workers: the app still runs, without offline install */ },
  });
  if (needRefresh) {
    return (
      <div className="update-toast" role="alert">
        <span>A new version of StabilitySoft is available. Your data is kept.</span>
        <button onClick={() => updateServiceWorker(true)}>Update now</button>
        <button className="ghost" onClick={() => setNeedRefresh(false)}>Later</button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="update-toast" role="status">
        <span>✓ StabilitySoft is ready to work offline on this device.</span>
        <button className="ghost" onClick={() => setOfflineReady(false)}>OK</button>
      </div>
    );
  }
  return null;
}
