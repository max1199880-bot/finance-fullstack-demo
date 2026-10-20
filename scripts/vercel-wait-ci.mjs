// Шлюз выкладки фронтенда: Vercel собирает коммит, только если CI/CD для него зелёный.
//
// Vercel запускает этот скрипт как ignoreCommand (vercel.json) до установки зависимостей.
// Смысл кода выхода у Vercel обратный привычному:
//   exit 1 — собирать и выкладывать;
//   exit 0 — пропустить выкладку.
//
// Скрипт ждёт, пока workflow «CI/CD» для этого коммита завершится, и разрешает сборку
// только при успехе. В workflow входит и выкладка бэкенда, поэтому фронтенд выходит
// после миграций и функции. Репозиторий публичный: статус читается без токена.
// Любая неясность (нет запуска, лимит API, таймаут) — пропуск: лучше не выложить,
// чем выложить непроверенное.

const REPO = 'max1199880-bot/finance-fullstack-demo';
const WORKFLOW = 'CI/CD';
const POLL_MS = 20_000;
const TIMEOUT_MS = 20 * 60_000;

const BUILD = 1;
const SKIP = 0;

const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const env = process.env.VERCEL_ENV;

function done(code, reason) {
  console.log(`[wait-ci] ${code === BUILD ? 'выкладываем' : 'пропускаем'}: ${reason}`);
  process.exit(code);
}

if (env !== 'production' || ref !== 'main') done(SKIP, `ветка ${ref}, окружение ${env} — только main`);
if (!sha) done(SKIP, 'Vercel не передал SHA коммита');

async function latestRun() {
  const url = `https://api.github.com/repos/${REPO}/actions/runs?head_sha=${sha}&event=push&per_page=20`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vercel-wait-ci' },
  });
  if (!res.ok) {
    console.log(`[wait-ci] GitHub ответил ${res.status}, повторим`);
    return undefined;
  }
  const { workflow_runs: runs = [] } = await res.json();
  // Новейший запуск: после ручного перезапуска упавшего CI решает последний.
  return runs
    .filter((r) => r.name === WORKFLOW)
    .sort((a, b) => b.run_attempt - a.run_attempt || b.id - a.id)[0];
}

const started = Date.now();
while (Date.now() - started < TIMEOUT_MS) {
  const run = await latestRun().catch((e) => console.log(`[wait-ci] сеть: ${e.message}`));
  if (run?.status === 'completed') {
    if (run.conclusion === 'success') done(BUILD, `CI/CD зелёный (${run.html_url})`);
    done(SKIP, `CI/CD завершился как ${run.conclusion} (${run.html_url})`);
  }
  console.log(`[wait-ci] ${sha.slice(0, 7)}: CI/CD ${run ? run.status : 'ещё не запущен'}, ждём`);
  await new Promise((r) => setTimeout(r, POLL_MS));
}
done(SKIP, `CI/CD не завершился за ${TIMEOUT_MS / 60_000} мин`);
