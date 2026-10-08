import { useEffect, useState } from 'react';
import { alertDialog, confirmDialog } from '../lib/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Sheet } from './Sheet';
import { EmojiPicker } from './EmojiPicker';
import { categoryEmoji } from '../lib/format';
import { haptic } from '../lib/telegram';
import { CategoryIcon } from '../lib/iconTheme';

const MIN_EXPENSE = 6;

export interface QuickCategory {
  id: string;
  name: string;
  emoji?: string | null;
}

/**
 * Bottom-sheet wrapper for actions on a single category opened via long-press
 * in the expense picker. Three flows: action menu → confirm delete | rename
 * input. Self-contained — accepts a category, fires queries on close so the
 * picker refreshes.
 */
export function CategoryQuickEdit({
  cat,
  totalActive,
  onClose,
}: {
  cat: QuickCategory | null;
  totalActive: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<'menu' | 'rename' | 'emoji'>('menu');
  const [name, setName] = useState('');

  useEffect(() => {
    if (cat) {
      setView('menu');
      setName(cat.name);
    }
  }, [cat]);

  const rename = useMutation({
    mutationFn: () => api.renameCategory(cat!.id, name.trim()),
    onSuccess: async () => {
      haptic('success');
      await qc.invalidateQueries({ queryKey: ['cats'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const setEmoji = useMutation({
    mutationFn: (emoji: string | null) => api.setCategoryEmoji(cat!.id, emoji),
    onSuccess: async () => {
      haptic('success');
      await qc.invalidateQueries({ queryKey: ['cats'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteCategory(cat!.id),
    onSuccess: async (res) => {
      haptic('warning');
      await qc.invalidateQueries({ queryKey: ['cats'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      if (res.action === 'hidden') {
        alertDialog(
          'У категории есть операции, поэтому она скрыта (история сохранена). Восстановить можно в Настройках → Категории.',
        );
      }
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const confirmDelete = () => {
    if (totalActive <= MIN_EXPENSE) {
      alertDialog(`Должно остаться минимум ${MIN_EXPENSE} категорий расходов.`);
      return;
    }
    const message = `Удалить «${cat?.name}»? Если по категории есть операции, она будет скрыта (можно восстановить).`;
    confirmDialog(message).then((ok) => {
      if (ok) remove.mutate();
    });
  };

  if (!cat) return null;

  // Emoji picker is rendered as a separate sheet — close the menu sheet so
  // they don't stack visually.
  if (view === 'emoji') {
    return (
      <EmojiPicker
        open
        current={cat.emoji ?? categoryEmoji(cat.name)}
        busy={setEmoji.isPending}
        onPick={(e) => setEmoji.mutate(e)}
        onClose={() => setView('menu')}
      />
    );
  }

  return (
    <Sheet open onClose={onClose} title={cat.name}>
      <div className="px-4 pb-4 pt-1">
        <div className="text-center mb-4">
          <div className="text-4xl">{categoryEmoji(cat.name, cat.emoji)}</div>
        </div>

        {view === 'menu' && (
          <div className="space-y-1.5">
            <ActionRow
              icon="✏️"
              label="Переименовать"
              onClick={() => {
                setName(cat.name);
                setView('rename');
              }}
            />
            <ActionRow
              icon="😀"
              label="Сменить эмодзи"
              onClick={() => setView('emoji')}
            />
            <ActionRow icon="🗑" label="Удалить" danger onClick={confirmDelete} />
          </div>
        )}

        {view === 'rename' && (
          <div>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-ios-surface rounded-ios-lg px-4 py-3.5 text-base outline-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setView('menu')}
                className="flex-1 bg-ios-surface rounded-ios py-3 font-medium"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!name.trim() || rename.isPending}
                onClick={() => rename.mutate()}
                className="flex-[2] bg-ios-accent text-white rounded-ios py-3 font-semibold disabled:opacity-50"
              >
                {rename.isPending ? '…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Sheet for adding a brand-new expense category. Pops in from the "+ Добавить"
 * tile in the picker.
 */
export function AddCategorySheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setEmoji(null);
      setPickerOpen(false);
    }
  }, [open]);

  const m = useMutation({
    mutationFn: () =>
      api.createCategory({ name: name.trim(), type: 'expense', emoji: emoji ?? undefined }),
    onSuccess: async () => {
      haptic('success');
      await qc.invalidateQueries({ queryKey: ['cats'] });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Новая категория">
      <div className="px-4 pb-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="shrink-0 active:scale-95 transition select-none-ui"
            aria-label="Выбрать иконку"
          >
            <CategoryIcon name={name} emoji={emoji} size={52} />
          </button>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="например, Дети"
            className="flex-1 bg-ios-surface rounded-ios-lg px-4 py-3.5 text-base outline-none placeholder:text-ios-hint"
          />
        </div>
        <p className="text-[12px] text-ios-hint mt-2 px-1">
          Иконка подберётся по названию — или нажми на неё, чтобы выбрать свою.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
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

      <EmojiPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        current={emoji ?? categoryEmoji(name)}
        onPick={(e) => {
          setEmoji(e);
          setPickerOpen(false);
        }}
      />
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-ios bg-ios-surface active:bg-ios-surface2 transition select-none-ui ${danger ? 'text-ios-red' : ''}`}
    >
      <span className="text-xl">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}
