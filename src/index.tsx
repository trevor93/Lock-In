import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

const DOWS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function dowOf(dateStr: string): string {
  return DOWS[new Date(dateStr + 'T12:00:00Z').getUTCDay()]
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function blocksForDate(DB: D1Database, date: string) {
  const dow = dowOf(date)
  const { results } = await DB.prepare(
    `SELECT b.*, l.status as log_status, l.note as log_note, l.completed_at
     FROM schedule_blocks b
     LEFT JOIN block_logs l ON l.block_id = b.id AND l.log_date = ?
     WHERE (',' || b.days || ',') LIKE ?
     ORDER BY b.start_time, b.sort_order`
  ).bind(date, `%,${dow},%`).all()
  return results as any[]
}

function dayAdherence(blocks: any[]) {
  if (!blocks.length) return { pct: 100, done: 0, total: 0 }
  let score = 0
  for (const b of blocks) {
    if (b.log_status === 'done') score += 1
    else if (b.log_status === 'partial') score += 0.5
  }
  return { pct: Math.round((score / blocks.length) * 100), done: score, total: blocks.length }
}

async function flagExists(DB: D1Database, date: string, type: string, msgLike?: string) {
  const q = msgLike
    ? DB.prepare(`SELECT id FROM honesty_flags WHERE flag_date=? AND flag_type=? AND message LIKE ?`).bind(date, type, `%${msgLike}%`)
    : DB.prepare(`SELECT id FROM honesty_flags WHERE flag_date=? AND flag_type=?`).bind(date, type)
  return !!(await q.first())
}

async function addFlag(DB: D1Database, date: string, type: string, severity: string, message: string, penalty: number) {
  await DB.prepare(`INSERT INTO honesty_flags (flag_date, flag_type, severity, message) VALUES (?,?,?,?)`)
    .bind(date, type, severity, message).run()
  if (penalty !== 0) {
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(date, penalty, message, 'flag').run()
  }
}

// ============ HONESTY ENGINE ============
// Runs against yesterday (and the day before for never-miss-twice) each time state is loaded.
async function runHonestyEngine(DB: D1Database, today: string) {
  const start = await DB.prepare(`SELECT value FROM settings WHERE key='start_date'`).first<{ value: string }>()
  const startDate = start?.value || today
  const y1 = addDays(today, -1)
  const y2 = addDays(today, -2)
  if (y1 < startDate) return

  // 1. Missed debrief
  const deb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(y1).first()
  if (!deb && !(await flagExists(DB, y1, 'missed_debrief'))) {
    await addFlag(DB, y1, 'missed_debrief', 'serious',
      `NIGHT DEBRIEF MISSED (${y1}). Law 5: Track, don't trust. An army without intelligence reports is blind. -15 pts. Write a catch-up debrief now.`, -15)
  }

  // 2. Missed non-negotiable blocks yesterday
  const yBlocks = await blocksForDate(DB, y1)
  for (const b of yBlocks) {
    if (b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial') {
      if (!(await flagExists(DB, y1, 'missed_block', `#${b.id}]`))) {
        const skipped = b.log_status === 'skipped'
        await addFlag(DB, y1, 'missed_block', skipped ? 'warn' : 'serious',
          `[Block #${b.id}] NON-NEGOTIABLE ${skipped ? 'SKIPPED' : 'UNLOGGED'}: "${b.title}" (${y1}). ${skipped ? 'You were honest about it — logged, no ambush. -5 pts.' : 'Not even logged. Silence is the worst report. -10 pts.'}`,
          skipped ? -5 : -10)
      }
    }
  }

  // 3. Never miss twice (Law 2)
  if (y2 >= startDate) {
    const y2Blocks = await blocksForDate(DB, y2)
    const missY2 = new Set(y2Blocks.filter((b: any) => b.is_non_negotiable && b.log_status !== 'done' && b.log_status !== 'partial').map((b: any) => b.id))
    for (const b of yBlocks) {
      if (b.is_non_negotiable && missY2.has(b.id) && b.log_status !== 'done' && b.log_status !== 'partial') {
        if (!(await flagExists(DB, y1, 'never_miss_twice', `#${b.id}]`))) {
          await addFlag(DB, y1, 'never_miss_twice', 'critical',
            `[Block #${b.id}] LAW 2 BROKEN: "${b.title}" missed TWO days straight (${y2}, ${y1}). This is the beginning of the end — unless you kill it today. -25 pts. Today this block is your #1 priority.`, -25)
        }
      }
    }
  }

  // 4. Low adherence day
  const adh = dayAdherence(yBlocks)
  if (yBlocks.length > 0 && adh.pct < 50 && !(await flagExists(DB, y1, 'low_adherence'))) {
    await addFlag(DB, y1, 'low_adherence', 'serious',
      `ADHERENCE COLLAPSE: ${adh.pct}% on ${y1} (target: 80%). No shame — but no lies either. Read your debrief, find the breach point, patch the wall. -10 pts.`, -10)
  }

  // 5. Reward: 80%+ day with debrief = streak day bonus
  if (yBlocks.length > 0 && adh.pct >= 80 && deb) {
    const already = await DB.prepare(`SELECT id FROM points_ledger WHERE log_date=? AND ref_type='streak'`).bind(y1).first()
    if (!already) {
      await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
        .bind(y1, 30, `VICTORY DAY: ${adh.pct}% adherence + debrief filed (${y1}). +30 pts.`, 'streak').run()
    }
  }
}

async function computeStreak(DB: D1Database, today: string): Promise<number> {
  const start = await DB.prepare(`SELECT value FROM settings WHERE key='start_date'`).first<{ value: string }>()
  const startDate = start?.value || today
  let streak = 0
  let d = addDays(today, -1)
  for (let i = 0; i < 120; i++) {
    if (d < startDate) break
    const blocks = await blocksForDate(DB, d)
    const deb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(d).first()
    const adh = dayAdherence(blocks)
    if (deb && adh.pct >= 80) { streak++; d = addDays(d, -1) } else break
  }
  // today counts if already qualifying
  const tBlocks = await blocksForDate(DB, today)
  const tDeb = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(today).first()
  if (tDeb && dayAdherence(tBlocks).pct >= 80) streak++
  return streak
}

// ============ STATE (the war room heartbeat) ============
app.get('/api/state', async (c) => {
  const DB = c.env.DB
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const time = c.req.query('time') || '12:00'

  await runHonestyEngine(DB, date)

  const blocks = await blocksForDate(DB, date)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, date)

  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()
  const todayPts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger WHERE log_date=?`).bind(date).first<{ total: number }>()
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0 ORDER BY created_at DESC LIMIT 20`).all()).results
  const debrief = await DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(date).first()
  const yDebrief = await DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(addDays(date, -1)).first()
  const dueCards = await DB.prepare(`SELECT COUNT(*) as n FROM flashcards WHERE due_date <= ?`).bind(date).first<{ n: number }>()

  // active units per track
  const activeUnits = (await DB.prepare(
    `SELECT u.id, u.title, p.code, p.title as phase_title, p.track, up.status
     FROM units u JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.status NOT IN ('locked','complete') ORDER BY p.sort_order, u.sort_order`
  ).all()).results

  return c.json({
    date, time, blocks, current, next, adherence: adh, streak,
    points: pts?.total ?? 0, todayPoints: todayPts?.total ?? 0,
    flags, debrief, yesterdayTargets: (yDebrief as any)?.tomorrow_targets || null,
    dueCards: dueCards?.n ?? 0, activeUnits
  })
})

