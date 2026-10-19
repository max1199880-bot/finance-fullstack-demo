// Линтер фронтенда и тестов. Код Edge Function проверяет `deno lint` — у Deno свои
// глобальные объекты и импорты по URL, общий конфиг дал бы там ложные ошибки.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'supabase/functions', '.tmp-seed', 'coverage', 'public'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Отладочный вывод в консоль — только осознанно (warn/error разрешены): в консоли
      // браузера его видит любой, а в финансовом приложении туда легко попадают суммы.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Переменная с подчёркиванием — намеренно неиспользуемая (аргумент колбэка и т. п.).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // «x ?? fail(404)» — принятый в демо-сервере способ проверить и прервать.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true }],
      // Неразрывные пробелы в регулярках и строках нужны намеренно: так форматируются суммы.
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  // Последним: отключает правила оформления, которые конфликтуют с Prettier.
  prettier,
);
