'use client'

import { useState, useRef, useCallback } from 'react'

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

// ── Métricas ──────────────────────────────────────────────────────────────────
function levenshtein(a: string[], b: string[]): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}
function calcCER(pred: string, ref: string): number {
  if (!ref) return pred ? 1 : 0
  return levenshtein(Array.from(pred), Array.from(ref)) / ref.length
}
function calcWER(pred: string, ref: string): number {
  const p = pred.trim().split(/\s+/), r = ref.trim().split(/\s+/)
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
    const predG = getNgrams(pred, ng), refG = getNgrams(ref, ng)
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
  const e = lines.reduce((s, l) => s + levenshtein(Array.from(l.output), Array.from(l.gt)), 0)
  const r = lines.reduce((s, l) => s + l.gt.length, 0)
  return r ? e / r : 0
}
function corpusWER(lines: LineResult[]): number {
  const e = lines.reduce((s, l) => s + levenshtein(l.output.trim().split(/\s+/), l.gt.trim().split(/\s+/)), 0)
  const r = lines.reduce((s, l) => s + l.gt.trim().split(/\s+/).length, 0)
  return r ? e / r : 0
}
function corpusChrF(lines: LineResult[]): number {
  const vals = lines.filter(l => l.gt).map(l => calcChrF(l.output, l.gt))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

// ── Diff ──────────────────────────────────────────────────────────────────────
function norm(s: string): string { return s.normalize('NFC').toLowerCase().trim() }

function diffWords(original: string, corrected: string): DiffToken[] {
  const aWords = original.trim().split(/\s+/).filter(Boolean)
  const bWords = corrected.trim().split(/\s+/).filter(Boolean)
  const aNorm = aWords.map(norm), bNorm = bWords.map(norm)
  const m = aWords.length, n = bWords.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aNorm[i-1] === bNorm[j-1]
        ? dp[i-1][j-1]
        : Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + 2)
    }
  const tokens: DiffToken[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aNorm[i-1] === bNorm[j-1]) {
      tokens.unshift({ text: bWords[j-1], type: 'equal' }); i--; j--
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i-1][j-1] + 2) {
      tokens.unshift({ text: bWords[j-1], type: 'added' })
      tokens.unshift({ text: aWords[i-1], type: 'removed' })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] + 1 <= dp[i-1][j] + 1)) {
      tokens.unshift({ text: bWords[j-1], type: 'added' }); j--
    } else {
      tokens.unshift({ text: aWords[i-1], type: 'removed' }); i--
    }
  }
  return tokens
}

// ── Estilos inline ────────────────────────────────────────────────────────────
const S = {
  removed: { textDecoration: 'line-through' as const, color: '#a32d2d', background: '#fcebeb', borderRadius: '2px', padding: '0 1px' },
  added:   { textDecoration: 'underline' as const, textUnderlineOffset: '3px', color: '#2d5a1b', background: '#e8f0e0', borderRadius: '2px', padding: '0 1px' },
}

