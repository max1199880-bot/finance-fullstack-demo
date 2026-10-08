import React from 'react';

interface State {
  error: Error | null;
}

/**
 * Global error boundary — catches any render-time crash in the App tree and
 * replaces the white screen of death with an actionable recovery UI.
 *
 * Most common cause this protects against: a stale TanStack Query persisted
 * cache in localStorage that no longer matches the current bundle's schema
 * (e.g. component reads `data.someNewField` that was undefined in the
 * old persisted payload). The "Очистить кеш" button wipes localStorage
 * entirely and reloads — a clean recovery path the user can hit without
 * uninstalling the Telegram mini-app.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to console so the user can screenshot it for the maintainer.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crashed:', error, info);
  }

  private hardReset = () => {
    try {
      // Nuke the persisted query/mutation cache. The next load starts clean.
      localStorage.removeItem('finance-bot-query-cache-v1');
    } catch {
      /* localStorage may be disabled in WebView; ignore */
    }
    // Force a full reload from server (bypass any service-worker cache too).
    try {
      window.location.reload();
    } catch {
      /* noop */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message ?? 'Неизвестная ошибка';
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--tg-theme-bg-color, #000)',
          color: 'var(--tg-theme-text-color, #fff)',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          textAlign: 'center',
          gap: '16px',
        }}
      >
        <div style={{ fontSize: '40px' }}>⚠️</div>
        <div style={{ fontSize: '17px', fontWeight: 600 }}>
          Приложение не смогло загрузиться
        </div>
        <div
          style={{
            fontSize: '13px',
            opacity: 0.7,
            maxWidth: '320px',
            lineHeight: 1.4,
          }}
        >
          Обычно это значит что в кеше браузера остался устаревший снимок данных
          от прошлой версии. Очисти кеш и приложение откроется.
        </div>
        <button
          type="button"
          onClick={this.hardReset}
          style={{
            background: 'var(--tg-theme-button-color, #2481cc)',
            color: 'var(--tg-theme-button-text-color, #fff)',
            border: 'none',
            borderRadius: '12px',
            padding: '12px 24px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          🔄 Очистить кеш и перезагрузить
        </button>
        <details style={{ fontSize: '11px', opacity: 0.5, maxWidth: '320px' }}>
          <summary style={{ cursor: 'pointer' }}>Технические детали</summary>
          <pre
            style={{
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              marginTop: '8px',
            }}
          >
            {msg}
          </pre>
        </details>
      </div>
    );
  }
}