// ============ BLOCK LOGGING ============
app.post('/api/blocks/:id/log', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { date, status, note } = await c.req.json()
  const block = await DB.prepare(`SELECT * FROM schedule_blocks WHERE id=?`).bind(id).first<any>()
  if (!block) return c.json({ error: 'no such block' }, 404)

  const prev = await DB.prepare(`SELECT * FROM block_logs WHERE block_id=? AND log_date=?`).bind(id, date).first<any>()
  await DB.prepare(
    `INSERT INTO block_logs (block_id, log_date, status, note, completed_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(block_id, log_date) DO UPDATE SET status=excluded.status, note=excluded.note, completed_at=excluded.completed_at`
  ).bind(id, date, status, note || null).run()

  // points: only award once per block/day transition into done/partial
  const prevEarned = prev && (prev.status === 'done' || prev.status === 'partial')
  const nowEarns = status === 'done' || status === 'partial'
  if (nowEarns && !prevEarned) {
    const p = status === 'done' ? block.points : Math.ceil(block.points / 2)
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, p, `${status === 'done' ? 'Completed' : 'Partial'}: ${block.title} (+${p})`, 'block', id).run()
  } else if (!nowEarns && prevEarned) {
    const p = prev.status === 'done' ? block.points : Math.ceil(block.points / 2)
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
      .bind(date, -p, `Reverted: ${block.title} (-${p})`, 'block', id).run()
  }
  return c.json({ ok: true })
})

// ============ DEBRIEF ============
app.post('/api/debrief', async (c) => {
  const DB = c.env.DB
  const b = await c.req.json()
  const existed = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(b.date).first()
  await DB.prepare(
    `INSERT INTO debriefs (log_date, wins, breaks, tomorrow_targets, strategy_insight, mood, energy, sleep_time, wake_time, sleep_hours)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(log_date) DO UPDATE SET wins=excluded.wins, breaks=excluded.breaks, tomorrow_targets=excluded.tomorrow_targets,
       strategy_insight=excluded.strategy_insight, mood=excluded.mood, energy=excluded.energy,
       sleep_time=excluded.sleep_time, wake_time=excluded.wake_time, sleep_hours=excluded.sleep_hours`
  ).bind(b.date, b.wins || null, b.breaks || null, b.tomorrow_targets || null, b.strategy_insight || null,
    b.mood || null, b.energy || null, b.sleep_time || null, b.wake_time || null, b.sleep_hours || null).run()
  if (!existed) {
    await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(b.date, 25, 'Night debrief filed. Intelligence report received. (+25)', 'debrief').run()
  }
  return c.json({ ok: true })
})