function HTRCell({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  return (
    <p style={{ margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
      {tokens.map((t, i) => {
        const sp = i < tokens.length - 1 ? ' ' : ''
        if (t.type === 'removed') return <span key={i} style={S.removed}>{t.text}{sp}</span>
        if (t.type === 'equal')   return <span key={i}>{t.text}{sp}</span>
        return null
      })}
    </p>
  )
}

function CorrCell({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  return (
    <p style={{ margin: 0, lineHeight: 1.5 }}>
      {tokens.map((t, i) => {
        const sp = i < tokens.length - 1 ? ' ' : ''
        if (t.type === 'added') return <span key={i} style={S.added}>{t.text}{sp}</span>
        if (t.type === 'equal') return <span key={i}>{t.text}{sp}</span>
        return null
      })}
    </p>
  )
}

// ── Componentes UI ────────────────────────────────────────────────────────────
function MetricBadge({ label, value, fmt = 'pct' }: { label: string; value: number; fmt?: 'pct' | 'score' }) {
  const display = fmt === 'pct' ? (value * 100).toFixed(2) + '%' : value.toFixed(2)
  const good = fmt === 'pct' ? value < 0.1 : value > 80
  const mid  = fmt === 'pct' ? value < 0.2 : value > 60
  const bg   = good ? '#eaf3de' : mid ? '#faf0dc' : '#fcebeb'
  const color = good ? '#3b6d11' : mid ? '#8a5a0a' : '#a32d2d'
  const border = good ? '#639922' : mid ? '#c8922a' : '#e24b4a'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 14px', borderRadius: '6px', border: `1px solid ${border}`, background: bg, minWidth: '80px' }}>
      <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color, marginBottom: '2px' }}>{label}</span>
      <span style={{ fontSize: '16px', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace', color }}>{display}</span>
    </div>
  )
}

function GlobalStats({ docs }: { docs: DocResult[] }) {
  const all = docs.flatMap(d => d.lines.filter(l => l.status === 'done' && l.gt))
  if (!all.length) return null
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--parchment-dark)', marginBottom: '1.5rem', overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Estadísticas globales</span>
        <span style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{docs.length} docs · {all.length} líneas</span>
      </div>
      <div style={{ display: 'flex', gap: '12px', padding: '12px 14px', flexWrap: 'wrap' }}>
        <MetricBadge label="CER corpus" value={corpusCER(all)} />
        <MetricBadge label="WER corpus" value={corpusWER(all)} />
        <MetricBadge label="chrF" value={corpusChrF(all)} fmt="score" />
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function BatchPage() {
  const [htrFiles, setHtrFiles] = useState<File[]>([])
  const [gtFiles,  setGtFiles]  = useState<File[]>([])
  const [docs,     setDocs]     = useState<DocResult[]>([])
  const [running,  setRunning]  = useState(false)
  const [elapsed,  setElapsed]  = useState<string | null>(null)
  const [maxTokens, setMaxTokens] = useState(128)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const abortRef = useRef(false)

  function toggleExpand(name: string) {
    setExpanded(prev => {
      const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next
    })
  }

  const updateLine = useCallback((di: number, li: number, patch: Partial<LineResult>) => {
    setDocs(prev => prev.map((d, idx) => {
      if (idx !== di) return d
      const lines = d.lines.map((l, jdx) => jdx === li ? { ...l, ...patch } : l)
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
    abortRef.current = false; setRunning(true); setElapsed(null); setExpanded(new Set())

    const initial: DocResult[] = []
    for (const hf of htrFiles) {
      const htrLines = (await readFile(hf)).split('\n').filter(l => l.trim())
      const stem = (name: string) => name.replace(/.htr.txt$/i, '').replace(/.gt.txt$/i, '').replace(/.txt$/i, '')
      const gtFile   = gtFiles.find(g => stem(g.name) === stem(hf.name))
      const gtLines  = gtFile ? (await readFile(gtFile)).split('\n').filter(l => l.trim()) : []
      initial.push({
        name: hf.name, cer: 0, wer: 0, chrf: 0,
        lines: htrLines.map((orig, i) => ({ original: orig, gt: gtLines[i] || '', output: '', status: 'pending', cer: 0, wer: 0, chrf: 0 }))
      })
    }
    setDocs(initial)

    const t0 = Date.now()
    let totalDone = 0
    const totalLines = initial.reduce((s, d) => s + d.lines.length, 0)

    for (let di = 0; di < initial.length; di++) {
      if (abortRef.current) break
      setExpanded(prev => { const s = new Set(prev); s.add(initial[di].name); return s })
      for (let li = 0; li < initial[di].lines.length; li++) {
        if (abortRef.current) break
        updateLine(di, li, { status: 'running' })
        try {
          const res = await fetch('/api/transcribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: initial[di].lines[li].original, max_new_tokens: maxTokens }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
          const output = data.output || ''
          const gt = initial[di].lines[li].gt
          updateLine(di, li, { status: 'done', output, cer: calcCER(output, gt), wer: calcWER(output, gt), chrf: calcChrF(output, gt) })
        } catch (e: any) {
          updateLine(di, li, { status: 'error', error: e.message, cer: 0, wer: 0, chrf: 0 })
        }
        totalDone++
        setElapsed(`${totalDone}/${totalLines} · ${((Date.now()-t0)/1000).toFixed(1)}s`)
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
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/tsv' }))
    a.download = 'resultados.tsv'; a.click()
  }

  const doneCount = docs.reduce((s, d) => s + d.lines.filter(l => l.status === 'done').length, 0)

  const css = {
    main:       { maxWidth: '1100px', margin: '0 auto', padding: '1.5rem 1.5rem 3rem' } as React.CSSProperties,
    label:      { fontSize: '11px', fontWeight: 500, color: 'var(--ink-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
    hint:       { fontSize: '11px', color: 'var(--ink-faint)' },
    uploadGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' } as React.CSSProperties,
    uploadBox:  { border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--parchment)', padding: '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: '8px' },
    fileTag:    { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: 'var(--parchment-deep)', border: '1px solid var(--border-light)', color: 'var(--ink-muted)', fontFamily: 'JetBrains Mono, monospace' },
    toolbar:    { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0', borderTop: '1px solid var(--border-light)', marginBottom: '1rem', flexWrap: 'wrap' as const },
    btnRun:     { padding: '8px 24px', fontSize: '13px', background: 'var(--accent)', color: '#f5ede0', border: 'none', borderRadius: '5px', cursor: 'pointer' },
    btnStop:    { padding: '8px 24px', fontSize: '13px', background: 'transparent', color: 'var(--error)', border: '1px solid var(--error)', borderRadius: '5px', cursor: 'pointer' },
    btnSec:     { padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--ink-muted)', border: '1px solid var(--border-light)', borderRadius: '5px', cursor: 'pointer' },
    btnGhost:   { fontSize: '12px', padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-light)', borderRadius: '4px', color: 'var(--ink-muted)', cursor: 'pointer' },
    docBlock:   { border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '1rem', background: 'var(--parchment)', overflow: 'hidden' },
    docHeader:  { padding: '10px 14px', background: 'var(--parchment-dark)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', flexWrap: 'wrap' as const, gap: '8px' },
    // 3-column table
    tableWrap:  { overflowX: 'auto' as const },
    table:      { width: '100%', borderCollapse: 'collapse' as const, fontFamily: 'JetBrains Mono, monospace', fontSize: '12.5px' },
    thHtr:      { padding: '6px 12px', background: '#f5ede0', color: 'var(--ink-muted)', fontWeight: 500, fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--border-light)', width: '33%', textAlign: 'left' as const },
    thCorr:     { padding: '6px 12px', background: '#eaf3de', color: '#3b6d11', fontWeight: 500, fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--border-light)', width: '33%', textAlign: 'left' as const },
    thGt:       { padding: '6px 12px', background: 'var(--parchment-dark)', color: 'var(--ink-muted)', fontWeight: 500, fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', borderBottom: '1px solid var(--border-light)', width: '33%', textAlign: 'left' as const },
    tdHtr:      { padding: '6px 12px', borderBottom: '1px solid var(--border-light)', color: 'var(--ink-muted)', verticalAlign: 'top' as const, lineHeight: 1.5 },
    tdCorr:     { padding: '6px 12px', borderBottom: '1px solid var(--border-light)', color: 'var(--ink)', verticalAlign: 'top' as const, lineHeight: 1.5 },
    tdGt:       { padding: '6px 12px', borderBottom: '1px solid var(--border-light)', color: 'var(--ink-muted)', verticalAlign: 'top' as const, lineHeight: 1.5, fontStyle: 'italic' as const },
    tdMetrics:  { padding: '4px 12px', borderBottom: '1px solid var(--border-light)', color: 'var(--ink-faint)', fontSize: '11px', whiteSpace: 'nowrap' as const },
  }

  return (
    <main style={css.main}>
      <div style={css.uploadGrid}>
        <div style={css.uploadBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={css.label}>Archivos HTR</span>
            <span style={css.hint}>.htr.txt</span>
          </div>
          <input type="file" accept=".txt" multiple onChange={e => setHtrFiles(Array.from(e.target.files || []))} style={{ fontSize: '12px', color: 'var(--ink-muted)' }} />
          {htrFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {htrFiles.map(f => <span key={f.name} style={css.fileTag}>{f.name}</span>)}
            </div>
          )}
        </div>
        <div style={css.uploadBox}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={css.label}>Archivos GT</span>
            <span style={css.hint}>.gt.txt</span>
          </div>
          <input type="file" accept=".txt" multiple onChange={e => setGtFiles(Array.from(e.target.files || []))} style={{ fontSize: '12px', color: 'var(--ink-muted)' }} />
          {gtFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {gtFiles.map(f => <span key={f.name} style={css.fileTag}>{f.name}</span>)}
            </div>
          )}
        </div>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--ink-faint)', marginBottom: '1rem', marginTop: '-0.5rem' }}>
        Los archivos homólogos deben tener una estructura como por ejemplo{' '}
        <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px' }}>doc_1194.htr.txt</code>
        {' '}y{' '}
        <code style={{ fontFamily: 'JetBrains Mono, monospace', background: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: '3px' }}>doc_1194.gt.txt</code>
      </p>

      <div style={css.toolbar}>
        <button style={running ? css.btnStop : css.btnRun} onClick={run} disabled={!htrFiles.length && !running}>
          {running ? '◼ detener' : '▶ procesar lote'}
        </button>
        <button style={css.btnSec} onClick={clear} disabled={running}>limpiar</button>
        {doneCount > 0 && <button style={css.btnGhost} onClick={exportTSV}>↓ exportar TSV</button>}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ink-muted)', marginLeft: 'auto' }}>
          Max tokens
          <input type="number" value={maxTokens} min={32} max={512}
            onChange={e => setMaxTokens(Number(e.target.value))}
            style={{ width: '68px', padding: '4px 8px', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', background: 'var(--parchment-dark)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--ink)' }} />
        </label>
        {elapsed && <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{elapsed}</span>}
      </div>

      {doneCount > 0 && <GlobalStats docs={docs} />}

      {docs.map(doc => {
        const isOpen = expanded.has(doc.name)
        const doneLinesDoc = doc.lines.filter(l => l.status === 'done').length
        return (
          <div key={doc.name} style={css.docBlock}>
            <div style={css.docHeader} onClick={() => toggleExpand(doc.name)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--ink)', fontWeight: 500 }}>{doc.name}</span>
                <span style={css.hint}>{doneLinesDoc}/{doc.lines.length} líneas</span>
              </div>
              {doneLinesDoc > 0 && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <MetricBadge label="CER" value={doc.cer} />
                  <MetricBadge label="WER" value={doc.wer} />
                  <MetricBadge label="chrF" value={doc.chrf} fmt="score" />
                </div>
              )}
            </div>

            {isOpen && (
              <div style={css.tableWrap}>
                <table style={css.table}>
                  <thead>
                    <tr>
                      <th style={css.thHtr}>HTR original</th>
                      <th style={css.thCorr}>Corrección</th>
                      <th style={css.thGt}>Groundtruth</th>
                      <th style={{ ...css.thGt, width: 'auto', whiteSpace: 'nowrap' }}>Métricas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l, li) => (
                      <tr key={li} style={l.status === 'running' ? { background: '#f0e8dc' } : l.status === 'error' ? { background: '#fcebeb' } : {}}>
                        <td style={css.tdHtr}>
                          {l.status === 'done'
                            ? <HTRCell original={l.original} corrected={l.output} />
                            : <span style={{ fontStyle: 'italic' }}>{l.original}</span>}
                        </td>
                        <td style={css.tdCorr}>
                          {l.status === 'pending' && <span style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>en espera…</span>}
                          {l.status === 'running' && <span style={{ color: 'var(--accent)' }}>procesando…</span>}
                          {l.status === 'done' && <CorrCell original={l.original} corrected={l.output} />}
                          {l.status === 'error' && <span style={{ color: 'var(--error)' }}>⚠ {l.error}</span>}
                        </td>
                        <td style={css.tdGt}>{l.gt || '—'}</td>
                        <td style={css.tdMetrics}>
                          {l.status === 'done' && l.gt ? (
                            <span style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                              <span style={{ color: l.cer < 0.1 ? '#3b6d11' : '#8a5a0a' }}>CER {(l.cer*100).toFixed(1)}%</span>
                              <span style={{ color: l.wer < 0.2 ? '#3b6d11' : '#8a5a0a' }}>WER {(l.wer*100).toFixed(1)}%</span>
                              <span style={{ color: l.chrf > 70 ? '#3b6d11' : '#8a5a0a' }}>chrF {l.chrf.toFixed(1)}</span>
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
