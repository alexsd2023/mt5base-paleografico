'use client'

import { useState, useRef, useCallback } from 'react'
import styles from './page.module.css'

type LineStatus = 'pending' | 'running' | 'done' | 'error'

interface LineResult {
  original: string
  gt: string
  output: string
  status: LineStatus
  error?: string
  cer: number
  wer: number
  chrf: number
}

interface DocResult {
  name: string
  lines: LineResult[]
  cer: number
  wer: number
  chrf: number
}

type DiffToken = { text: string; type: 'equal' | 'removed' | 'added' }

function levenshtein(a: string[], b: string[]): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function calcCER(pred: string, ref: string): number {
  if (!ref) return pred ? 1 : 0
  return levenshtein(Array.from(pred), Array.from(ref)) / ref.length
}

function calcWER(pred: string, ref: string): number {
  const p = pred.trim().split(/\s+/)
  const r = ref.trim().split(/\s+/)
  if (!r.length || (r.length === 1 && r[0] === '')) return p.length ? 1 : 0
  return levenshtein(p, r) / r.length
}

function calcChrF(pred: string, ref: string, n = 6, beta = 2): number {
  function getNgrams(s: string, ng: number): Map<string, number> {
    const m = new Map<string, number>()
    for (let i = 0; i <= s.length - ng; i++) {
      const gram = s.slice(i, i + ng)
      m.set(gram, (m.get(gram) || 0) + 1)
    }
    return m
  }
  let totalF = 0, count = 0
  for (let ng = 1; ng <= n; ng++) {
    const predG = getNgrams(pred, ng)
    const refG  = getNgrams(ref, ng)
    let matches = 0
    predG.forEach((cnt, gram) => { matches += Math.min(cnt, refG.get(gram) || 0) })
    const predTotal = Array.from(predG.values()).reduce((a, b) => a + b, 0)
    const refTotal  = Array.from(refG.values()).reduce((a, b) => a + b, 0)
    const p = predTotal ? matches / predTotal : 0
    const r = refTotal  ? matches / refTotal  : 0
    const f = (p + r) ? (1 + beta*beta) * p * r / (beta*beta * p + r) : 0
    totalF += f; count++
  }
  return count ? (totalF / count) * 100 : 0
}