app.get('/api/debriefs', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM debriefs ORDER BY log_date DESC LIMIT 60`).all()
  return c.json(results)
})

// ============ CAMPAIGN (progress-locked) ============
async function ensureUnlocks(DB: D1Database) {
  // seed progress rows for all units
  await DB.prepare(
    `INSERT INTO unit_progress (unit_id, status)
     SELECT u.id, 'locked' FROM units u WHERE u.id NOT IN (SELECT unit_id FROM unit_progress)`
  ).run()
  // per track: walk phases in order; first incomplete unit becomes active
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const tracks: Record<string, any[]> = {}
  for (const p of phases) { (tracks[p.track] ||= []).push(p) }
  for (const track of Object.keys(tracks)) {
    let blocked = false
    for (const p of tracks[track]) {
      if (blocked) break
      const units = (await DB.prepare(
        `SELECT u.id, up.status FROM units u JOIN unit_progress up ON up.unit_id=u.id WHERE u.phase_id=? ORDER BY u.sort_order`
      ).bind(p.id).all()).results as any[]
      for (const u of units) {
        if (u.status === 'complete') continue
        if (u.status === 'locked') {
          await DB.prepare(`UPDATE unit_progress SET status='active' WHERE unit_id=?`).bind(u.id).run()
        }
        blocked = true
        break
      }
    }
  }
}

app.get('/api/campaign', async (c) => {
  const DB = c.env.DB
  await ensureUnlocks(DB)
  const phases = (await DB.prepare(`SELECT * FROM phases ORDER BY sort_order`).all()).results as any[]
  const out = []
  for (const p of phases) {
    const units = (await DB.prepare(
      `SELECT u.*, up.status, up.reading_done_at, up.drill_done_at, up.drill_report, up.debrief_answer,
              up.exam_answers, up.exam_self_score, up.completed_at, up.attempts
       FROM units u JOIN unit_progress up ON up.unit_id=u.id WHERE u.phase_id=? ORDER BY u.sort_order`
    ).bind(p.id).all()).results as any[]
    const complete = units.filter(u => u.status === 'complete').length
    out.push({ ...p, units, progress: units.length ? Math.round((complete / units.length) * 100) : 0, complete, total: units.length })
  }
  return c.json(out)
})

app.post('/api/units/:id/step', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { step, drill_report, debrief_answer, exam_answers, exam_self_score, date } = await c.req.json()
  const up = await DB.prepare(`SELECT * FROM unit_progress WHERE unit_id=?`).bind(id).first<any>()
  const unit = await DB.prepare(`SELECT * FROM units WHERE id=?`).bind(id).first<any>()
  if (!up || !unit) return c.json({ error: 'not found' }, 404)
  if (up.status === 'locked') return c.json({ error: 'UNIT LOCKED. Finish the previous unit first — this system is progress-based, no skipping.' }, 400)
  const today = date || new Date().toISOString().slice(0, 10)

  if (step === 'reading') {
    await DB.prepare(`UPDATE unit_progress SET status='reading_done', reading_done_at=datetime('now') WHERE unit_id=?`).bind(id).run()
    await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
      .bind(today, 20, `Reading complete: ${unit.title} (+20)`, 'unit', id).run()
  } else if (step === 'drill') {
    if (!drill_report || drill_report.trim().length < 30) {
      return c.json({ error: 'DRILL REPORT TOO THIN. A field drill without a real report is a skipped drill — write at least a few honest sentences about what you actually DID and what happened.' }, 400)
    }
    await DB.prepare(`UPDATE unit_progress SET status='drill_done', drill_done_at=datetime('now'), drill_report=? WHERE unit_id=?`).bind(drill_report, id).run()
    await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
      .bind(today, 30, `Field drill executed: ${unit.title} (+30)`, 'unit', id).run()
  } else if (step === 'complete') {
    if (unit.is_exam) {
      if (!exam_answers) return c.json({ error: 'Exam answers required.' }, 400)
      const score = Number(exam_self_score ?? 0)
      await DB.prepare(`UPDATE unit_progress SET exam_answers=?, exam_self_score=?, attempts=attempts+1 WHERE unit_id=?`)
        .bind(JSON.stringify(exam_answers), score, id).run()
      if (score < 70) {
        await addFlag(DB, today, 'exam_failed', 'serious',
          `EXAM NOT PASSED: ${unit.title} — self-score ${score}/100 (pass: 70). No shame: the weak chapters are now visible. Re-study them, retake when ready. The gate stays closed until earned. -10 pts.`, -10)
        return c.json({ ok: false, failed: true, message: `Score ${score}/100. Pass mark is 70. The honesty engine has logged this attempt. Restudy your weak chapters and retake — the next phase stays locked until you EARN it.` })
      }
      await DB.prepare(`UPDATE unit_progress SET status='complete', completed_at=datetime('now') WHERE unit_id=?`).bind(id).run()
      await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
        .bind(today, 100, `EXAM PASSED (${score}/100): ${unit.title} (+100)`, 'exam', id).run()
    } else {
      if (up.status !== 'drill_done' && up.status !== 'reading_done') {
        return c.json({ error: 'Mark the reading done first.' }, 400)
      }
      if (up.status === 'reading_done' && unit.field_drill) {
        return c.json({ error: 'FIELD DRILL NOT REPORTED. Reading without application is entertainment, not training. Execute the drill, file the report, then complete.' }, 400)
      }
      await DB.prepare(`UPDATE unit_progress SET status='complete', completed_at=datetime('now'), debrief_answer=COALESCE(?,debrief_answer) WHERE unit_id=?`)
        .bind(debrief_answer || null, id).run()
      await DB.prepare(`INSERT INTO points_ledger (log_date,points,reason,ref_type,ref_id) VALUES (?,?,?,?,?)`)
        .bind(today, 50, `UNIT CONQUERED: ${unit.title} (+50)`, 'unit', id).run()
    }
    await ensureUnlocks(DB)
  }
  return c.json({ ok: true })
})

// ============ MAXIMS + FLASHCARDS ============
app.get('/api/maxims', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM maxims ORDER BY source, id`).all()
  return c.json(results)
})
app.post('/api/maxims', async (c) => {
  const b = await c.req.json()
  const r = await c.env.DB.prepare(
    `INSERT INTO maxims (source, principle, naive_reading, master_reading, my_words, created_by_user) VALUES (?,?,?,?,?,1)`
  ).bind(b.source, b.principle, b.naive_reading || '(write it)', b.master_reading || '(write it)', b.my_words || null).run()
  await c.env.DB.prepare(`INSERT INTO flashcards (maxim_id) VALUES (?)`).bind(r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})
app.post('/api/maxims/:id/my-words', async (c) => {
  const { my_words } = await c.req.json()
  await c.env.DB.prepare(`UPDATE maxims SET my_words=? WHERE id=?`).bind(my_words, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

async function ensureCards(DB: D1Database) {
  await DB.prepare(`INSERT INTO flashcards (maxim_id) SELECT id FROM maxims WHERE id NOT IN (SELECT maxim_id FROM flashcards)`).run()
}
app.get('/api/cards/due', async (c) => {
  const DB = c.env.DB
  await ensureCards(DB)
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const { results } = await DB.prepare(
    `SELECT f.*, m.source, m.principle, m.naive_reading, m.master_reading, m.my_words
     FROM flashcards f JOIN maxims m ON m.id=f.maxim_id WHERE f.due_date <= ? ORDER BY f.due_date LIMIT 15`
  ).bind(date).all()
  return c.json(results)
})
app.post('/api/cards/:maximId/review', async (c) => {
  const DB = c.env.DB
  const mid = Number(c.req.param('maximId'))
  const { grade, date } = await c.req.json() // 0 fail, 1 hard, 2 good, 3 easy
  const card = await DB.prepare(`SELECT * FROM flashcards WHERE maxim_id=?`).bind(mid).first<any>()
  if (!card) return c.json({ error: 'no card' }, 404)
  let { interval_days, ease, reps, lapses } = card
  if (grade === 0) { lapses++; reps = 0; interval_days = 0; ease = Math.max(1.3, ease - 0.2) }
  else {
    reps++
    ease = Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 1 ? -0.15 : 0))
    if (reps === 1) interval_days = 1
    else if (reps === 2) interval_days = 3
    else interval_days = Math.round(interval_days * ease * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1))
  }
  const today = date || new Date().toISOString().slice(0, 10)
  const due = addDays(today, Math.max(interval_days, grade === 0 ? 0 : 1))
  await DB.prepare(`UPDATE flashcards SET interval_days=?, ease=?, reps=?, lapses=?, due_date=? WHERE maxim_id=?`)
    .bind(interval_days, ease, reps, lapses, due, mid).run()
  await DB.prepare(`INSERT INTO card_reviews (maxim_id, grade) VALUES (?,?)`).bind(mid, grade).run()
  return c.json({ ok: true, next_due: due })
})

// ============ FLAGS ============
app.post('/api/flags/:id/ack', async (c) => {
  await c.env.DB.prepare(`UPDATE honesty_flags SET acknowledged=1 WHERE id=?`).bind(Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})
app.get('/api/flags/history', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM honesty_flags ORDER BY created_at DESC LIMIT 100`).all()
  return c.json(results)
})

// ============ LAWS ============
app.get('/api/laws', async (c) => {
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, lc.kept, lc.note FROM laws l LEFT JOIN law_checks lc ON lc.law_id=l.id AND lc.log_date=? ORDER BY l.sort_order`
  ).bind(date).all()
  return c.json(results)
})
app.post('/api/laws/:id/check', async (c) => {
  const { date, kept, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO law_checks (law_id, log_date, kept, note) VALUES (?,?,?,?)
     ON CONFLICT(law_id, log_date) DO UPDATE SET kept=excluded.kept, note=excluded.note`
  ).bind(Number(c.req.param('id')), date, kept ? 1 : 0, note || null).run()
  return c.json({ ok: true })
})

// ============ REWARDS ============
app.get('/api/rewards', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM rewards ORDER BY cost`).all()
  return c.json(results)
})
app.post('/api/rewards/:id/redeem', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const { date } = await c.req.json()
  const reward = await DB.prepare(`SELECT * FROM rewards WHERE id=?`).bind(id).first<any>()
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()
  if (!reward) return c.json({ error: 'no reward' }, 404)
  if ((pts?.total ?? 0) < reward.cost) {
    return c.json({ error: `NOT EARNED YET. You have ${pts?.total ?? 0} pts, this costs ${reward.cost}. Rewards are taken, not given. Back to work.` }, 400)
  }
  await DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
    .bind(date, -reward.cost, `REWARD REDEEMED: ${reward.title} (-${reward.cost})`, 'reward', id).run()
  await DB.prepare(`UPDATE rewards SET redeemed_count=redeemed_count+1 WHERE id=?`).bind(id).run()
  await DB.prepare(`INSERT INTO reward_redemptions (reward_id) VALUES (?)`).bind(id).run()
  return c.json({ ok: true })
})

