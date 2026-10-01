import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateBuild } from "./ai-build.server";

export const aiDesignCar = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ description: z.string().trim().min(5).max(800) }).parse(d))
  .handler(async ({ data }) => {
    const key = process.env['LOVABLE_API_KEY'];
    if (!key) return { ok: false as const, error: "La IA no está configurada." };
    try {
      const build = await generateBuild(data.description, key);
      return { ok: true as const, build };
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode;
      const error =
        status === 429 ? "Demasiadas solicitudes, esperá un momento e intentá de nuevo."
        : status === 402 ? "Se agotaron los créditos de IA del espacio de trabajo."
        : status === 403 ? "El acceso a la IA fue denegado."
        : "No se pudo generar el diseño. Intentá con otra descripción.";
      console.error("aiDesignCar", status, e);
      return { ok: false as const, error };
    }
  });
