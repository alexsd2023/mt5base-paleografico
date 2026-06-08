import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { text, max_new_tokens = 128 } = await req.json()

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 })
  }

  const spaceId = process.env.HF_SPACE_ID  // alezsd/mt5-htr-paleografico
  const token   = process.env.HF_TOKEN

  if (!spaceId) {
    return NextResponse.json({ error: 'HF_SPACE_ID not configured' }, { status: 500 })
  }

  // Gradio API endpoint
  const url = `https://${spaceId.replace('/', '-')}.hf.space/run/predict`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        data: [text, max_new_tokens, 4],  // [input_text, max_tokens, num_beams]
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as any).error || `Space error ${res.status}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    // Gradio devuelve { data: ["resultado"] }
    const output = data?.data?.[0] ?? ''

    return NextResponse.json({ output })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