// ============ STATS ============
app.get('/api/stats', async (c) => {
  const DB = c.env.DB
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = addDays(date, -i)
    const blocks = await blocksForDate(DB, d)
    const adh = dayAdherence(blocks)
    const deb = await DB.prepare(`SELECT sleep_hours, mood, energy FROM debriefs WHERE log_date=?`).bind(d).first<any>()
    days.push({ date: d, pct: adh.pct, done: adh.done, total: adh.total, sleep: deb?.sleep_hours ?? null, mood: deb?.mood ?? null, energy: deb?.energy ?? null, debrief: !!deb })
  }
  // category breakdown last 7 days
  const from = addDays(date, -6)
  const { results: catRows } = await DB.prepare(
    `SELECT b.category, COUNT(*) as total,
            SUM(CASE WHEN l.status='done' THEN 1 WHEN l.status='partial' THEN 0.5 ELSE 0 END) as done
     FROM block_logs l JOIN schedule_blocks b ON b.id=l.block_id
     WHERE l.log_date BETWEEN ? AND ? GROUP BY b.category`
  ).bind(from, date).all()
  const ledger = (await DB.prepare(`SELECT * FROM points_ledger ORDER BY created_at DESC LIMIT 40`).all()).results
  const unitStats = await DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END) as complete FROM unit_progress`
  ).first<any>()
  const cardStats = await DB.prepare(
    `SELECT COUNT(*) as reviews, AVG(grade) as avg_grade FROM card_reviews`
  ).first<any>()
  const flagCounts = (await DB.prepare(
    `SELECT flag_type, COUNT(*) as n FROM honesty_flags GROUP BY flag_type`
  ).all()).results
  const streak = await computeStreak(DB, date)
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as total FROM points_ledger`).first<{ total: number }>()
  return c.json({ days, categories: catRows, ledger, unitStats, cardStats, flagCounts, streak, points: pts?.total ?? 0 })
})

// ============ LIFE INTEL (The Council) ============
app.get('/api/intel', async (c) => {
  const domain = c.req.query('domain')
  const q = domain
    ? c.env.DB.prepare(`SELECT * FROM intel_entries WHERE domain=? ORDER BY log_date DESC, id DESC LIMIT 100`).bind(domain)
    : c.env.DB.prepare(`SELECT * FROM intel_entries ORDER BY log_date DESC, id DESC LIMIT 100`)
  return c.json((await q.all()).results)
})

