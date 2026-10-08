import { useState } from 'react';
import { alertDialog, confirmDialog } from '../lib/dialog';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Header } from '../components/Header';
import { Card, ListRow } from '../components/Card';
import { Sheet } from '../components/Sheet';
import { haptic, isInsideTelegram } from '../lib/telegram';
import { signOut } from '../lib/auth';
import { useIconTheme, ICON_STYLES, ICON_THEMES, CategoryIcon } from '../lib/iconTheme';

export function SettingsPage({
  onBack,
  onOpenCategories,
  onOpenIncomeSources,
  onReplayOnboarding,
  onOpenAdmin,
}: {
  onBack?: () => void;
  onOpenCategories?: () => void;
  onOpenIncomeSources?: () => void;
  onReplayOnboarding?: () => void;
  onOpenAdmin?: () => void;
} = {}) {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: api.updateMe,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
      haptic('success');
    },
  });

  if (!me.data) return <div className="p-6 text-center text-ios-hint">Загрузка…</div>;

  return (
    <div className="pb-6">
      <Header
        title="Настройки"
        right={
          onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-ios-accent text-base font-medium select-none-ui"
            >
              Готово
            </button>
          )
        }
      />

      <Card title="Профиль">
        <ListRow left="Валюта" right={<span>{me.data.currency}</span>} divider />
        <ListRow left="Таймзона" right={<span>{me.data.timezone}</span>} divider={false} />
      </Card>

      <Card title="Месяц">
        <ListRow
          left="Начало месяца"
          right={<span className="text-ios-accent">{me.data.monthStartDay}-е число</span>}
          divider={false}
        />
        <div className="px-4 pb-3 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 28 }).map((_, i) => {
            const d = i + 1;
            const active = me.data!.monthStartDay === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => update.mutate({ monthStartDay: d })}
                className={`py-2 rounded-md text-sm font-medium transition ${
                  active ? 'bg-ios-accent text-white' : 'bg-ios-surface2 dark:bg-black/20 text-ios-subtext'
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Уведомления">
        <ListRow
          left="Напоминания о вводе"
          right={
            <button
              type="button"
              onClick={() => update.mutate({ remindersEnabled: !me.data!.remindersEnabled })}
              className={`w-12 h-7 rounded-full transition relative ${
                me.data.remindersEnabled ? 'bg-ios-green' : 'bg-ios-divider'
              }`}
              aria-pressed={me.data.remindersEnabled}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  me.data!.remindersEnabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          }
          divider={false}
        />
      </Card>

      <IconThemeCard />

      <Card title="Категории и источники">
        <ListRow
          left={<span>Категории расходов</span>}
          right={
            <button
              type="button"
              onClick={() => onOpenCategories?.()}
              className="text-ios-accent text-sm font-medium"
            >
              Открыть →
            </button>
          }
          divider
        />
        <ListRow
          left={<span>Источники дохода</span>}
          right={
            <button
              type="button"
              onClick={() => onOpenIncomeSources?.()}
              className="text-ios-accent text-sm font-medium"
            >
              Открыть →
            </button>
          }
          divider={false}
        />
      </Card>

      {me.data.isOwner && (
        <Card title="🔐 Админ">
          <ListRow
            left={
              <div>
                <span>Все пользователи и отзывы</span>
                <div className="text-xs text-ios-hint mt-0.5">видишь только ты</div>
              </div>
            }
            right={
              <button
                type="button"
                onClick={() => onOpenAdmin?.()}
                className="text-ios-accent text-sm font-medium"
              >
                Открыть →
              </button>
            }
            divider={false}
          />
        </Card>
      )}

      {/* HiddenAccountsCard moved to Analytics → "Куплено и продано".
          Users wanted the sold-assets view next to other historical data,
          not buried in Settings. Restore/purge for an accidentally-hidden
          account still works via the API; the helper here is just gone. */}
      <HiddenCategoriesCard />

      <Card title="Помощь и обратная связь">
        <ListRow
          left={<span>Показать инструкцию</span>}
          right={
            <button
              type="button"
              onClick={() => onReplayOnboarding?.()}
              className="text-ios-accent text-sm font-medium"
            >
              Пройти заново →
            </button>
          }
          divider
        />
        <FeedbackRow />
      </Card>

      <Card title="О приложении">
        <ListRow left="Версия" right={<span className="text-ios-hint">0.1.0</span>} divider={false} />
      </Card>

      {/* Logout only makes sense in the standalone PWA — inside Telegram the
          user just closes the Mini App window. */}
      {!isInsideTelegram() && <LogoutCard />}
    </div>
  );
}

// Icon appearance: first pick the VIEW (reworked icons vs plain emoji), then —
// only for icons — the THEME (solid / outline / soft). Each option previews
// itself live so the choice is obvious at a glance.
function IconThemeCard() {
  const { style, setStyle, theme, setTheme } = useIconTheme();
  return (
    <Card title="Оформление иконок">
      {/* View: icons vs emoji */}
      <div className="p-3 pb-1.5 grid grid-cols-2 gap-2">
        {ICON_STYLES.map((opt) => {
          const active = style === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                haptic('select');
                setStyle(opt.id);
              }}
              className={`flex flex-col items-center gap-1.5 rounded-ios-lg py-3 px-1 border-2 transition select-none-ui ${
                active ? 'border-ios-accent bg-ios-accentSoft' : 'border-transparent bg-ios-surface2'
              }`}
              aria-pressed={active}
            >
              <CategoryIcon keyOverride="cafe" emoji="🍽" style={opt.id} theme={theme} size={42} />
              <span className={`text-[13px] font-semibold ${active ? 'text-ios-accent' : 'text-ios-text'}`}>
                {opt.label}
              </span>
              <span className="text-[10px] text-ios-hint leading-tight text-center px-0.5">{opt.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Theme: only meaningful for the icons view */}
      {style === 'icons' && (
        <div className="px-3 pb-3 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ios-hint mb-2 px-0.5">
            Оформление значков
          </div>
          <div className="grid grid-cols-3 gap-2">
            {ICON_THEMES.map((opt) => {
              const active = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    haptic('select');
                    setTheme(opt.id);
                  }}
                  className={`flex flex-col items-center gap-1.5 rounded-ios-lg py-3 px-1 border-2 transition select-none-ui ${
                    active ? 'border-ios-accent bg-ios-accentSoft' : 'border-transparent bg-ios-surface2'
                  }`}
                  aria-pressed={active}
                >
                  <CategoryIcon keyOverride="cafe" style="icons" theme={opt.id} size={40} />
                  <span className={`text-[12px] font-semibold ${active ? 'text-ios-accent' : 'text-ios-text'}`}>
                    {opt.label}
                  </span>
                  <span className="text-[10px] text-ios-hint leading-tight text-center px-0.5">{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function LogoutCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: async () => {
      await signOut();
      return { ok: true } as const;
    },
    onSuccess: async () => {
      haptic('success');
      // eslint-disable-next-line no-console
      console.log('[logout] done');
      // Wipe cached identity-scoped data before sending the user to login.
      qc.clear();
      navigate('/login', { replace: true });
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  return (
    <Card title="Сессия">
      <ListRow
        left={<span>Выйти из аккаунта</span>}
        right={
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="text-ios-red text-sm font-medium disabled:opacity-50"
          >
            {logout.isPending ? '…' : 'Выйти'}
          </button>
        }
        divider={false}
      />
    </Card>
  );
}

function FeedbackRow() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const send = useMutation({
    mutationFn: () => api.sendFeedback(text.trim()),
    onSuccess: () => {
      haptic('success');
      setText('');
      setOpen(false);
      alertDialog('Спасибо! Сообщение отправлено автору, отвечу как только посмотрю. 🙏');
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  return (
    <>
      <ListRow
        left={
          <div>
            <span>Связь с автором</span>
            <div className="text-xs text-ios-hint mt-0.5">баг, идея, замечание</div>
          </div>
        }
        right={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-ios-accent text-sm font-medium"
          >
            Написать →
          </button>
        }
        divider={false}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="Обратная связь">
        <div className="px-4 pb-4 pt-1">
          <div className="text-sm text-ios-hint mb-2 px-1">
            Что бы ты хотел улучшить, что не работает, чего не хватает? Пиши свободно.
          </div>
          <div className="bg-ios-surface rounded-ios-lg p-3">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Например: «Хорошо бы добавить экспорт в Excel»"
              className="w-full bg-transparent outline-none resize-none text-sm placeholder:text-ios-hint"
            />
          </div>
          <div className="text-[11px] text-ios-hint mt-1.5 px-1 text-right">
            {text.length}/2000
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!text.trim() || send.isPending}
              onClick={() => send.mutate()}
              className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
            >
              {send.isPending ? '…' : 'Отправить'}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

function HiddenCategoriesCard() {
  const qc = useQueryClient();
  const hidden = useQuery({
    queryKey: ['categories', 'hidden'],
    queryFn: api.hiddenCategories,
    staleTime: 30_000,
  });
  const invalidateAll = async () => {
    await Promise.all([
      qc.refetchQueries({ queryKey: ['categories', 'hidden'] }),
      qc.refetchQueries({ queryKey: ['cats'] }),
      qc.refetchQueries({ queryKey: ['categories'] }),
      qc.refetchQueries({ queryKey: ['budget'] }),
      qc.refetchQueries({ queryKey: ['bootstrap'] }),
      qc.refetchQueries({ queryKey: ['txs-all'] }),
    ]);
  };
  const restore = useMutation({
    mutationFn: (id: string) => api.setCategoryActive(id, true),
    onSuccess: async () => {
      haptic('success');
      await invalidateAll();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  const purge = useMutation({
    mutationFn: (id: string) => api.purgeCategory(id),
    onSuccess: async (res) => {
      haptic('warning');
      await invalidateAll();
      alertDialog(
        `Категория удалена навсегда вместе с ${res.deletedTransactions} операциями.`,
      );
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (!hidden.data || hidden.data.length === 0) return null;

  const askRestore = (id: string, name: string) => {
    const msg = `Восстановить категорию «${name}»?`;
    confirmDialog(msg).then((ok) => { if (ok) restore.mutate(id); });
  };
  const askPurge = (id: string, name: string, txCount: number) => {
    const msg =
      txCount > 0
        ? `Удалить «${name}» НАВСЕГДА вместе с ${txCount} операциями? Действие необратимо.`
        : `Удалить «${name}» навсегда?`;
    confirmDialog(msg).then((ok) => { if (ok) purge.mutate(id); });
  };

  return (
    <Card title="Скрытые категории">
      {hidden.data.map((c, i) => (
        <ListRow
          key={c.id}
          divider={i !== hidden.data!.length - 1}
          left={
            <div>
              <div>
                <span className="mr-1.5">{c.emoji ?? (c.type === 'income' ? '💵' : '🛒')}</span>
                <span>{c.name}</span>
              </div>
              {c.txCount > 0 && (
                <div className="text-[11px] text-ios-hint mt-0.5">
                  связано {c.txCount} операций
                </div>
              )}
            </div>
          }
          right={
            <div className="flex flex-col items-end gap-1.5">
              <button
                type="button"
                disabled={restore.isPending || purge.isPending}
                onClick={() => askRestore(c.id, c.name)}
                className="text-ios-accent text-sm font-medium disabled:opacity-50"
              >
                Восстановить
              </button>
              <button
                type="button"
                disabled={restore.isPending || purge.isPending}
                onClick={() => askPurge(c.id, c.name, c.txCount)}
                className="text-ios-red text-xs font-medium disabled:opacity-50"
              >
                🗑 Удалить навсегда
              </button>
            </div>
          }
        />
      ))}
    </Card>
  );
}

// HiddenAccountsCard removed — moved into Analytics → "Куплено и продано"
// with full P&L breakdown. See webapp/src/pages/Analytics.tsx (SoldAssetsCard).
// The /api/accounts/hidden + restore/purge endpoints stay for now in case the
// admin tooling needs to bring an accidentally-hidden cash/bank account back.
