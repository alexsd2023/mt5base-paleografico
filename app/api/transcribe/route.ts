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
    // Paso 1: lanzar la llamada, obtener event_id
    const callRes = await fetch(`${baseUrl}/gradio_api/call/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        data: [text, max_new_tokens, 4],
      }),
    })

    if (!callRes.ok) {
      const err = await callRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: `Space error ${callRes.status}: ${JSON.stringify(err)}` },
        { status: callRes.status }
      )
    }

    const { event_id } = await callRes.json()

    // Paso 2: leer el resultado via SSE
    const streamRes = await fetch(`${baseUrl}/gradio_api/call/transcribe/${event_id}`, {
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
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6))
            if (Array.isArray(parsed) && parsed.length > 0) {
              output = parsed[0]
              reader.cancel()
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
