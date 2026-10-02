import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { user, ready };
}

export function AuthPanel() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { data, error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password: pass })
      : await supabase.auth.signUp({ email, password: pass, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setMsg(error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : error.message);
    else if (mode === "up" && !data.session) setMsg("Te enviamos un email para confirmar tu cuenta.");
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) setMsg("No se pudo iniciar sesión con Google.");
  };

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6">
      <h2 className="font-display text-lg font-bold">{mode === "in" ? "Iniciá sesión" : "Creá tu cuenta"}</h2>
      <p className="mb-4 text-sm text-muted-foreground">Guardá tus autos en la nube y vé tu garaje en cualquier dispositivo.</p>
      <button onClick={google} className="w-full rounded-md border border-border py-2 text-sm font-semibold transition hover:border-primary">
        Continuar con Google
      </button>
      <div className="my-4 text-center text-xs text-muted-foreground">o con email</div>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <input type="password" required minLength={6} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Contraseña"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
        <button disabled={busy} className="w-full rounded-md bg-primary py-2 font-display text-xs font-bold tracking-widest text-primary-foreground disabled:opacity-50">
          {busy ? "…" : mode === "in" ? "ENTRAR" : "REGISTRARME"}
        </button>
      </form>
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-4 text-sm text-primary">
        {mode === "in" ? "¿No tenés cuenta? Registrate" : "¿Ya tenés cuenta? Iniciá sesión"}
      </button>
    </div>
  );
}
