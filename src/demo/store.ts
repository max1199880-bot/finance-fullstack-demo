// Хранилище демо-сервера: данные в памяти + сохранение в localStorage, чтобы добавленные
// операции переживали перезагрузку. Хранилище — только в браузере зрителя, никуда не уходит.

import { createSeed } from './seed';
import type { DemoDb } from './types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'finance-demo:db:v2';

export class DemoStore {
  private constructor(
    public db: DemoDb,
    private readonly storage: KeyValueStorage | null,
    readonly now: () => Date,
  ) {}

  static open(storage: KeyValueStorage | null, now: () => Date = () => new Date()): DemoStore {
    let db: DemoDb | null = null;
    try {
      const raw = storage?.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDb;
        if (parsed.version === 2) db = parsed;
      }
    } catch {
      // Повреждённые данные или недоступное хранилище — начинаем с исходных демо-данных.
    }
    return new DemoStore(db ?? createSeed(now()), storage, now);
  }

  nextId(prefix: string): string {
    return `${prefix}-${this.db.nextId++}`;
  }

  save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.db));
    } catch {
      // Переполнено / приватный режим — демо продолжает работать в памяти.
    }
  }

  reset(): void {
    this.db = createSeed(this.now());
    this.save();
  }
}