function corpusCER(lines: LineResult[]): number {
  const totalEdit = lines.reduce((s, l) => s + levenshtein(Array.from(l.output), Array.from(l.gt)), 0)
  const totalRef  = lines.reduce((s, l) => s + l.gt.length, 0)
  return totalRef ? totalEdit / totalRef : 0
}
function corpusWER(lines: LineResult[]): number {
  const totalEdit = lines.reduce((s, l) =>
    s + levenshtein(l.output.trim().split(/\s+/), l.gt.trim().split(/\s+/)), 0)
  const totalRef = lines.reduce((s, l) => s + l.gt.trim().split(/\s+/).length, 0)
  return totalRef ? totalEdit / totalRef : 0
}
function corpusChrF(lines: LineResult[]): number {
  const vals = lines.filter(l => l.gt).map(l => calcChrF(l.output, l.gt))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

function diffWords(a: string, b: string): DiffToken[] {
  const wa = a.split(/(\s+)/), wb = b.split(/(\s+)/)
  const dp = Array.from({ length: wa.length + 1 }, (_, i) =>
    Array.from({ length: wb.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= wa.length; i++)
    for (let j = 1; j <= wb.length; j++)
      dp[i][j] = wa[i-1] === wb[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  const tokens: DiffToken[] = []
  let i = wa.length, j = wb.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wa[i-1] === wb[j-1]) {
      tokens.unshift({ text: wa[i-1], type: 'equal' }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      tokens.unshift({ text: wb[j-1], type: 'added' }); j--
    } else {
      tokens.unshift({ text: wa[i-1], type: 'removed' }); i--
    }
  }
  return tokens
}

function DiffView({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  return (
    <div className={styles.diffRow}>
      <div className={styles.diffCol}>
        <span className={styles.diffLabel}>HTR</span>
        <p className={styles.diffText}>
          {tokens.map((t, i) => t.type === 'removed'
            ? <span key={i} className={styles.removed}>{t.text}</span>
            : t.type === 'equal' ? <span key={i}>{t.text}</span> : null)}
        </p>
      </div>
      <div className={styles.diffCol}>
        <span className={styles.diffLabel}>corregido</span>
        <p className={styles.diffText}>
          {tokens.map((t, i) => t.type === 'added'
            ? <span key={i} className={styles.added}>{t.text}</span>
            : t.type === 'equal' ? <span key={i}>{t.text}</span> : null)}
        </p>
      </div>
    </div>
  )
}

function MetricBadge({ label, value, fmt = 'pct' }: { label: string; value: number; fmt?: 'pct' | 'score' }) {
  const display = fmt === 'pct' ? (value * 100).toFixed(2) + '%' : value.toFixed(2)
  const good = fmt === 'pct' ? value < 0.1 : value > 80
  const mid  = fmt === 'pct' ? value < 0.2 : value > 60
  const cls  = good ? styles.metricGood : mid ? styles.metricMid : styles.metricBad
  return (
    <div className={`${styles.metricBadge} ${cls}`}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{display}</span>
    </div>
  )
}

function GlobalStats({ docs }: { docs: DocResult[] }) {
  const allLines = docs.flatMap(d => d.lines.filter(l => l.status === 'done' && l.gt))
  if (!allLines.length) return null
  return (
    <div className={styles.globalStats}>
      <div className={styles.globalStatsHeader}>
        <span className={styles.panelLabel}>Estadísticas globales</span>
        <span className={styles.panelHint}>{docs.length} docs · {allLines.length} líneas</span>
      </div>
      <div className={styles.metricsRow}>
        <MetricBadge label="CER corpus" value={corpusCER(allLines)} />
        <MetricBadge label="WER corpus" value={corpusWER(allLines)} />
        <MetricBadge label="chrF" value={corpusChrF(allLines)} fmt="score" />
      </div>
    </div>
  )
}

export default function Home() {
  const [htrFiles, setHtrFiles]   = useState<File[]>([])
  const [gtFiles,  setGtFiles]    = useState<File[]>([])
  const [docs,     setDocs]       = useState<DocResult[]>([])
  const [running,  setRunning]    = useState(false)
  const [elapsed,  setElapsed]    = useState<string | null>(null)
  const [maxTokens, setMaxTokens] = useState(128)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const abortRef = useRef(false)

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const updateLine = useCallback((docIdx: number, lineIdx: number, patch: Partial<LineResult>) => {
    setDocs(prev => prev.map((d, di) => {
      if (di !== docIdx) return d
      const lines = d.lines.map((l, li) => li === lineIdx ? { ...l, ...patch } : l)
      const done = lines.filter(l => l.status === 'done' && l.gt)
      return { ...d, lines, cer: corpusCER(done), wer: corpusWER(done), chrf: corpusChrF(done) }
    }))
  }, [])

  async function readFile(f: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = e => res(e.target?.result as string)
      r.onerror = rej
      r.readAsText(f, 'utf-8')
    })
  }

  async function run() {
    if (running) { abortRef.current = true; return }
    if (!htrFiles.length) return
    abortRef.current = false
    setRunning(true)
    setElapsed(null)
    setExpanded(new Set())

    const initial: DocResult[] = []
    for (const hf of htrFiles) {
      const htrText = await readFile(hf)
      const htrLines = htrText.split('\n').filter(l => l.trim())
      const gtFile = gtFiles.find(g => g.name === hf.name)
      const gtLines = gtFile ? (await readFile(gtFile)).split('\n').filter(l => l.trim()) : []
      initial.push({
        name: hf.name, cer: 0, wer: 0, chrf: 0,
        lines: htrLines.map((orig, i) => ({
          original: orig, gt: gtLines[i] || '', output: '',
          status: 'pending', cer: 0, wer: 0, chrf: 0,
        }))
      })
    }
    setDocs(initial)

    const t0 = Date.now()
    let totalDone = 0
    const totalLines = initial.reduce((s, d) => s + d.lines.length, 0)

    for (let di = 0; di < initial.length; di++) {
      if (abortRef.current) break
      setExpanded(prev => { const s = new Set(prev); s.add(initial[di].name); return s; })
      for (let li = 0; li < initial[di].lines.length; li++) {
        if (abortRef.current) break
        updateLine(di, li, { status: 'running' })
        try {
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: initial[di].lines[li].original, max_new_tokens: maxTokens }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
          const output = data.output || ''
          const gt = initial[di].lines[li].gt
          updateLine(di, li, {
            status: 'done', output,
            cer: calcCER(output, gt), wer: calcWER(output, gt), chrf: calcChrF(output, gt),
          })
        } catch (e: any) {
          updateLine(di, li, { status: 'error', error: e.message, cer: 0, wer: 0, chrf: 0 })
        }
        totalDone++
        setElapsed(`${totalDone}/${totalLines} líneas · ${((Date.now()-t0)/1000).toFixed(1)}s`)
      }
    }
    setRunning(false)
  }

  function clear() {
    if (running) return
    setHtrFiles([]); setGtFiles([]); setDocs([]); setElapsed(null)
  }

  function exportTSV() {
    const rows = ['documento\tlínea\thtr\tcorregido\tgt\tcer\twer\tchrf']
    docs.forEach(d => d.lines.forEach((l, i) => {
      if (l.status === 'done')
        rows.push(`${d.name}\t${i+1}\t${l.original}\t${l.output}\t${l.gt}\t${(l.cer*100).toFixed(2)}\t${(l.wer*100).toFixed(2)}\t${l.chrf.toFixed(2)}`)
    }))
    const blob = new Blob([rows.join('\n')], { type: 'text/tsv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'resultados_paleografico.tsv'
    a.click()
  }

  const doneCount = docs.reduce((s, d) => s + d.lines.filter(l => l.status === 'done').length, 0)

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.ornament}>✦</div>
          <h1 className={styles.title}>Transcriptor Paleográfico</h1>
          <div className={styles.ornament}>✦</div>
        </div>
        <p className={styles.subtitle}>Evaluación por lotes · MT5 fine-tuneado · español s. XVI</p>
        <div className={styles.divider} />
      </header>

      <div className={styles.uploadGrid}>
        <div className={styles.uploadBox}>
          <div className={styles.uploadLabel}>
            <span className={styles.panelLabel}>Archivos HTR</span>
            <span className={styles.panelHint}>texto paleográfico .txt</span>
          </div>
          <input type="file" accept=".txt" multiple
            onChange={e => setHtrFiles(Array.from(e.target.files || []))}
            className={styles.fileInput} />
          {htrFiles.length > 0 && (
            <div className={styles.fileList}>
              {htrFiles.map(f => <span key={f.name} className={styles.fileTag}>{f.name}</span>)}
            </div>
          )}
        </div>
        <div className={styles.uploadBox}>
          <div className={styles.uploadLabel}>
            <span className={styles.panelLabel}>Archivos GT</span>
            <span className={styles.panelHint}>groundtruth (mismo nombre)</span>
          </div>
          <input type="file" accept=".txt" multiple
            onChange={e => setGtFiles(Array.from(e.target.files || []))}
            className={styles.fileInput} />
          {gtFiles.length > 0 && (
            <div className={styles.fileList}>
              {gtFiles.map(f => <span key={f.name} className={styles.fileTag}>{f.name}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className={styles.toolbar}>
        <button className={running ? styles.btnStop : styles.btnRun}
          onClick={run} disabled={!htrFiles.length && !running}>
          {running ? '◼ detener' : '▶ procesar lote'}
        </button>
        <button className={styles.btnSecondary} onClick={clear} disabled={running}>limpiar</button>
        {doneCount > 0 && (
          <button className={styles.btnGhost} onClick={exportTSV}>↓ exportar TSV</button>
        )}
        <label className={styles.controlLabel} style={{ marginLeft: 'auto' }}>
          Max tokens
          <input type="number" className={styles.numberInput}
            value={maxTokens} min={32} max={512}
            onChange={e => setMaxTokens(Number(e.target.value))} />
        </label>
        {elapsed && <span className={styles.stat}>{elapsed}</span>}
      </div>

      {doneCount > 0 && <GlobalStats docs={docs} />}

      {docs.map(doc => {
        const isOpen = expanded.has(doc.name)
        const doneLinesDoc = doc.lines.filter(l => l.status === 'done').length
        return (
          <div key={doc.name} className={styles.docBlock}>
            <div className={styles.docHeader} onClick={() => toggleExpand(doc.name)}>
              <div className={styles.docTitle}>
                <span className={styles.docArrow}>{isOpen ? '▾' : '▸'}</span>
                <span className={styles.docName}>{doc.name}</span>
                <span className={styles.panelHint}>{doneLinesDoc}/{doc.lines.length} líneas</span>
              </div>
              {doneLinesDoc > 0 && (
                <div className={styles.docMetrics}>
                  <MetricBadge label="CER" value={doc.cer} />
                  <MetricBadge label="WER" value={doc.wer} />
                  <MetricBadge label="chrF" value={doc.chrf} fmt="score" />
                </div>
              )}
            </div>
            {isOpen && (
              <div className={styles.docLines}>
                {doc.lines.map((l, li) => (
                  <div key={li} className={`${styles.lineBlock} ${styles['row_' + l.status]}`}>
                    <div className={styles.lineHeader}>
                      <span className={styles.lineNum}>línea {li + 1}</span>
                      {l.status === 'done' && l.gt && (
                        <div className={styles.lineMetrics}>
                          <span className={l.cer < 0.1 ? styles.metricOk : styles.metricWarn}>CER {(l.cer*100).toFixed(1)}%</span>
                          <span className={l.wer < 0.2 ? styles.metricOk : styles.metricWarn}>WER {(l.wer*100).toFixed(1)}%</span>
                          <span className={l.chrf > 70 ? styles.metricOk : styles.metricWarn}>chrF {l.chrf.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    {l.status === 'pending' && <p className={styles.pending}>en espera…</p>}
                    {l.status === 'running' && <p className={styles.running}><span className={styles.spinner} />procesando…</p>}
                    {l.status === 'done' && <DiffView original={l.original} corrected={l.output} />}
                    {l.status === 'error' && <p className={styles.errorText}>⚠ {l.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
