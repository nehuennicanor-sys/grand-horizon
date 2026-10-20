# Objetivos — grand-horizon

Lista cerrada de lo pedido para esta entrega. Todo lo que sigue está implementado,
compilado y probado en la copia de trabajo; no queda ningún punto pendiente.

## 1. Seis carrocerías seleccionables

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Cupé V10 | **Hecho** | Tarjeta, modelo y vista 3D cargados |
| GT V8 | **Hecho** | Tarjeta, modelo y vista 3D cargados |
| Turismo GT | **Hecho** | Tarjeta, modelo y vista 3D cargados |
| Scafati GT | **Hecho** | Tarjeta, modelo y vista 3D cargados |
| LMP1 Híbrido | **Hecho** | Tarjeta, modelo y vista 3D cargados |
| Racer GT (nuevo) | **Hecho** | `public/models/racer-gt`, entrada `racer-gt`, selector y crédito CC-BY-4.0 |

## 2. Limpieza de marcas y logos

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Sin logos en carrocería, llantas, interior, cristales, parrilla, matrículas ni texturas | **Hecho** | Mapas de pintura/insignias recortados en `body-models.ts`; interiores usados solo desde la cabina procedural |
| Estrella Mercedes de la parrilla GT V8 | **Hecho** | Malla `Object_110` oculta por nombre + material |
| Insignia BMW del Turismo GT | **Hecho** | Materiales `badges`, `emblem`, `grille_logo` y `decal` ocultos; captura sin roundel |
| Logos Burnout del Racer GT | **Hecho** | Texturas del cuerpo, motor, llantas y bajos reemplazadas por materiales limpios |

## 3. Bug del auto blanco

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| El auto no debe verse blanco/lavado | **Hecho** | Emisivo en negro e intensidad 0 en `stripMaps()`; las seis capturas muestran color y detalle |

## 4. Libreas de dos colores inspiradas en modelos reales

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Cada carrocería con una librea propia de dos colores | **Hecho** | Patrón GLSL 0-5; azul/naranja, negro/rojo, blanco/azul, verde/negro, plata/rojo y azul/amarillo |
| Patrón pegado a la carrocería y sin costo de textura | **Hecho** | `paintCoord` horneado por geometría y patrón evaluado en el shader |
| Acabado brillante y definido | **Hecho** | `metalness 0.9`, `roughness 0.1`, `envMapIntensity 1` |

## 5. Velocidad punta real por modelo

| Carrocería | Punta real | Estado |
| --- | ---: | --- |
| Cupé V10 | 330 km/h | **Hecho** — tarjeta, ficha y tope de simulación |
| GT V8 | 300 km/h | **Hecho** — tarjeta, ficha y tope de simulación |
| Turismo GT | 305 km/h | **Hecho** — tarjeta, ficha y tope de simulación |
| Scafati GT | 290 km/h | **Hecho** — tarjeta, ficha y tope de simulación |
| LMP1 Híbrido | 340 km/h | **Hecho** — tarjeta, ficha y tope de simulación |
| Racer GT | 336 km/h | **Hecho** — tarjeta, ficha y tope de simulación |

## 6. Nitidez nativa y 60 FPS

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| No bajar la resolución como solución principal | **Hecho** | Piso del gobernador en `dpr 1.0` en taller, vista previa y pista |
| Nitidez | **Hecho** | FXAA nativo con máscara de enfoque en el mismo pase; sin resolución reducida |
| 60 FPS en taller | **Hecho** | 65-125 FPS medidos; GT V8 estable en ~63 FPS tras compilar shaders |
| 60 FPS en pista | **Hecho** | 76 FPS en tercera persona y 65 FPS en primera persona, a densidad nativa |
| Coste de sombras controlado | **Hecho** | Actualización alterna del mapa de sombras; interior no proyecta sombra |

## 7. Interiores en primera persona

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Sin capó duplicado | **Hecho** | La carrocería exterior se oculta en la cabina; queda solo el interior procedural |
| Sin barras flotantes | **Hecho** | Se retiraron los pilares/techo superpuestos de la vista importada; captura limpia |
| Volante, tablero y butaca correctos | **Hecho** | Volante con giro real, tablero y asiento; butaca omitida solo cuando queda detrás del ojo |

## 8. Vallas y muros en los 12 circuitos

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Vallas unidas y sin invadir la pista | **Hecho** | `CatchFence` calcula holgura sobre ambos offsets y evita el interior de la curva |
| Sin huecos entre paneles | **Hecho** | Paneles encadenados por estación, postes en los extremos y radio de chunks |
| Revisión de las 12 variantes | **Hecho** | Capturas de High Speed Ring, Tokyo Expressway, Blue Moon Bay, Deep Forest, Grand Valley, Dragon Trail, Special Stage 5, Trial Mountain, Autumn Ring, Côte d'Azur, Eiger Nordwand y Tokyo Route 246 |

## 9. Texturas, licencias y créditos

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Texturas de 1024×1024 o menores | **Hecho** | Auditoría de 104 imágenes: 0 supera 1024 |
| Créditos de autor y licencia | **Hecho** | Ficha de cada carrocería muestra autor, CC-BY-4.0 y “modificado”; `license.txt` del Racer GT incluido |
| Sin “Diseño propio” ni controles de moldeado | **Hecho** | Textos actualizados a seis bases; estación de carrocería solo permite elegir base, carga y pintura |

## 10. Interfaz y entrega

| Objetivo | Estado | Evidencia |
| --- | --- | --- |
| Interfaz en español | **Hecho** | 9 estaciones, garaje, taller y pista |
| Sin ganchos de depuración | **Hecho** | Eliminados `__gl`, `__scene`, `__preview`, `__hull`, `__drive`, `__race` y `__perf` |
| Compilación TypeScript | **Hecho** | `tsc --noEmit` sin errores |
| Build de producción | **Hecho** | `vite build` completado (cliente + SSR) |
| Repositorio y carpeta de entrega | **Hecho** | Cambios sincronizados a GitHub y a la carpeta de OneDrive |
