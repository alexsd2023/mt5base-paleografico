import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export type ModelId = 'mt5' | 'latamgpt'

// Prompt de sistema para que LatamGPT (modelo de chat de propósito general, no
// fine-tuneado para HTR) actúe como revisor paleográfico. Ajusta este texto a
// tus propios criterios de normalización (qué se expande, qué se conserva, etc).
const LATAMGPT_SYSTEM_PROMPT =
  process.env.LATAMGPT_SYSTEM_PROMPT ||
  `Eres un paleógrafo experto en documentos manuscritos hispanoamericanos de los siglos XVI-XVIII.
Se te entrega una línea de texto tal como fue transcrita por un sistema HTR (Handwritten Text Recognition), que puede contener:
- Abreviaturas y signos de suspensión/contracción marcados con tilde (ej: "q̃" = "que", "dho" = "dicho", "mag̃d" = "magestad").
- Grafías antiguas (ç, ss, uu por v, etc.) y errores propios del reconocimiento automático.

Tu tarea es revisar y normalizar la línea: expande abreviaturas y suspensiones a su forma completa, corrige errores evidentes de reconocimiento, y conserva la ortografía histórica salvo cuando sea claramente un error del HTR.
Responde ÚNICAMENTE con la línea corregida, sin explicaciones, comillas ni texto adicional.`

// ── mT5 fine-tuneado (HF Space vía Gradio) ─────────────────────────────────
async function callMT5(text: string, maxNewTokens: number): Promise<string> {
  const token = process.env.HF_TOKEN
  const baseUrl = 'https://alezsd-mt5-htr-paleografico.hf.space'

  const callRes = await fetch(`${baseUrl}/gradio_api/call/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      data: [text, maxNewTokens, 4],
    }),
  })

  if (!callRes.ok) {
    const err = await callRes.json().catch(() => ({}))
    throw new Error(`Space error ${callRes.status}: ${JSON.stringify(err)}`)
  }

  const { event_id } = await callRes.json()

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

  return output
}

// ── LatamGPT (latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0) ───────────────────
// Este modelo no tiene Inference Provider serverless en HF (es un chat model
// de 70B). Debes desplegarlo tú mismo como HF Inference Endpoint dedicado, o
// en un Space propio con TGI/vLLM, y apuntar LATAMGPT_ENDPOINT_URL a esa base
// URL (debe exponer una ruta OpenAI-compatible /v1/chat/completions, que es
// el estándar de TGI/vLLM/Inference Endpoints).
async function callLatamGPT(text: string, maxNewTokens: number): Promise<string> {
  const endpoint = process.env.LATAMGPT_ENDPOINT_URL
  const token = process.env.LATAMGPT_TOKEN || process.env.HF_TOKEN
  const modelId = process.env.LATAMGPT_MODEL_ID || 'latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0'

  if (!endpoint) {
    throw new Error(
      'LATAMGPT_ENDPOINT_URL no está configurado. Despliega el modelo latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0 en un HF Inference Endpoint (o Space propio con TGI/vLLM) y añade la variable de entorno con la URL base del endpoint. Ver README.md.'
    )
  }

  const url = endpoint.replace(/\/$/, '') + '/v1/chat/completions'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: LATAMGPT_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: maxNewTokens,
      temperature: 0.2,
      top_p: 0.9,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`LatamGPT endpoint error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const output: string = data?.choices?.[0]?.message?.content ?? ''
  return output.trim()
}

export async function POST(req: NextRequest) {
  const { text, max_new_tokens = 128, model = 'mt5' } = (await req.json()) as {
    text?: string
    max_new_tokens?: number
    model?: ModelId
  }

  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 })
  }

  try {
    const output =
      model === 'latamgpt' ? await callLatamGPT(text, max_new_tokens) : await callMT5(text, max_new_tokens)

    return NextResponse.json({ output, model })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
