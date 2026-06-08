import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { text, max_new_tokens = 128 } = await req.json()

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 })
  }

  const modelId = process.env.HF_MODEL_ID
  const token = process.env.HF_TOKEN

  if (!modelId || !token) {
    return NextResponse.json(
      { error: 'HF_MODEL_ID or HF_TOKEN not configured' },
      { status: 500 }
    )
  }

  const hfUrl = `https://api-inference.huggingface.co/models/${modelId}`

  try {
    const hfRes = await fetch(hfUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: text,
        parameters: {
          max_new_tokens,
          num_beams: 4,
          early_stopping: true,
        },
        options: { wait_for_model: true },
      }),
    })

    if (!hfRes.ok) {
      const err = await hfRes.json().catch(() => ({}))
      return NextResponse.json(
        { error: (err as any).error || `HF error ${hfRes.status}` },
        { status: hfRes.status }
      )
    }

    const data = await hfRes.json()

    // HF seq2seq returns [{ generated_text: "..." }]
    let output = ''
    if (Array.isArray(data) && data[0]?.generated_text !== undefined) {
      output = data[0].generated_text
    } else if (data?.generated_text) {
      output = data.generated_text
    } else {
      output = JSON.stringify(data)
    }

    return NextResponse.json({ output })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
