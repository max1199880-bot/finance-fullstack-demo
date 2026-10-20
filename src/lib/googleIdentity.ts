// Вход через Google по ID-токену (Google Identity Services, OpenID Connect).
//
// Поток:
//   1. Google рисует свою кнопку. По нажатию человек выбирает аккаунт во всплывающем окне Google.
//   2. Google отдаёт приложению ID-токен — JWT, подписанный ключом Google, с адресатом
//      (aud) = наш Client ID и с нашим одноразовым nonce внутри.
//   3. Приложение передаёт токен в Supabase Auth. Тот проверяет подпись по ключам Google,
//      адресата и nonce, затем создаёт или находит пользователя и выдаёт сессию.
//
// Почему так, а не перенаправлением с кодом: обмен кода на токены требует Client Secret,
// а здесь он не нужен вовсе — проверка опирается на подпись Google. Секрета нет ни в
// браузере, ни в репозитории, ни в настройках Supabase.

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: GsiConfig): void;
          renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
          cancel(): void;
        };
      };
    };
  }
}

type GsiConfig = {
  client_id: string;
  callback: (response: { credential?: string }) => void;
  nonce: string;
  ux_mode: 'popup';
  auto_select: false;
  itp_support: boolean;
  use_fedcm_for_button: boolean;
};

type GsiButtonOptions = {
  type: 'standard';
  theme: 'filled_black' | 'outline';
  size: 'large';
  text: 'signin_with' | 'continue_with';
  shape: 'pill' | 'rectangular';
  logo_alignment: 'center' | 'left';
  width: number;
  locale: string;
};

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise: Promise<void> | null = null;

/** Скрипт Google грузится один раз и только на экране входа. */
export function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // следующая попытка загрузит заново
      reject(new Error('Не удалось загрузить вход через Google'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Одноразовое число против повторного использования токена.
 * Google кладёт в токен хеш, Supabase получает исходное значение, хеширует и сверяет.
 * Перехваченный чужой токен с другим nonce вход не откроет.
 */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const hashed = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return { raw, hashed };
}

/**
 * Рисует кнопку Google в контейнере. `onToken` получает ID-токен и исходный nonce.
 * Возвращает функцию очистки для useEffect.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  onToken: (idToken: string, nonce: string) => void,
): Promise<() => void> {
  await loadGoogleIdentity();
  const gsi = window.google!.accounts.id;
  const nonce = await createNonce();
  gsi.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: ({ credential }) => credential && onToken(credential, nonce.raw),
    nonce: nonce.hashed,
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,
    use_fedcm_for_button: true,
  });
  gsi.renderButton(container, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'center',
    // Ширина кнопки Google задаётся числом, от 200 до 400 пикселей.
    width: Math.max(200, Math.min(400, Math.round(container.clientWidth))),
    locale: 'ru',
  });
  return () => {
    gsi.cancel();
    container.replaceChildren();
  };
}
