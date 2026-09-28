/* Сквозной тест трекера: реальный завершённый матч → сигнал → автостатус */
(async () => {
  const BASE = 'http://127.0.0.1:3777';
  const fin = await (await fetch(`${BASE}/api/sstats/finished?date=2026-09-27&tz=3`)).json();
  const g = fin.data.find((x) => x.homeResult != null && x.awayResult != null && x.homeResult + x.awayResult > 2.5);
  if (!g) { console.log('нет подходящего завершённого матча'); process.exit(1); }
  const match = `${g.homeTeam?.name} — ${g.awayTeam?.name}`;
  const league = g.season?.league?.name || '';
  const score = `${g.homeResult}:${g.awayResult}`;
  console.log('тестовый матч:', match, '|', league, '| счёт', score);

  const post = await fetch(`${BASE}/api/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: String(g.id), match: `Тест: ${match}`, league, market: 'Тоталы',
      key: 'tb25', pick: 'Тотал больше 2.5', odds: 1.85, confidence: 'средний', date: '2026-09-27 20:00',
    }),
  });
  console.log('POST:', post.status, JSON.stringify(await post.json()));

  await new Promise((r) => setTimeout(r, 1500));
  const list = await (await fetch(`${BASE}/api/signals`)).json();
  const sig = list.signals.find((x) => String(x.gameId) === String(g.id));
  console.log('сигнал:', sig?.pick, '| статус:', sig?.status, '| счёт:', sig?.result?.score);
  console.log('stats:', JSON.stringify(list.stats));
  const expect = (g.homeResult + g.awayResult) > 2.5 ? 'won' : 'lost';
  console.log('ожидание по счёту ' + score + ' и ТБ 2.5:', expect, '→', sig?.status === expect ? 'СОВПАЛО ✓' : 'НЕ СОВПАЛО ✗');
})();
