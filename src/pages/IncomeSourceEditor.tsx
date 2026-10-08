import { Header } from '../components/Header';
import { IncomeSourceList } from '../components/IncomeSourceList';

/**
 * Full-screen editor for income sources. Delegates the actual list +
 * rename/create sheets to the shared `IncomeSourceList` component so the
 * same UX can be embedded inline on the Budget page.
 *
 * `showHidden` is enabled here because this is the place users go to deal
 * with soft-deleted sources (restore / purge permanently).
 */
export function IncomeSourceEditorPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="pb-6">
      <Header
        title="Источники дохода"
        right={
          <button
            type="button"
            onClick={onBack}
            className="text-ios-accent text-base font-medium select-none-ui"
          >
            Готово
          </button>
        }
      />
      <div className="px-4">
        <IncomeSourceList showHidden />
      </div>
    </div>
  );
}
