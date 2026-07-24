# Transcriptor Paleográfico

App Next.js para normalizar texto paleográfico. Soporta dos modelos, seleccionables desde la UI:

- **mT5 (fine-tuneado)** — modelo propio, servido desde un HF Space (Gradio).
- **LatamGPT (70B)** — [`latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0`](https://huggingface.co/latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0), usado como revisor vía prompt (no está fine-tuneado para esta tarea, así que el resultado depende del prompt de sistema en `app/api/transcribe/route.ts`).

## Arquitectura

```
Vercel (Next.js) → /api/transcribe → { mT5: HF Space (Gradio) | LatamGPT: HF Inference Endpoint propio }
```

Los tokens de HF **nunca llegan al navegador** — viven como variables de entorno en Vercel.

## ⚠️ Importante sobre LatamGPT

`latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0` es un modelo de **71B parámetros** y, a la fecha, **no tiene ningún Inference Provider serverless activo en HF** (no existe una API gratuita tipo la del Space de mT5). Para usarlo en producción necesitas desplegarlo tú mismo en una de estas opciones:

1. **HF Inference Endpoints (recomendado, de pago)** — desde la página del modelo en HF, botón "Deploy → Inference Endpoints". Requiere ~140GB de VRAM en BF16 (ej. 2× A100 80GB), por lo que tiene un costo por hora de GPU considerable. HF Inference Endpoints expone automáticamente una ruta OpenAI-compatible `/v1/chat/completions`, que es la que espera este proyecto.
2. **Space propio con TGI o vLLM** — más barato si usas un Space con GPU y `text-generation-inference` o `vllm serve`, ambos exponen `/v1/chat/completions`.
3. **Versión cuantizada (GGUF)** — si el costo de VRAM es un problema, existen conversiones GGUF de terceros (ej. `Pragmir/LatamGPT-70B-GGUF`) que puedes servir con `llama.cpp`/`ollama` en menos VRAM, aunque no son mantenidas oficialmente por el equipo de LatamGPT.

Mientras no configures `LATAMGPT_ENDPOINT_URL`, el selector de LatamGPT en la app devolverá un error explicando esto — el resto de la app (mT5) sigue funcionando normal.

## Variables de entorno

```bash
# mT5 (Space existente)
HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx          # solo si el Space es privado

# LatamGPT (tu propio Endpoint/Space)
LATAMGPT_ENDPOINT_URL=https://tu-endpoint.endpoints.huggingface.cloud   # sin barra final ni /v1/...
LATAMGPT_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx     # si no se define, se reusa HF_TOKEN
LATAMGPT_MODEL_ID=latam-gpt/Llama-3.1-70B-LatamGPT-SFT-1.0  # opcional, es el valor por defecto
LATAMGPT_SYSTEM_PROMPT=...                 # opcional, para ajustar el criterio de normalización
```

## Desarrollo local

```bash
npm install

# Crea .env.local con tus credenciales
cp .env.local.example .env.local
# Edita .env.local con tus variables

npm run dev
# → http://localhost:3000
```

## Deploy en Vercel

1. Sube el proyecto a GitHub
2. Importa el repo en [vercel.com](https://vercel.com)
3. En **Settings → Environment Variables** añade las variables de arriba (como mínimo `HF_TOKEN`; añade las de `LATAMGPT_*` cuando tengas el Endpoint desplegado)
4. Deploy

## Subir el modelo mT5 a HF Hub

```bash
pip install huggingface_hub
huggingface-cli login

# Sube tu checkpoint
huggingface-cli upload TU_USUARIO/mt5-htr-paleografico ./checkpoint-best
```

Si el modelo es privado, el token de HF necesita permisos de lectura (`read`).
