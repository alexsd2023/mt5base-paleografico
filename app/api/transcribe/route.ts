import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { text, max_new_tokens = 128 } = await req.json()

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 })
  }

  const token = process.env.HF_TOKEN
  const baseUrl = 'https://alezsd-mt5-htr-paleografico.hf.space'

  try {
    // Paso 1: iniciar el job en la queue de Gradio 5
    const queueRes = await fetch(`${baseUrl}/queue/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        data: [text, max_new_tokens, 4],
        fn_index: 0,
        session_hash: Math.random().toString(36).slice(2),
      }),
    })

    if (!queueRes.ok) {
      // Fallback: intentar con /run/predict directo
      const predictRes = await fetch(`${baseUrl}/run/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          data: [text, max_new_tokens, 4],
          fn_index: 0,
        }),
      })

      if (!predictRes.ok) {
        const err = await predictRes.json().catch(() => ({}))
        return NextResponse.json(
          { error: `Space error ${predictRes.status}: ${JSON.stringify(err)}` },
          { status: predictRes.status }
        )
      }

      const predictData = await predictRes.json()
      const output = predictData?.data?.[0] ?? ''
      return NextResponse.json({ output })
    }

    const queueData = await queueRes.json()
    const eventId = queueData?.event_id

    if (!eventId) {
      return NextResponse.json({ error: 'No event_id from queue' }, { status: 500 })
    }

    // Paso 2: esperar resultado via SSE
    const streamRes = await fetch(`${baseUrl}/queue/data?session_hash=${queueData.session_hash}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

    const reader = streamRes.body?.getReader()
    const decoder = new TextDecoder()
    let output = ''

    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6))
            if (parsed.msg === 'process_completed') {
              output = parsed.output?.data?.[0] ?? ''
              reader.cancel()
              break
            }
          } catch {}
        }
      }
    }

    return NextResponse.json({ output })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
