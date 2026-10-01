import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import { z } from "zod";

const RUN_ID = "X-Lovable-AIG-Run-ID";

export const buildSchema = z.object({
  name: z.string(),
  category: z.enum(["normal", "deportivo", "super"]),
  layout: z.enum(["I3", "I4", "I6", "V6", "V8", "V10", "V12", "W16"]),
  displacement: z.number(),
  aspiration: z.enum(["atmosferico", "turbo", "biturbo", "compresor"]),
  maxRpm: z.number(),
  boost: z.number(),
  gearbox: z.enum(["manual", "automatica", "doble-embrague"]),
  gears: z.number(),
  finalDrive: z.number(),
  drive: z.enum(["FWD", "RWD", "AWD"]),
  material: z.enum(["acero", "aluminio", "carbono"]),
  tires: z.enum(["eco", "deportivo", "semi-slick"]),
  downforce: z.number(),
  body: z.enum(["sedan", "coupe", "hiper"]),
  color: z.string(),
  accent: z.string(),
  wheelColor: z.string(),
  spoiler: z.boolean(),
  stripes: z.boolean(),
  wheelSize: z.number(),
  explanation: z.string(),
});

const SYSTEM = `Sos un ingeniero automotriz. A partir de la descripción del usuario, diseñá una configuración de auto compatible y coherente.
Reglas de compatibilidad (obligatorias):
- normal: layout I3/I4/I6/V6, cilindrada 1.0–3.0 L, maxRpm 5000–7000.
- deportivo: layout I4/I6/V6/V8, cilindrada 1.6–5.0 L, maxRpm 6000–8500.
- super: layout V8/V10/V12/W16, cilindrada 3.0–8.0 L, maxRpm 7000–9500.
- boost 0–1 (presión del turbo; usar 0.5 si es atmosférico). gears 4–8 enteros. finalDrive 2.5–4.6.
- downforce 0–1. wheelSize 15–22 enteros. Colores en hex #rrggbb.
- Elegí tracción y caja coherentes con la potencia (mucha potencia → AWD o RWD con semi-slick).
- name: nombre corto creativo (máx 24 caracteres). explanation: 2-3 frases en español explicando las decisiones.`;

export async function generateBuild(description: string, apiKey: string) {
  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(RUN_ID, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      return res;
    },
  });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system: SYSTEM,
    prompt: description,
    maxRetries: 0,
    output: Output.object({ schema: buildSchema }),
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  return await result.output;
}
