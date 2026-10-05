import { useRef, useState } from 'react';
import type { Group } from 'three';
import { Upload, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { importVehicle, disposeVehicle } from '@/lib/vehicle-model';

export function VehicleImport({ onModel, hasModel }: { onModel: (model: Group | null) => void; hasModel: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const upload = async (files: File[]) => {
    setLoading(true); setError('');
    try {
      const result = await importVehicle(files);
      disposeVehicle(result.preview);
      onModel(result.scene);
      setName(files.find(f => /\.(glb|gltf)$/i.test(f.name))?.name ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir el modelo.'); }
    finally { setLoading(false); if (input.current) input.current.value = ''; }
  };
  return <div className="space-y-2 border-t border-border p-3">
    <input ref={input} type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" className="hidden" aria-label="Archivos del modelo 3D" onChange={e => void upload(Array.from(e.target.files ?? []))}/>
    <Button variant="outline" className="w-full justify-start rounded-none whitespace-normal text-xs" disabled={loading} onClick={() => input.current?.click()}><Upload/>{loading ? 'Cargando…' : 'Importar auto 3D'}</Button>
    {hasModel && <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{name}</span><Button size="icon" variant="ghost" aria-label="Volver al auto temporal" title="Volver al auto temporal" onClick={() => { onModel(null); setName(''); }}><RotateCcw/></Button></div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}