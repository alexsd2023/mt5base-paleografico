'use client'

import { useState, useRef, useCallback } from 'react'
import styles from './page.module.css'

type LineStatus = 'idle' | 'pending' | 'running' | 'done' | 'error'

interface LineResult {
  original: string
  output: string
  status: LineStatus
  error?: string
}

type DiffToken = { text: string; type: 'equal' | 'removed' | 'added' }

const EXAMPLE = `q̃ no̊ ay otro remedio sino la muertte
dize q̃ la gente desta tierra esta muy alcãçada
fue p̃sso enla çibdad de toledo
el dho don rodrigo de çisneros vesino dela dha villa
por ser cosa tan necessaria e importante al seruicio de su mag̃d`

function normalize(s: string): string {
  return s.normalize("NFC").trim()
}

function diffWords(original: string, corrected: string): DiffToken[] {
  const a = normalize(original).split(/(\s+)/)
  const b = normalize(corrected).split(/(\s+)/)
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  const tokens: DiffToken[] = []
  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      tokens.unshift({ text: a[i-1], type: 'equal' }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      tokens.unshift({ text: b[j-1], type: 'added' }); j--
    } else {
      tokens.unshift({ text: a[i-1], type: 'removed' }); i--
    }
  }
  return tokens
}

function DiffView({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  const hasChanges = tokens.some(t => t.type !== 'equal')
  return (
    <div className={styles.diffRow}>
      <div className={styles.diffCol}>
        <span className={styles.diffLabel}>original</span>
        <p className={styles.diffText}>
          {tokens.map((t, i) => t.type === 'removed'
            ? <span key={i} className={styles.removed}>{t.text}</span>
            : t.type === 'equal' ? <span key={i}>{t.text}</span> : null)}
        </p>
      </div>
      <div className={styles.diffCol}>
        <span className={styles.diffLabel}>
          corregido {hasChanges && <span className={styles.diffBadge}>con cambios</span>}
        </span>
        <p className={styles.diffText}>
          {tokens.map((t, i) => t.type === 'added'
            ? <span key={i} className={styles.added}>{t.text}</span>
            : t.type === 'equal' ? <span key={i}>{t.text}</span> : null)}
        </p>
      </div>
    </div>
  )
}

export default function Home() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<LineResult[]>([])
  const [running, setRunning] = useState(false)
  const [maxTokens, setMaxTokens] = useState(128)
  const [elapsed, setElapsed] = useState<string | null>(null)
  const abortRef = useRef(false)
  const outputRef = useRef<HTMLDivElement>(null)

  const updateLine = useCallback((index: number, patch: Partial<LineResult>) => {
    setResults(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }, [])

  async function run() {
    if (running) { abortRef.current = true; return }
    const lines = input.split('\n').filter(l => l.trim())
    if (!lines.length) return
    const initial: LineResult[] = lines.map(l => ({ original: l, output: '', status: 'pending' }))
    setResults(initial)
    setRunning(true)
    setElapsed(null)
    abortRef.current = false
    const t0 = Date.now()
    for (let i = 0; i < lines.length; i++) {
      if (abortRef.current) break
      updateLine(i, { status: 'running' })
      setTimeout(() => {
        const el = outputRef.current?.querySelectorAll('[data-row]')[i]
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: lines[i], max_new_tokens: maxTokens }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
        updateLine(i, { status: 'done', output: data.output })
      } catch (e: any) {
        updateLine(i, { status: 'error', error: e.message, output: '' })
      }
      setElapsed(`${i + 1}/${lines.length} líneas · ${((Date.now()-t0)/1000).toFixed(1)}s`)
    }
    setRunning(false)
  }

  function clear() {
    if (running) return
    setInput(''); setResults([]); setElapsed(null)
  }

  function copyAll() {
    const text = results.filter(r => r.status === 'done').map(r => r.output).join('\n')
    navigator.clipboard.writeText(text)
  }

  const doneCount = results.filter(r => r.status === 'done').length

  return (
    <main className={styles.main}>
      <div className={styles.controls}>
        <label className={styles.controlLabel}>
          Tokens máx.
          <input type="number" className={styles.numberInput}
            value={maxTokens} min={32} max={512}
            onChange={e => setMaxTokens(Number(e.target.value))} />
        </label>
        <button className={styles.btnGhost} onClick={() => setInput(EXAMPLE)}>cargar ejemplo</button>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelLabel}>Texto paleográfico</span>
          <span className={styles.panelHint}>una oración por línea</span>
        </div>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={'Pega el texto paleográfico aquí.\n\nCada línea se procesará de forma independiente.'}
          spellCheck={false}
        />
      </div>

      <div className={styles.toolbar}>
        <button className={running ? styles.btnStop : styles.btnRun}
          onClick={run} disabled={!input.trim() && !running}>
          {running ? '◼ detener' : '▶ transcribir'}
        </button>
        <button className={styles.btnSecondary} onClick={clear} disabled={running}>limpiar</button>
        {doneCount > 0 && <button className={styles.btnGhost} onClick={copyAll}>copiar corregido</button>}
        {elapsed && <span className={styles.stat}>{elapsed}</span>}
      </div>

      {results.length > 0 && (
        <div className={styles.outputSection} ref={outputRef}>
          <div className={styles.outputHeader}>
            <span className={styles.panelLabel}>Resultado</span>
            <span className={styles.panelHint}>
              <span className={styles.removedLegend}>tachado</span> = original ·{' '}
              <span className={styles.addedLegend}>subrayado</span> = corregido
            </span>
          </div>
          {results.map((r, i) => (
            <div key={i} data-row={i} className={`${styles.resultBlock} ${styles['row_' + r.status]}`}>
              <div className={styles.lineNum}>línea {i + 1}</div>
              {r.status === 'pending' && <p className={styles.pending}>en espera…</p>}
              {r.status === 'running' && <p className={styles.running}><span className={styles.spinner} />procesando…</p>}
              {r.status === 'done' && <DiffView original={r.original} corrected={r.output} />}
              {r.status === 'error' && <p className={styles.errorText}>⚠ {r.error}</p>}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