app.post('/api/intel', async (c) => {
  const b = await c.req.json()
  if (!b.title || !b.domain) return c.json({ error: 'Domain and title required.' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO intel_entries (log_date, domain, title, situation, my_move, outcome, verdict, principle_used, lesson, people)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.log_date || new Date().toISOString().slice(0, 10), b.domain, b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null).run()
  await c.env.DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type, ref_id) VALUES (?,?,?,?,?)`)
    .bind(b.log_date || new Date().toISOString().slice(0, 10), 15, `Intel filed: [${b.domain}] ${b.title} (+15)`, 'intel', r.meta.last_row_id).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

app.post('/api/intel/:id/verdict', async (c) => {
  const { verdict, lesson } = await c.req.json()
  await c.env.DB.prepare(`UPDATE intel_entries SET verdict=?, lesson=COALESCE(?,lesson) WHERE id=?`)
    .bind(verdict, lesson || null, Number(c.req.param('id'))).run()
  return c.json({ ok: true })
})

// ============ BOOK PROGRESS (real books library) ============
const BOOKS_META = [
  { id: 'art_of_war', title: 'The Art of War', author: 'Sun Tzu', phase: 'P1' },
  { id: 'the_prince', title: 'The Prince', author: 'Machiavelli', phase: 'P2' },
  { id: 'discourses', title: 'Discourses on Livy', author: 'Machiavelli', phase: 'P2B' },
  { id: 'on_war', title: 'On War (Book I)', author: 'Clausewitz', phase: 'P3' },
  { id: 'meditations', title: 'Meditations', author: 'Marcus Aurelius', phase: 'PHIL' },
  { id: 'enchiridion', title: 'The Enchiridion', author: 'Epictetus', phase: 'PHIL' },
  { id: 'apology', title: 'Apology', author: 'Plato', phase: 'PHIL' },
  { id: 'crito', title: 'Crito', author: 'Plato', phase: 'PHIL' },
  { id: 'republic', title: 'The Republic (I–IV)', author: 'Plato', phase: 'PHIL' },
  { id: 'zarathustra', title: 'Thus Spake Zarathustra (Pt.1)', author: 'Nietzsche', phase: 'PHIL' },
  { id: 'beyond_good_evil', title: 'Beyond Good and Evil', author: 'Nietzsche', phase: 'PHIL' },
]

app.get('/api/library', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT book_id, chapter_idx, status, last_para FROM book_progress`).all()
  const prog: Record<string, any[]> = {}
  for (const r of results as any[]) (prog[r.book_id] ||= []).push(r)
  return c.json(BOOKS_META.map(b => {
    const rows = prog[b.id] || []
    const done = rows.filter(r => r.status === 'done').length
    const reading = rows.find(r => r.status === 'reading')
    return { ...b, chaptersDone: done, currentChapter: reading?.chapter_idx ?? null, lastPara: reading?.last_para ?? 0 }
  }))
})

app.post('/api/library/:bookId/chapter/:idx', async (c) => {
  const bookId = c.req.param('bookId')
  const idx = Number(c.req.param('idx'))
  const { status, last_para, notes, date } = await c.req.json()
  const prev = await c.env.DB.prepare(`SELECT status FROM book_progress WHERE book_id=? AND chapter_idx=?`).bind(bookId, idx).first<any>()
  await c.env.DB.prepare(
    `INSERT INTO book_progress (book_id, chapter_idx, status, last_para, notes, completed_at)
     VALUES (?,?,?,?,?, CASE WHEN ?='done' THEN datetime('now') ELSE NULL END)
     ON CONFLICT(book_id, chapter_idx) DO UPDATE SET status=excluded.status,
       last_para=excluded.last_para, notes=COALESCE(excluded.notes, notes),
       completed_at=CASE WHEN excluded.status='done' THEN datetime('now') ELSE completed_at END`
  ).bind(bookId, idx, status || 'reading', last_para ?? 0, notes || null, status || 'reading').run()
  if (status === 'done' && prev?.status !== 'done') {
    await c.env.DB.prepare(`INSERT INTO points_ledger (log_date, points, reason, ref_type) VALUES (?,?,?,?)`)
      .bind(date || new Date().toISOString().slice(0, 10), 20, `Real chapter finished: ${bookId} ch.${idx + 1} (+20)`, 'book').run()
  }
  return c.json({ ok: true })
})

