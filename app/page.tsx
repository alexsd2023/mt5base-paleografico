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

function norm(s: string): string {
  return s.normalize('NFC').toLowerCase().trim()
}

function diffWords(original: string, corrected: string): DiffToken[] {
  const aWords = original.trim().split(/\s+/).filter(Boolean)
  const bWords = corrected.trim().split(/\s+/).filter(Boolean)
  const aNorm = aWords.map(norm)
  const bNorm = bWords.map(norm)
  const m = aWords.length, n = bWords.length

  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      if (aNorm[i-1] === bNorm[j-1]) {
        dp[i][j] = dp[i-1][j-1]
      } else {
        dp[i][j] = Math.min(
          dp[i-1][j] + 1,
          dp[i][j-1] + 1,
          dp[i-1][j-1] + 2
        )
      }
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

// Fila original: palabras eliminadas en rojo tachado, resto normal
function OrigLine({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  return (
    <p style={{ margin: 0, lineHeight: 1.5, fontFamily: 'inherit', fontSize: 'inherit', fontStyle: 'italic' }}>
      {tokens.map((t, i) => {
        const space = i < tokens.length - 1 ? ' ' : ''
        if (t.type === 'removed')
          return <span key={i} style={{ textDecoration: 'line-through', color: '#a32d2d', background: '#fcebeb', borderRadius: '2px', padding: '0 1px' }}>{t.text}{space}</span>
        if (t.type === 'equal')
          return <span key={i}>{t.text}{space}</span>
        return null
      })}
    </p>
  )
}

// Fila corregida: palabras nuevas en verde subrayado, resto normal
function CorrLine({ original, corrected }: { original: string; corrected: string }) {
  const tokens = diffWords(original, corrected)
  return (
    <p style={{ margin: 0, lineHeight: 1.5, fontFamily: 'inherit', fontSize: 'inherit' }}>
      {tokens.map((t, i) => {
        const space = i < tokens.length - 1 ? ' ' : ''
        if (t.type === 'added')
          return <span key={i} style={{ textDecoration: 'underline', textUnderlineOffset: '3px', color: '#2d5a1b', background: '#e8f0e0', borderRadius: '2px', padding: '0 1px' }}>{t.text}{space}</span>
        if (t.type === 'equal')
          return <span key={i}>{t.text}{space}</span>
        return null
      })}
    </p>
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
    const initial: LineResult[] = lines.map(l => ({
      original: l, output: '', status: 'pending'
    }))
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
      const s = ((Date.now() - t0) / 1000).toFixed(1)
      setElapsed(`${i + 1}/${lines.length} líneas · ${s}s`)
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
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.ornament}>✦</div>
          <h1 className={styles.title}>Transcriptor Paleográfico</h1>
          <p className={styles.subtitle}>
            Normalización de manuscritos históricos · MT5 fine-tuneado
          </p>
          <div className={styles.ornament}>✦</div>
        </div>
        <div className={styles.divider} />
      </header>

      <div className={styles.controls}>
        <label className={styles.controlLabel}>
          Tokens máx.
          <input
            type="number"
            className={styles.numberInput}
            value={maxTokens}
            min={32}
            max={512}
            onChange={e => setMaxTokens(Number(e.target.value))}
          />
        </label>
        <button className={styles.btnGhost} onClick={() => setInput(EXAMPLE)}>
          cargar ejemplo
        </button>
      </div>

      <div className={styles.columns}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>Texto paleográfico</span>
            <span className={styles.panelHint}>una oración por línea</span>
          </div>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder='Pega o añade el texto aquí…'
            spellCheck={false}
          />
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>Texto normalizado</span>
            {doneCount > 0 && (
              <button className={styles.btnGhost} onClick={copyAll}>copiar todo</button>
            )}
          </div>
          <div className={styles.outputScroll} ref={outputRef}>
            {results.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyGlyph}>⟿</span>
                <span>el resultado aparecerá aquí</span>
              </div>
            ) : (
              results.map((r, i) => (
                <div
                  key={i}
                  data-row={i}
                  className={`${styles.lineRow} ${styles[`row_${r.status}`]}`}
                >
                  <div className={styles.lineOrig}>
                    {r.status === 'done'
                      ? <OrigLine original={r.original} corrected={r.output} />
                      : r.original}
                  </div>
                  <div className={styles.lineOut}>
                    {r.status === 'pending' && (
                      <span className={styles.pending}>en espera…</span>
                    )}
                    {r.status === 'running' && (
                      <span className={styles.running}>
                        <span className={styles.spinner} />
                        procesando…
                      </span>
                    )}
                    {r.status === 'done' && (
                      <CorrLine original={r.original} corrected={r.output} />
                    )}
                    {r.status === 'error' && (
                      <span className={styles.errorText}>⚠ {r.error}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button
          className={running ? styles.btnStop : styles.btnRun}
          onClick={run}
          disabled={!input.trim() && !running}
        >
          {running ? '◼ detener' : '▶ transcribir'}
        </button>
        <button className={styles.btnSecondary} onClick={clear} disabled={running}>
          limpiar
        </button>
        {elapsed && <span className={styles.stat}>{elapsed}</span>}
      </div>
    </main>
  )
}
