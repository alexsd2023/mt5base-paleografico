# Transcriptor Paleográfico

App Next.js para normalizar texto paleográfico usando un modelo MT5 fine-tuneado en Hugging Face.

## Arquitectura

```
Vercel (Next.js) → /api/transcribe → HF Inference API → tu modelo HF
```

El token de HF **nunca llega al navegador** — vive como variable de entorno en Vercel.

## Desarrollo local

```bash
npm install

# Crea .env.local con tus credenciales
cp .env.local.example .env.local
# Edita .env.local con tu HF_MODEL_ID y HF_TOKEN

npm run dev
# → http://localhost:3000
```

## Deploy en Vercel

1. Sube el proyecto a GitHub
2. Importa el repo en [vercel.com](https://vercel.com)
3. En **Settings → Environment Variables** añade:
   - `HF_MODEL_ID` → `tu-usuario/nombre-del-modelo`
   - `HF_TOKEN` → `hf_xxxxxxxxxxxxxxxxxxxx`
4. Deploy

## Subir el modelo a HF Hub

```bash
pip install huggingface_hub
huggingface-cli login

# Sube tu checkpoint
huggingface-cli upload TU_USUARIO/mt5-htr-paleografico ./checkpoint-best
```

Si el modelo es privado, el token de HF necesita permisos de lectura (`read`).
