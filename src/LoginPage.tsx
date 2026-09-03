import React, { FormEvent, useState } from 'react';
import logo from './assets/logo.png';

type LoginPageProps = {
  apiBase: string;
  onAuthenticated: (token: string, user: any) => void;
};

export default function LoginPage({
  apiBase,
  onAuthenticated
}: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Escribe tu correo y contraseña.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token) {
        throw new Error(data?.error || 'No se pudo iniciar sesión.');
      }

      onAuthenticated(data.token, data.user);
    } catch (err: any) {
      setError(err?.message || 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-8">
      <section className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-300/60 border border-white">
        <div className="bg-gradient-to-br from-sky-600 to-blue-800 px-8 pt-9 pb-14 text-center">
          <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-3xl bg-white p-3 shadow-xl">
            <img
              src={logo}
              alt="CliniqOne"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            CliniqOne
          </h1>
          <p className="mt-2 text-sm text-sky-100">
            Acceso a tu plataforma
          </p>
        </div>

        <form onSubmit={submit} className="-mt-7 rounded-t-3xl bg-white px-7 pb-8 pt-8">
          <label className="block text-sm font-semibold text-slate-700">
            Correo electrónico
          </label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="usuario@correo.com"
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
          />

          <label className="mt-5 block text-sm font-semibold text-slate-700">
            Contraseña
          </label>
          <div className="relative mt-2">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tu contraseña"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-20 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-3 text-sm font-semibold text-sky-700"
            >
              {showPassword ? 'Ocultar' : 'Ver'}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-sky-600 px-4 py-3.5 font-bold text-white shadow-lg shadow-sky-200 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </button>

          <p className="mt-6 text-center text-xs text-slate-400">
            Plataforma CliniqOne
          </p>
        </form>
      </section>
    </main>
  );
}