// ============ CALENDAR EXPORT (.ics — device-native alarms) ============
app.get('/calendar.ics', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM schedule_blocks ORDER BY start_time`).all()
  const dayMap: Record<string, string> = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' }
  let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WarRoom//LockIn//EN\r\nX-WR-CALNAME:War Room Schedule\r\n'
  for (const b of results as any[]) {
    const days = b.days.split(',').map((d: string) => dayMap[d.trim()]).filter(Boolean).join(',')
    const [sh, sm] = b.start_time.split(':'); const [eh, em] = b.end_time.split(':')
    ics += 'BEGIN:VEVENT\r\n'
    ics += `UID:warroom-block-${b.id}@lockin\r\n`
    ics += `DTSTART;TZID=Africa/Nairobi:20260101T${sh}${sm}00\r\n`
    ics += `DTEND;TZID=Africa/Nairobi:20260101T${eh}${em}00\r\n`
    ics += `RRULE:FREQ=WEEKLY;BYDAY=${days}\r\n`
    ics += `SUMMARY:${b.is_non_negotiable ? '🔒 ' : ''}${b.title.replace(/[,;]/g, ' ')}\r\n`
    ics += `DESCRIPTION:${(b.description || '').replace(/[,;\n]/g, ' ')}\r\n`
    ics += 'BEGIN:VALARM\r\nTRIGGER:-PT2M\r\nACTION:DISPLAY\r\nDESCRIPTION:War Room block starting\r\nEND:VALARM\r\n'
    ics += 'END:VEVENT\r\n'
  }
  ics += 'END:VCALENDAR\r\n'
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="warroom.ics"' } })
})

// ============ HERMES — the autonomous counsel ============
async function hermesBriefing(DB: D1Database, date: string): Promise<string> {
  const y1 = addDays(date, -1)
  const blocks = await blocksForDate(DB, date)
  const adh = dayAdherence(blocks)
  const streak = await computeStreak(DB, date)
  const pts = await DB.prepare(`SELECT COALESCE(SUM(points),0) as t FROM points_ledger`).first<any>()
  const debriefs = (await DB.prepare(`SELECT * FROM debriefs ORDER BY log_date DESC LIMIT 7`).all()).results as any[]
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags ORDER BY created_at DESC LIMIT 10`).all()).results as any[]
  const intel = (await DB.prepare(`SELECT * FROM intel_entries ORDER BY id DESC LIMIT 15`).all()).results as any[]
  const units = (await DB.prepare(
    `SELECT u.title, p.code, up.status, up.drill_report FROM units u
     JOIN phases p ON p.id=u.phase_id JOIN unit_progress up ON up.unit_id=u.id
     WHERE up.status NOT IN ('locked') ORDER BY p.sort_order, u.sort_order LIMIT 12`
  ).all()).results as any[]
  const lawBreaks = (await DB.prepare(
    `SELECT l.title, COUNT(*) n FROM law_checks lc JOIN laws l ON l.id=lc.law_id WHERE lc.kept=0 GROUP BY l.id ORDER BY n DESC LIMIT 3`
  ).all()).results as any[]

  return `=== COMMANDER'S FILE (auto-generated live from the War Room database) ===
DATE: ${date} | STREAK: ${streak} victory days | POINTS: ${pts?.t} | TODAY'S ADHERENCE SO FAR: ${adh.pct}% (${adh.done}/${adh.total})

LAST 7 DEBRIEFS (his own words — wins / breaks / targets / insights / sleep):
${debriefs.map(d => `[${d.log_date}] WINS: ${d.wins || '—'} | BREAKS: ${d.breaks || '—'} | TARGETS: ${d.tomorrow_targets || '—'} | INSIGHT: ${d.strategy_insight || '—'} | sleep ${d.sleep_hours ?? '?'}h mood ${d.mood ?? '?'}/5`).join('\n') || '(no debriefs yet)'}

HONESTY FLAGS (his failures, logged by the system):
${flags.map(f => `[${f.flag_date}][${f.severity}] ${f.message}`).join('\n') || '(clean record)'}

MOST-BROKEN LAWS: ${lawBreaks.map(l => `"${l.title}" x${l.n}`).join(', ') || '(none logged)'}

CAMPAIGN STATE (strategy curriculum progress + his actual drill reports):
${units.map(u => `[${u.code}] ${u.title} — ${u.status}${u.drill_report ? ` | HIS DRILL REPORT: ${String(u.drill_report).slice(0, 200)}` : ''}`).join('\n') || '(not started)'}

LIFE INTEL (his logged real-world moves — smart & dumb — across loyalty, family, friends, network, money, relationships, manipulation-spotting):
${intel.map(i => `[${i.log_date}][${i.domain}][verdict:${i.verdict}] ${i.title} | SITUATION: ${(i.situation || '').slice(0, 150)} | HIS MOVE: ${(i.my_move || '').slice(0, 150)} | OUTCOME: ${(i.outcome || '').slice(0, 100)}`).join('\n') || '(no intel filed yet)'}
=== END FILE ===`
}

const HERMES_SYSTEM = `You are HERMES — the Commander's private autonomous counsel inside his War Room discipline system. You have his COMPLETE file: every debrief, every honesty flag, every drill report, every real-world move he logs (family, friends, money, relationships, network, manipulation attempts, hustles).

Your doctrine:
1. MASTER READINGS ONLY. You are fluent in Sun Tzu, Machiavelli (The Prince AND the Discourses), the Stoics, Plato, Nietzsche, Greene, Musashi, Clausewitz. You teach strategic clarity — never paranoia, never manipulation. When he drifts toward the naive reading (scheming, paranoia, treating friends like enemies), correct him immediately and explain why detected manipulators lose long-term (never-be-hated constraint, reputation networks).
2. RUTHLESS HONESTY, ZERO SHAME. Call out his dumb moves by name using HIS OWN logged words as evidence. Praise real wins specifically. Never flatter — Machiavelli Ch.23: flatterers are a plague, and you are the truth-teller he authorized.
3. HE IS A SLOW, DEEP PROCESSOR. Never push speed. Push depth, sequence, and consistency. One principle applied beats ten memorized.
4. CITE THE CANON. When advising on his real situations (loyalty, women, money, classmates, neighbours, hustles), name the exact chapter/principle: e.g. "Sun Tzu Ch.3 — win without fighting", "The Prince Ch.17 — feared vs loved, but NEVER hated", "Epictetus — dichotomy of control".
5. PATTERN DETECTION. Cross-reference his file: if his debriefs show the same break 3x, if a person keeps appearing in bad-outcome intel, if his sleep collapses before his worst days — SAY IT. You see patterns he can't.
6. FORMAT: tight, soldier-to-commander. Short paragraphs. Bold the key move. End with ONE concrete order for today when relevant.
7. Ethics line: you advise defense, positioning, boundaries, leverage through competence — never fraud, revenge, or harming others. That is the master reading and you enforce it.`

app.post('/api/hermes', async (c) => {
  const DB = c.env.DB
  const { message, date } = await c.req.json()
  if (!message?.trim()) return c.json({ error: 'Say something, Commander.' }, 400)
  const today = date || new Date().toISOString().slice(0, 10)

  const briefing = await hermesBriefing(DB, today)
  const history = ((await DB.prepare(`SELECT role, content FROM hermes_messages ORDER BY id DESC LIMIT 12`).all()).results as any[]).reverse()

  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('user', ?, ?)`).bind(message, today).run()

  const apiKey = c.env.OPENAI_API_KEY
  const baseURL = c.env.OPENAI_BASE_URL
  if (!apiKey) return c.json({ error: 'Hermes is offline: no LLM key configured. Inject your API key in the project settings.' }, 500)

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'system', content: briefing },
        ...history.map((h: any) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ]
    })
  })
  if (!resp.ok) {
    const t = await resp.text()
    return c.json({ error: `Hermes uplink failed (${resp.status}): ${t.slice(0, 200)}` }, 500)
  }
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(no response)'
  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('assistant', ?, ?)`).bind(answer, today).run()
  return c.json({ answer })
})

