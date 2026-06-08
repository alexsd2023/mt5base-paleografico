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

const EXAMPLE = `q̃ no̊ ay otro remedio sino la muertte
dize q̃ la gente desta tierra esta muy alcãçada
fue p̃sso enla çibdad de toledo
el dho don rodrigo de çisneros vesino dela dha villa
por ser cosa tan necessaria e importante al seruicio de su mag̃d`

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

      // scroll to current line
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
    setInput('')
    setResults([])
    setElapsed(null)
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
        {/* Input panel */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>Texto paleográfico</span>
            <span className={styles.panelHint}>una oración por línea</span>
          </div>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={`Pega el texto paleográfico aquí.\n\nCada línea se procesará de\nforma independiente.`}
            spellCheck={false}
          />
        </div>

        {/* Output panel */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelLabel}>Texto normalizado</span>
            {doneCount > 0 && (
              <button className={styles.btnGhost} onClick={copyAll}>
                copiar todo
              </button>
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
                  <div className={styles.lineOrig}>{r.original}</div>
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
                    {r.status === 'done' && r.output}
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
