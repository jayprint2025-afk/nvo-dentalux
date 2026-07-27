import React, { useEffect, useMemo, useState } from 'react';
import MultiSucursalWrapper from './MultiSucursalWrapper';
import LoginPage from './LoginPage';

const TOKEN_KEY = 'dentalux_auth_token';
const USER_KEY = 'dentalux_auth_user';

function getApiBase() {
  return String(
    import.meta.env.VITE_API_BASE ||
    'https://nvo-dentalux.onrender.com'
  ).replace(/\/$/, '');
}

export default function AuthGate() {
  const apiBase = useMemo(getApiBase, []);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  });
  const [checking, setChecking] = useState(Boolean(token));

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken('');
    setUser(null);
    setChecking(false);
  };

  const authenticated = (newToken: string, newUser: any) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser || null));
    setToken(newToken);
    setUser(newUser || null);
    setChecking(false);
  };

  useEffect(() => {
    const handleExpiredSession = () => logout();
    window.addEventListener('dentalux:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('dentalux:auth-expired', handleExpiredSession);
  }, []);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }

    let cancelled = false;

    fetch(`${apiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit'
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.user) {
          throw new Error(data?.error || 'Sesión inválida');
        }
        if (!cancelled) {
          setUser(data.user);
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-6 shadow-xl text-slate-700">
          Verificando sesión…
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <LoginPage apiBase={apiBase} onAuthenticated={authenticated} />;
  }

  return (
    <div className="relative">
      <div className="fixed right-4 top-4 z-[9999] flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-bold text-slate-800">{user?.name}</p>
          <p className="text-[11px] text-slate-500">{user?.tenant?.name}</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-950"
        >
          Cerrar sesión
        </button>
      </div>
      <MultiSucursalWrapper />
    </div>
  );
}
