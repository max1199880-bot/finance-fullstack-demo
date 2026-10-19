import { useState } from 'react';
import { alertDialog, confirmDialog } from '../lib/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type IncomeSourceDTO } from '../lib/api';
import { Sheet } from './Sheet';
import { EmojiPicker } from './EmojiPicker';
import { categoryEmoji } from '../lib/format';
import { haptic } from '../lib/telegram';

/**
 * Embeddable list/editor for income sources. Used both by the dedicated
 * IncomeSourceEditor page (full UX with hidden sources) and by the Budget
 * page (compact, active-only inline block).
 *
 * Props:
 *  - `showHidden` — render the "Скрытые" section with Restore / 🗑 buttons.
 *  - `compact`    — drop the "Активные" section heading and pad less. Used
 *                   when embedding inside an existing Card so the visual
 *                   hierarchy stays single-level.
 */
export function IncomeSourceList({
  showHidden = false,
  compact = false,
}: {
  showHidden?: boolean;
  compact?: boolean;
} = {}) {
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ['sources'], queryFn: api.incomeSources });
  const hidden = useQuery({
    queryKey: ['sources', 'hidden'],
    queryFn: api.hiddenIncomeSources,
    enabled: showHidden,
  });

  const [renameTarget, setRenameTarget] = useState<IncomeSourceDTO | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<IncomeSourceDTO | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const invalidateAll = async () => {
    await Promise.all([
      qc.refetchQueries({ queryKey: ['sources'] }),
      qc.refetchQueries({ queryKey: ['sources', 'hidden'] }),
      qc.refetchQueries({ queryKey: ['bootstrap'] }),
      qc.refetchQueries({ queryKey: ['txs-all'] }),
    ]);
  };

  const setEmoji = useMutation({
    mutationFn: (args: { id: string; emoji: string | null }) => api.setIncomeSourceEmoji(args.id, args.emoji),
    onSuccess: async () => {
      haptic('success');
      await invalidateAll();
      setEmojiTarget(null);
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteIncomeSource(id),
    onSuccess: async (res) => {
      haptic('warning');
      await invalidateAll();
      if (res.action === 'hidden') {
        alertDialog(
          'У источника есть связанные доходы, поэтому он скрыт. Удалить навсегда можно в Настройках → Источники дохода.',
        );
      }
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => api.setIncomeSourceActive(id, true),
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
    mutationFn: (id: string) => api.purgeIncomeSource(id),
    onSuccess: async (res) => {
      haptic('warning');
      await invalidateAll();
      alertDialog(`Источник удалён навсегда вместе с ${res.deletedTransactions} операциями.`);
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const askDelete = (s: IncomeSourceDTO) => {
    const msg = `Удалить источник «${s.name}»? Если есть связанные доходы — он будет скрыт.`;
    confirmDialog(msg).then((ok) => {
      if (ok) remove.mutate(s.id);
    });
  };

  const askRestore = (id: string, name: string) => {
    const msg = `Восстановить источник «${name}»?`;
    confirmDialog(msg).then((ok) => {
      if (ok) restore.mutate(id);
    });
  };

  const askPurge = (id: string, name: string, txCount: number) => {
    const msg =
      txCount > 0
        ? `Удалить «${name}» НАВСЕГДА вместе с ${txCount} операциями? Действие необратимо.`
        : `Удалить «${name}» навсегда?`;
    confirmDialog(msg).then((ok) => {
      if (ok) purge.mutate(id);
    });
  };

  return (
    <div>
      {!compact && (
        <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mb-1.5 px-1">
          Активные
        </div>
      )}
      <div className={compact ? 'overflow-hidden' : 'bg-ios-surface rounded-ios-lg overflow-hidden'}>
        {(active.data ?? []).length === 0 && (
          <div className="px-4 py-4 text-sm text-ios-hint">Нет источников. Создай первый ниже.</div>
        )}
        {(active.data ?? []).map((s, i, arr) => (
          <div
            key={s.id}
            className={`flex items-center gap-3 px-1 py-2.5 ${i < arr.length - 1 ? 'border-b border-ios-divider' : ''}`}
          >
            <button
              type="button"
              onClick={() => setEmojiTarget(s)}
              className="text-2xl w-10 h-10 rounded-ios bg-ios-surface2 dark:bg-black/20 flex items-center justify-center active:scale-95 shrink-0"
              aria-label="Сменить эмодзи"
            >
              {s.emoji ?? categoryEmoji(s.name)}
            </button>
            <button
              type="button"
              onClick={() => setRenameTarget(s)}
              className="flex-1 text-left font-medium text-base active:opacity-70 truncate"
            >
              {s.name}
            </button>
            <button
              type="button"
              onClick={() => askDelete(s)}
              className="text-ios-red text-sm font-medium px-2 py-1 active:opacity-60 shrink-0"
              aria-label="Удалить"
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className={`w-full ${compact ? 'mt-2.5' : 'mt-3'} bg-ios-accent text-white rounded-ios py-3 font-semibold active:opacity-90`}
      >
        ＋ Новый источник
      </button>

      {showHidden && hidden.data && hidden.data.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase text-ios-hint tracking-wider mt-6 mb-1.5 px-1">
            Скрытые
          </div>
          <div className="bg-ios-surface rounded-ios-lg overflow-hidden">
            {hidden.data.map((s, i, arr) => (
              <div
                key={s.id}
                className={`flex items-center gap-3 px-3 py-3 ${i < arr.length - 1 ? 'border-b border-ios-divider' : ''}`}
              >
                <div className="text-2xl w-10 h-10 rounded-ios bg-ios-surface2 dark:bg-black/20 flex items-center justify-center opacity-50 shrink-0">
                  {s.emoji ?? categoryEmoji(s.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-base text-ios-subtext truncate">{s.name}</div>
                  {s.txCount > 0 && (
                    <div className="text-[11px] text-ios-hint mt-0.5">связано {s.txCount} операций</div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => askRestore(s.id, s.name)}
                    className="text-ios-accent text-sm font-medium"
                  >
                    Восстановить
                  </button>
                  <button
                    type="button"
                    onClick={() => askPurge(s.id, s.name, s.txCount)}
                    className="text-ios-red text-xs font-medium"
                  >
                    🗑 Удалить навсегда
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <RenameSheet
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSuccess={async () => {
          await invalidateAll();
          setRenameTarget(null);
        }}
      />

      <EmojiPicker
        open={!!emojiTarget}
        current={emojiTarget?.emoji ?? null}
        onClose={() => setEmojiTarget(null)}
        onPick={(em) => {
          if (!emojiTarget) return;
          setEmoji.mutate({ id: emojiTarget.id, emoji: em });
        }}
        busy={setEmoji.isPending}
      />

      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={async () => {
          await invalidateAll();
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function RenameSheet({
  target,
  onClose,
  onSuccess,
}: {
  target: IncomeSourceDTO | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(target?.name ?? '');
  // Sync name when target changes
  if (target && name === '' && target.name) setName(target.name);
  const m = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('no target');
      return api.renameIncomeSource(target.id, name.trim());
    },
    onSuccess: () => {
      haptic('success');
      onSuccess();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  if (!target) return null;
  return (
    <Sheet open onClose={onClose} title={`Переименовать «${target.name}»`}>
      <div className="px-4 pb-4 pt-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="новое имя"
          className="w-full bg-ios-surface rounded-ios-lg px-4 py-3.5 text-base outline-none"
        />
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => {
              setName(target.name);
              onClose();
            }}
            className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!name.trim() || m.isPending || name.trim() === target.name}
            onClick={() => m.mutate()}
            className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CreateSheet({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const m = useMutation({
    mutationFn: () => api.createIncomeSource({ name: name.trim(), emoji }),
    onSuccess: () => {
      haptic('success');
      setName('');
      setEmoji(null);
      onSuccess();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (!open) return null;

  return (
    <>
      <Sheet open onClose={onClose} title="Новый источник">
        <div className="px-4 pb-4 pt-2 space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEmojiOpen(true)}
              className="text-3xl w-14 h-14 rounded-ios bg-ios-surface flex items-center justify-center active:scale-95"
              aria-label="Эмодзи"
            >
              {emoji ?? '💵'}
            </button>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="например, Фриланс"
              className="flex-1 bg-ios-surface rounded-ios px-4 py-3.5 text-base outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setName('');
                setEmoji(null);
                onClose();
              }}
              className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!name.trim() || m.isPending}
              onClick={() => m.mutate()}
              className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
            >
              {m.isPending ? '…' : 'Создать'}
            </button>
          </div>
        </div>
      </Sheet>
      <EmojiPicker
        open={emojiOpen}
        current={emoji}
        onClose={() => setEmojiOpen(false)}
        onPick={(em) => {
          setEmoji(em);
          setEmojiOpen(false);
        }}
      />
    </>
  );
}
