import { useEffect, useState } from 'react';
import { alertDialog, confirmDialog } from '../lib/dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Header } from '../components/Header';
import { Sheet } from '../components/Sheet';
import { EmojiPicker } from '../components/EmojiPicker';
import { categoryEmoji } from '../lib/format';
import { haptic } from '../lib/telegram';
import { loadFailure } from '../lib/queryState';
import { LoadError } from '../components/LoadError';

const MIN_EXPENSE = 6;
const MAX_EXPENSE = 12;

interface CatRow {
  id: string;
  name: string;
  type: 'expense' | 'income';
  isActive: boolean;
  order: number;
  emoji?: string | null;
}

export function CategoryEditorPage({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ['categories', 'all'], queryFn: api.allCategories });

  // Local copy of expense categories for optimistic reordering.
  const [expenses, setExpenses] = useState<CatRow[]>([]);
  const [renameTarget, setRenameTarget] = useState<CatRow | null>(null);
  const [emojiTarget, setEmojiTarget] = useState<CatRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (all.data) {
      setExpenses(
        [...all.data]
          .filter((c) => c.type === 'expense' && c.isActive)
          .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      );
    }
  }, [all.data]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderCategories(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= expenses.length) return;
    haptic('select');
    const next = [...expenses];
    [next[idx], next[target]] = [next[target], next[idx]];
    setExpenses(next);
    reorder.mutate(next.map((c) => c.id));
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: async (res) => {
      haptic('warning');
      await qc.invalidateQueries({ queryKey: ['categories'] });
      await qc.invalidateQueries({ queryKey: ['cats'] });
      if (res.action === 'hidden') {
        alertDialog(
          'У категории есть операции, поэтому она скрыта (история сохранена). Можно восстановить, создав снова с тем же именем.',
        );
      }
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  const confirmDelete = (cat: CatRow) => {
    if (expenses.length <= MIN_EXPENSE) {
      alertDialog(`Должно остаться минимум ${MIN_EXPENSE} категорий расходов`);
      return;
    }
    const message = `Удалить «${cat.name}»? Если по категории есть операции, она будет скрыта.`;
    confirmDialog(message).then((ok) => {
      if (ok) remove.mutate(cat.id);
    });
  };

  if (!all.data) {
    return (
      <div className="pb-6">
        <Header title="Категории" right={<HeaderBack onClick={onBack} />} />
        {loadFailure(all) ? (
          <LoadError query={all} compact />
        ) : (
          <div className="px-4 mt-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-ios-surface rounded-ios-lg animate-pulse" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const canAdd = expenses.length < MAX_EXPENSE;

  return (
    <div className="pb-10">
      <Header
        title="Категории расходов"
        subtitle={`${expenses.length} активных · ${MIN_EXPENSE}–${MAX_EXPENSE}`}
        right={<HeaderBack onClick={onBack} />}
      />

      <div className="px-4 mt-2">
        <div className="bg-ios-surface rounded-ios-lg overflow-hidden">
          {expenses.map((c, idx) => (
            <div
              key={c.id}
              className="flex items-center px-2 py-2.5 border-b border-ios-divider last:border-b-0"
            >
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="w-8 h-8 flex items-center justify-center text-lg disabled:opacity-25 active:bg-ios-surface2 rounded-md"
                aria-label="Выше"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(idx, +1)}
                disabled={idx === expenses.length - 1}
                className="w-8 h-8 flex items-center justify-center text-lg disabled:opacity-25 active:bg-ios-surface2 rounded-md"
                aria-label="Ниже"
              >
                ↓
              </button>

              <button
                type="button"
                onClick={() => setEmojiTarget(c)}
                className="w-9 h-9 flex items-center justify-center text-2xl active:bg-ios-surface2 rounded-md"
                aria-label="Сменить эмодзи"
              >
                {categoryEmoji(c.name, c.emoji)}
              </button>

              <button
                type="button"
                onClick={() => setRenameTarget(c)}
                className="flex-1 min-w-0 px-2 py-1 text-left active:bg-ios-surface2 rounded-md"
              >
                <span className="font-medium truncate">{c.name}</span>
              </button>

              <button
                type="button"
                onClick={() => confirmDelete(c)}
                className="w-8 h-8 flex items-center justify-center text-ios-red active:bg-ios-red/10 rounded-md"
                aria-label="Удалить"
              >
                🗑
              </button>
            </div>
          ))}
        </div>

        {canAdd ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full mt-3 bg-ios-accent text-white rounded-ios py-3 font-semibold active:opacity-90"
          >
            ＋ Добавить категорию
          </button>
        ) : (
          <div className="text-center text-xs text-ios-hint mt-3 px-4 leading-snug">
            Достигнут максимум {MAX_EXPENSE} категорий. Удалите ненужную чтобы добавить новую.
          </div>
        )}
      </div>

      <RenameSheet cat={renameTarget} onClose={() => setRenameTarget(null)} />
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <EmojiSheet cat={emojiTarget} onClose={() => setEmojiTarget(null)} />
    </div>
  );
}

function EmojiSheet({ cat, onClose }: { cat: CatRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (emoji: string | null) => api.setCategoryEmoji(cat!.id, emoji),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['cats'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });
  if (!cat) return null;
  return (
    <EmojiPicker
      open
      current={cat.emoji ?? categoryEmoji(cat.name)}
      busy={m.isPending}
      onPick={(e) => m.mutate(e)}
      onClose={onClose}
    />
  );
}

function HeaderBack({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-ios-accent text-base font-medium select-none-ui">
      Готово
    </button>
  );
}

function RenameSheet({ cat, onClose }: { cat: CatRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');

  useEffect(() => {
    if (cat) setName(cat.name);
  }, [cat]);

  const m = useMutation({
    mutationFn: () => {
      if (!cat) throw new Error('no cat');
      return api.renameCategory(cat.id, name.trim());
    },
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['cats'] });
      onClose();
    },
    onError: (e) => {
      haptic('error');
      alertDialog((e as Error).message);
    },
  });

  if (!cat) return null;
  return (
    <Sheet open onClose={onClose} title={`Переименовать «${cat.name}»`}>
      <div className="px-4 pb-4 pt-1">
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
            Сохранить
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  const m = useMutation({
    mutationFn: () => api.createCategory({ name: name.trim(), type: 'expense' }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['cats'] });
      setName('');
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
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="например, Дети"
          className="w-full bg-ios-surface rounded-ios-lg px-4 py-3.5 text-base outline-none placeholder:text-ios-hint"
        />
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
            Создать
          </button>
        </div>
      </div>
    </Sheet>
  );
}