app.get('/api/hermes/history', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM hermes_messages ORDER BY id DESC LIMIT 40`).all()
  return c.json((results as any[]).reverse())
})

// Morning war council: Hermes proactively reviews the file and issues the day's orders
app.post('/api/hermes/council', async (c) => {
  const DB = c.env.DB
  const { date } = await c.req.json()
  const today = date || new Date().toISOString().slice(0, 10)
  const briefing = await hermesBriefing(DB, today)
  const apiKey = c.env.OPENAI_API_KEY
  if (!apiKey) return c.json({ error: 'Hermes offline: no LLM key.' }, 500)
  const resp = await fetch(`${c.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'system', content: briefing },
        { role: 'user', content: `Convene the war council for ${today}. Review my complete file above and deliver: 1) STATE OF THE COMMANDER — the single most important pattern you see in my recent data (good or bad, with evidence from my own logs). 2) THREAT ASSESSMENT — my biggest current vulnerability. 3) COMMENDATION — one real win to build on. 4) TODAY'S ORDERS — the one concrete move that matters most today. Keep it under 300 words, soldier-to-commander.` }
      ]
    })
  })
  if (!resp.ok) return c.json({ error: `Council failed (${resp.status})` }, 500)
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(silence)'
  await DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES ('assistant', ?, ?)`).bind(`[MORNING WAR COUNCIL ${today}]\n${answer}`, today).run()
  return c.json({ answer })
})

// Hermes analysis of a specific intel entry
app.post('/api/intel/:id/analyze', async (c) => {
  const DB = c.env.DB
  const id = Number(c.req.param('id'))
  const entry = await DB.prepare(`SELECT * FROM intel_entries WHERE id=?`).bind(id).first<any>()
  if (!entry) return c.json({ error: 'No such entry' }, 404)
  const apiKey = c.env.OPENAI_API_KEY
  if (!apiKey) return c.json({ error: 'Hermes offline: no LLM key.' }, 500)
  const resp = await fetch(`${c.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: HERMES_SYSTEM },
        { role: 'user', content: `Analyze this move I made. Domain: ${entry.domain}. Title: ${entry.title}. SITUATION: ${entry.situation || '—'}. MY MOVE: ${entry.my_move || '—'}. OUTCOME: ${entry.outcome || '—'}. People involved: ${entry.people || '—'}.\n\nGive me: 1) VERDICT (smart/dumb/mixed — brutal). 2) THE PRINCIPLE — which exact Sun Tzu/Machiavelli/Stoic principle applies, by name. 3) THE MASTER MOVE — what the ideal play was. 4) THE PATTERN WARNING — what to watch for next time. Max 200 words.` }
      ]
    })
  })
  if (!resp.ok) return c.json({ error: `Analysis failed (${resp.status})` }, 500)
  const data: any = await resp.json()
  const answer = data.choices?.[0]?.message?.content || '(no analysis)'
  await DB.prepare(`UPDATE intel_entries SET hermes_analysis=? WHERE id=?`).bind(answer, id).run()
  return c.json({ analysis: answer })
})

// ============ HERMES BRIDGE — external agent API (Termux/Telegram/CLI) ============
// Your local Hermes agent authenticates with X-Agent-Token and gets full read/write
// access to the war room: briefings, journaling, check-offs, intel filing.

function genToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let t = 'hermes_'
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  for (const b of buf) t += chars[b % chars.length]
  return t
}

async function getAgentToken(DB: D1Database): Promise<string> {
  const row = await DB.prepare(`SELECT value FROM settings WHERE key='agent_token'`).first<{ value: string }>()
  if (row) return row.value
  const t = genToken()
  await DB.prepare(`INSERT INTO settings (key, value) VALUES ('agent_token', ?)`).bind(t).run()
  return t
}

async function agentAuthed(c: any): Promise<boolean> {
  const token = c.req.header('x-agent-token') || c.req.query('token')
  if (!token) return false
  const stored = await getAgentToken(c.env.DB)
  return token === stored
}

// Called from the app UI (same-origin) to show/rotate the token
app.get('/api/agent/token', async (c) => {
  return c.json({ token: await getAgentToken(c.env.DB) })
})
app.post('/api/agent/token/rotate', async (c) => {
  const t = genToken()
  await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('agent_token', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(t).run()
  return c.json({ token: t })
})

// Full situational briefing for the agent (text + structured JSON)
app.get('/api/agent/briefing', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  await runHonestyEngine(DB, date)
  const briefing = await hermesBriefing(DB, date)
  const blocks = await blocksForDate(DB, date)
  const time = c.req.query('time') || '12:00'
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const next = blocks.find((b: any) => b.start_time > time) || null
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0`).all()).results
  return c.json({ date, briefing, current, next, adherence: dayAdherence(blocks), flags, blocks })
})

// What needs attention RIGHT NOW (for the agent's watch loop → Telegram/termux-notification)
app.get('/api/agent/pending', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const time = c.req.query('time') || '23:59'
  await runHonestyEngine(DB, date)
  const blocks = await blocksForDate(DB, date)
  const overdue = blocks.filter((b: any) => b.end_time <= time && !b.log_status)
  const current = blocks.find((b: any) => b.start_time <= time && time < b.end_time) || null
  const flags = (await DB.prepare(`SELECT * FROM honesty_flags WHERE acknowledged=0 ORDER BY created_at DESC`).all()).results
  const debriefToday = await DB.prepare(`SELECT id FROM debriefs WHERE log_date=?`).bind(date).first()
  const dueCards = await DB.prepare(`SELECT COUNT(*) n FROM flashcards WHERE due_date<=?`).bind(date).first<any>()
  return c.json({
    date, time,
    current_block: current ? { id: current.id, title: current.title, start: current.start_time, end: current.end_time, status: current.log_status } : null,
    overdue_unlogged: overdue.map((b: any) => ({ id: b.id, title: b.title, end: b.end_time, non_negotiable: !!b.is_non_negotiable })),
    unacknowledged_flags: flags,
    debrief_filed_today: !!debriefToday,
    flashcards_due: dueCards?.n ?? 0
  })
})

// Agent auto-journals anything it observes: intel, debrief updates, block check-offs
app.post('/api/agent/intel', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const b = await c.req.json()
  if (!b.title || !b.domain) return c.json({ error: 'domain and title required' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO intel_entries (log_date, domain, title, situation, my_move, outcome, verdict, principle_used, lesson, people, hermes_analysis)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(b.log_date || new Date().toISOString().slice(0, 10), b.domain, '[HERMES] ' + b.title, b.situation || null,
    b.my_move || null, b.outcome || null, b.verdict || 'pending', b.principle_used || null,
    b.lesson || null, b.people || null, b.analysis || null).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

app.post('/api/agent/debrief', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const b = await c.req.json()
  const date = b.date || new Date().toISOString().slice(0, 10)
  const prev = await c.env.DB.prepare(`SELECT * FROM debriefs WHERE log_date=?`).bind(date).first<any>()
  const merge = (a: string | null | undefined, x: string | null | undefined) =>
    x ? (a ? a + '\n[HERMES] ' + x : '[HERMES] ' + x) : (a ?? null)
  await c.env.DB.prepare(
    `INSERT INTO debriefs (log_date, wins, breaks, tomorrow_targets, strategy_insight, mood, energy, sleep_time, wake_time, sleep_hours)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(log_date) DO UPDATE SET wins=excluded.wins, breaks=excluded.breaks,
       tomorrow_targets=excluded.tomorrow_targets, strategy_insight=excluded.strategy_insight,
       mood=COALESCE(excluded.mood, mood), energy=COALESCE(excluded.energy, energy),
       sleep_time=COALESCE(excluded.sleep_time, sleep_time), wake_time=COALESCE(excluded.wake_time, wake_time),
       sleep_hours=COALESCE(excluded.sleep_hours, sleep_hours)`
  ).bind(date, merge(prev?.wins, b.wins), merge(prev?.breaks, b.breaks),
    merge(prev?.tomorrow_targets, b.tomorrow_targets), merge(prev?.strategy_insight, b.strategy_insight),
    b.mood ?? prev?.mood ?? null, b.energy ?? prev?.energy ?? null,
    b.sleep_time ?? prev?.sleep_time ?? null, b.wake_time ?? prev?.wake_time ?? null,
    b.sleep_hours ?? prev?.sleep_hours ?? null).run()
  return c.json({ ok: true })
})

app.post('/api/agent/block-log', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const { block_id, date, status, note } = await c.req.json()
  await c.env.DB.prepare(
    `INSERT INTO block_logs (block_id, log_date, status, note, completed_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(block_id, log_date) DO UPDATE SET status=excluded.status, note=excluded.note, completed_at=excluded.completed_at`
  ).bind(block_id, date || new Date().toISOString().slice(0, 10), status, note ? '[HERMES] ' + note : null).run()
  return c.json({ ok: true })
})

// Agent posts its counsel into the app's Council log (visible in the COUNCIL tab)
app.post('/api/agent/message', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const { content, role } = await c.req.json()
  if (!content) return c.json({ error: 'content required' }, 400)
  await c.env.DB.prepare(`INSERT INTO hermes_messages (role, content, context_date) VALUES (?,?,?)`)
    .bind(role === 'user' ? 'user' : 'assistant', '[LOCAL-HERMES] ' + content, new Date().toISOString().slice(0, 10)).run()
  return c.json({ ok: true })
})

// Everything endpoint: full DB export for the agent's memory sync
app.get('/api/agent/export', async (c) => {
  if (!(await agentAuthed(c))) return c.json({ error: 'Invalid agent token' }, 401)
  const DB = c.env.DB
  const out: Record<string, any> = {}
  for (const t of ['debriefs', 'intel_entries', 'honesty_flags', 'points_ledger', 'unit_progress', 'book_progress', 'law_checks', 'maxims'])
    out[t] = (await DB.prepare(`SELECT * FROM ${t}`).all()).results
  return c.json(out)
})

// ============ PWA MANIFEST + SERVICE WORKER ============
app.get('/manifest.json', (c) => c.json({
  name: 'War Room — Lock In', short_name: 'War Room', start_url: '/', display: 'standalone',
  background_color: '#0a0e14', theme_color: '#0a0e14',
  icons: [{ src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
}))

app.get('/sw.js', (c) => {
  const sw = `
const CACHE='warroom-v1';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/static/books/')){
    e.respondWith(caches.open(CACHE).then(async c=>{
      const hit=await c.match(e.request); if(hit) return hit;
      const r=await fetch(e.request); if(r.ok) c.put(e.request,r.clone()); return r;
    }));
  }
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(cs=>{
    for(const c of cs){ if('focus' in c) return c.focus(); }
    return clients.openWindow('/');
  }));
});`
  return new Response(sw, { headers: { 'Content-Type': 'application/javascript' } })
})

// ============ SHELL ============
app.get('/', (c) => c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#0a0e14">
<title>WAR ROOM — Lock In</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚔️</text></svg>">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/static/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="/static/style.css" rel="stylesheet">
<script>tailwind.config={theme:{extend:{fontFamily:{disp:['Rajdhani','sans-serif'],body:['Inter','sans-serif']},colors:{ink:'#0a0e14',panel:'#111826',line:'#1e2a3d',gold:'#d4af37',blood:'#dc2626',jade:'#22c55e'}}}}</script>
</head>
<body class="bg-ink text-gray-200 font-body">
<div id="app"><div class="flex items-center justify-center h-screen text-gold font-disp text-xl tracking-widest">⚔ ENTERING THE WAR ROOM…</div></div>
<script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
<script src="/static/app.js"></script>
<script src="/static/app2.js"></script>
<script src="/static/app3.js"></script>
<script src="/static/app4.js"></script>
<script src="/static/app5.js"></script>
<script src="/static/app6.js"></script>
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js');}</script>
</body>
</html>`))

export default app
