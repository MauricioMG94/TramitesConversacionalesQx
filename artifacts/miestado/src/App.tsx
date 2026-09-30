import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity, ArrowLeft, ArrowRight, Bell, Building2, CalendarDays, Car, Check, CheckCircle2,
  ChevronRight, CircleAlert, ClipboardCheck, Clock3, CreditCard, ExternalLink, FileCheck2,
  FileText, HelpCircle, History, Inbox, LayoutDashboard, LockKeyhole, LogOut, Mail, MapPin,
  Menu, MessageCircle, PanelLeft, ReceiptText, RefreshCw, RotateCcw, Route as RouteIcon, Search,
  Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, UploadCloud, UserRound,
  WalletCards, X, type LucideIcon,
} from 'lucide-react';
import {
  Link, Route, Switch, Router as WouterRouter, useLocation, Redirect,
} from 'wouter';

// ─────────────────────────────────────────
// Configuracion: URL base del backend FastAPI
// Se puede sobreescribir con VITE_API_BASE en .env del frontend.
// ─────────────────────────────────────────
const API_BASE: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE as string) ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8888'
    : '');

// ─────────────────────────────────────────
// AuthContext: token JWT, datos del usuario, login/logout.
// Persistencia minima en localStorage (la expiracion la controla el backend).
// ─────────────────────────────────────────
type AuthUser = {
  id_usuario: string;
  correo: string;
  nombre_completo: string;
  rol: string;
  estado: string;
};

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  login: (correo: string, contrasena: string) => Promise<void>;
  logout: () => void;
};

const TOKEN_KEY = 'miestado.token';
const USER_KEY = 'miestado.user';

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialToken = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
  const initialUser = useMemo<AuthUser | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }, []);

  const [state, setState] = useState<AuthState>({
    user: initialUser,
    token: initialToken,
    loading: false,
    error: null,
  });

  const persist = useCallback((token: string | null, user: AuthUser | null) => {
    if (typeof window === 'undefined') return;
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  }, []);

  const login = useCallback(async (correo: string, contrasena: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const body = new URLSearchParams();
      body.set('username', correo);
      body.set('password', contrasena);
      const resp = await fetch(`${API_BASE}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        credentials: 'omit',
      });
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => ({} as Record<string, unknown>))).detail;
        const message = typeof detail === 'string' ? detail : 'No fue posible iniciar sesion.';
        setState((prev) => ({ ...prev, loading: false, error: message }));
        throw new Error(message);
      }
      const tokenData = (await resp.json()) as { access_token: string; token_type: string };
      const meResp = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!meResp.ok) {
        throw new Error('Token recibido pero /me no respondio.');
      }
      const user = (await meResp.json()) as AuthUser;
      persist(tokenData.access_token, user);
      setState({ user, token: tokenData.access_token, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido.';
      setState((prev) => ({ ...prev, loading: false, error: message }));
      throw err;
    }
  }, [persist]);

  const logout = useCallback(() => {
    persist(null, null);
    setState({ user: null, token: null, loading: false, error: null });
  }, [persist]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  // PING inicial para confirmar que el token guardado sigue siendo valido.
  useEffect(() => {
    if (!state.token) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${state.token}` } })
      .then((resp) => {
        if (cancelled) return;
        if (!resp.ok) {
          persist(null, null);
          setState({ user: null, token: null, loading: false, error: null });
        }
      })
      .catch(() => {
        // silencioso: la red puede estar caida; no cerrar sesion por eso.
      });
    return () => {
      cancelled = true;
    };
  }, [state.token, persist]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─────────────────────────────────────────
// requireAuth: HOC que protege una vista y redirige a /login si no hay sesion.
// ─────────────────────────────────────────
function RequireAuth({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!loading && !token) navigate('/login');
  }, [loading, token, navigate]);
  if (!token) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-[#6D7890]">
        Redirigiendo a inicio de sesion...
      </div>
    );
  }
  return <>{children}</>;
}

// ─────────────────────────────────────────
// Login: formulario minimo que llama al backend.
// ─────────────────────────────────────────
function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [correo, setCorreo] = useState('admin@miestado.local');
  const [contrasena, setContrasena] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!correo.trim() || !contrasena) return;
    setSubmitting(true);
    try {
      await login(correo.trim(), contrasena);
      navigate('/inicio');
    } catch {
      // El mensaje de error ya queda en el AuthContext y se muestra abajo.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F6F8FC] text-[#172033]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <Logo />
        <Link href="/" className="text-sm font-bold text-[#173BFF]">
          Volver al inicio
        </Link>
      </header>
      <main className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.1fr_.9fr]">
        <section>
          <p className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#173BFF]">
            <span className="h-px w-8 bg-[#173BFF]" /> Acceso seguro
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-[.94] tracking-[-.05em] sm:text-5xl">
            Inicia sesion para entrar al piloto.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[#67748D]">
            Esta plataforma conversa con tu ciudad. Necesitamos saber quien eres para
            consultar tus datos oficiales y dejar constancia de cada paso.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#DEE5F1] bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-[#173BFF]">
                <ShieldCheck size={18} />
                <span className="text-sm font-bold">Identidad verificada</span>
              </div>
              <p className="text-xs leading-5 text-[#68748A]">
                Tu correo y contrasena viajan cifrados al backend y nunca se exponen a
                servicios externos.
              </p>
            </div>
            <div className="rounded-2xl border border-[#DEE5F1] bg-white p-5">
              <div className="mb-3 flex items-center gap-2 text-[#08784E]">
                <LockKeyhole size={18} />
                <span className="text-sm font-bold">Consentimiento explícito</span>
              </div>
              <p className="text-xs leading-5 text-[#68748A]">
                Antes de cada consulta sensible, te pediremos confirmacion visible en la
                conversacion.
              </p>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-[#DEE5F1] bg-white p-6 shadow-sm sm:p-9">
          <h2 className="font-display text-2xl font-bold">Entrar</h2>
          <p className="mt-1 text-sm text-[#7C879B]">
            Usa el usuario sembrado por el backend (admin@miestado.local) o uno creado
            por un administrador.
          </p>
          <form className="mt-7 space-y-4" onSubmit={onSubmit} data-testid="form-login">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[.12em] text-[#8792A6]">
                Correo
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-[#DDE4F0] bg-white px-3 py-2.5 focus-within:border-[#173BFF]">
                <Mail size={16} className="text-[#7C879B]" />
                <input
                  type="email"
                  name="username"
                  autoComplete="username"
                  required
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  data-testid="input-login-correo"
                  placeholder="tu@correo.com"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[.12em] text-[#8792A6]">
                Contrasena
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-[#DDE4F0] bg-white px-3 py-2.5 focus-within:border-[#173BFF]">
                <LockKeyhole size={16} className="text-[#7C879B]" />
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={contrasena}
                  onChange={(e) => setContrasena(e.target.value)}
                  data-testid="input-login-contrasena"
                  placeholder="********"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={submitting}
              data-testid="button-login"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#173BFF] px-5 py-3 text-sm font-bold text-white shadow-[0_7px_18px_rgba(23,59,255,.18)] transition-all hover:-translate-y-0.5 hover:bg-[#315CFF] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Verificando...' : 'Iniciar sesion'}
            </button>
            <LoginError />
            <p className="text-center text-[11px] text-[#98A1B1]">
              API backend: <code className="rounded bg-[#EFF2F7] px-1.5 py-0.5">{API_BASE || 'no configurada'}</code>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}

function LoginError() {
  const { error } = useAuth();
  if (!error) return null;
  return (
    <p data-testid="status-login-error" className="rounded-xl bg-[#FFF0EF] px-3 py-2 text-xs font-bold text-[#C8463C]">
      {error}
    </p>
  );
}

const queryClient = new QueryClient();

const blue = '#173BFF';
const quickActions = [
  { label: 'Impuesto vehicular', detail: 'Consulta y paga', icon: ReceiptText, href: '/impuesto', tint: 'bg-[#E8EDFF] text-[#173BFF]' },
  { label: 'Renovar licencia', detail: 'Agenda tu cita', icon: CalendarDays, href: '/licencia', tint: 'bg-[#DDF9F5] text-[#087E78]' },
  { label: 'Verificar un mensaje', detail: 'Revisa su origen', icon: ShieldCheck, href: '/verificar', tint: 'bg-[#FFF1D0] text-[#986A00]' },
];

function PilotPill({ compact = false }: { compact?: boolean }) {
  return <div data-testid="disclosure-pilot" className={`inline-flex items-center gap-2 rounded-full border border-[#C9D4EE] bg-white/80 px-3 py-1.5 text-[11px] font-semibold tracking-[.02em] text-[#55627D] ${compact ? '' : 'shadow-sm'}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-[#00C2B8]" /> Piloto · datos simulados
  </div>;
}

function Logo({ light = false }: { light?: boolean }) {
  return <Link href="/" data-testid="link-logo" className={`group flex items-center gap-2.5 ${light ? 'text-white' : 'text-[#172033]'}`}>
    <span className={`grid h-9 w-9 place-items-center rounded-[11px] ${light ? 'bg-white text-[#173BFF]' : 'bg-[#173BFF] text-white'} shadow-sm`}>
      <RouteIcon size={19} strokeWidth={2.5} />
    </span>
    <span className="font-display text-[19px] font-extrabold tracking-[-.04em]">MiEstado</span>
  </Link>;
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return <button type="button" aria-label={label} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`} onClick={onClick} className="grid h-10 w-10 place-items-center rounded-xl border border-[#DDE3F0] bg-white text-[#53617B] hover:border-[#B8C6E3] hover:text-[#173BFF]">{children}</button>;
}

function Button({ children, variant = 'primary', onClick, href, icon: Icon, testId, disabled = false }: { children: ReactNode; variant?: 'primary' | 'soft' | 'outline' | 'danger'; onClick?: () => void; href?: string; icon?: LucideIcon; testId?: string; disabled?: boolean }) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${variant === 'primary' ? 'bg-[#173BFF] text-white shadow-[0_7px_18px_rgba(23,59,255,.18)] hover:-translate-y-0.5 hover:bg-[#315CFF]' : variant === 'soft' ? 'bg-[#E9EDFF] text-[#173BFF] hover:bg-[#DCE4FF]' : variant === 'danger' ? 'bg-[#FFF0EF] text-[#C8463C] hover:bg-[#FFE2DF]' : 'border border-[#D8E0EE] bg-white text-[#32405B] hover:border-[#AABBE1] hover:text-[#173BFF]'}`;
  if (href) return <Link href={href} data-testid={testId ?? 'link-action'} className={cls}>{children}{Icon && <Icon size={16} />}</Link>;
  return <button type="button" disabled={disabled} data-testid={testId ?? 'button-action'} onClick={onClick} className={`${cls} disabled:cursor-not-allowed disabled:opacity-50`}>{children}{Icon && <Icon size={16} />}</button>;
}

function Status({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'yellow' | 'coral' | 'slate' }) {
  const tones = { blue: 'bg-[#E9EDFF] text-[#173BFF]', green: 'bg-[#DDF8ED] text-[#08784E]', yellow: 'bg-[#FFF2CE] text-[#946900]', coral: 'bg-[#FFF0EF] text-[#C8463C]', slate: 'bg-[#EFF2F7] text-[#5E6A82]' };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tones[tone]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>{eyebrow && <p className="mb-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#173BFF]">{eyebrow}</p>}<h1 data-testid="text-page-title" className="font-display text-3xl font-extrabold tracking-[-.045em] text-[#172033] sm:text-[38px]">{title}</h1>{description && <p className="mt-2 max-w-2xl text-[15px] leading-6 text-[#68748A]">{description}</p>}</div>
    {action}
  </div>;
}

function EmptyState({ icon: Icon, title, copy, action }: { icon: LucideIcon; title: string; copy: string; action?: ReactNode }) {
  return <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-[#C9D4E6] bg-white p-8 text-center"><div><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#EDF1FF] text-[#173BFF]"><Icon size={22} /></div><h3 className="font-display text-lg font-bold text-[#172033]">{title}</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#768198]">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuth();
  const entity = location.startsWith('/entidad');
  const nav = entity ? [
    { href: '/entidad', label: 'Resumen', icon: LayoutDashboard },
    { href: '/entidad/bandeja', label: 'Bandeja', icon: Inbox },
    { href: '/entidad/servicios', label: 'Servicios', icon: Activity },
  ] : [
    { href: '/inicio', label: 'Inicio', icon: LayoutDashboard },
    { href: '/asistente', label: 'Asistente', icon: MessageCircle },
    { href: '/tramites', label: 'Mis trámites', icon: ClipboardCheck },
    { href: '/explorar', label: 'Explorar', icon: Search },
  ];
  const active = (href: string) => location === href || (href !== '/inicio' && location.startsWith(href));

  const initials = useMemo(() => {
    if (!user) return 'K';
    const parts = user.nombre_completo.trim().split(/\s+/);
    const first = parts[0]?.slice(0, 1) ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.slice(0, 1) ?? '' : '';
    const result = (first + last).toUpperCase() || 'K';
    return result;
  }, [user]);

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };
  return <div className="min-h-[100dvh] bg-[#F6F8FC]">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col bg-[#173BFF] px-5 py-6 text-white lg:flex">
      <div className="mb-10 flex items-center justify-between"><Logo light /><IconButton label="contraer menú" onClick={() => setMobileOpen(false)}><PanelLeft size={17} /></IconButton></div>
      <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-[#B7C3FF]">{entity ? 'Vista entidad' : 'Tu espacio'}</div>
      <nav className="space-y-1">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active(href) ? 'bg-white text-[#173BFF] shadow-lg shadow-[#0928AE]/20' : 'text-[#E3E7FF] hover:bg-[#315CFF]'}`}><Icon size={18} />{label}</Link>)}</nav>
      {!entity && <div className="mt-8 border-t border-[#5272FF] pt-7"><p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-[#B7C3FF]">Más espacios</p><Link href="/notificaciones" data-testid="link-nav-notificaciones" className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active('/notificaciones') ? 'bg-white text-[#173BFF]' : 'text-[#E3E7FF] hover:bg-[#315CFF]'}`}><Bell size={18} />Notificaciones<span className="ml-auto rounded-full bg-[#FFC83D] px-1.5 py-0.5 text-[10px] text-[#684800]">2</span></Link><Link href="/perfil" data-testid="link-nav-perfil" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[#E3E7FF] hover:bg-[#315CFF]"><UserRound size={18} />Mi perfil</Link><Link href="/ayuda" data-testid="link-nav-ayuda" className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active('/ayuda') ? 'bg-white text-[#173BFF]' : 'text-[#E3E7FF] hover:bg-[#315CFF]'}`}><HelpCircle size={18} />Ayuda</Link><Link href="/entidad" data-testid="link-nav-entidad" className="mt-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[#E3E7FF] hover:bg-[#315CFF]"><Building2 size={18} />Vista de entidad</Link></div>}
      <div className="mt-auto rounded-2xl border border-[#5B76FF] bg-[#2549FF] p-4"><div className="mb-3 flex items-center gap-2 text-[#DDE3FF]"><ShieldCheck size={15} /><span className="text-xs font-bold">Entorno protegido</span></div><p className="text-[11px] leading-5 text-[#C9D3FF]">Tus decisiones quedan bajo tu control. Este es un piloto con datos simulados.</p></div>
    </aside>
    {mobileOpen && <div className="fixed inset-0 z-50 bg-[#172033]/35 lg:hidden" onClick={() => setMobileOpen(false)}><div className="h-full w-[280px] bg-[#173BFF] p-5 text-white" onClick={(e) => e.stopPropagation()}><div className="mb-10 flex justify-between"><Logo light /><IconButton label="cerrar menú" onClick={() => setMobileOpen(false)}><X size={18} /></IconButton></div>{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[#E3E7FF]"><Icon size={18} />{label}</Link>)}{!entity && <Link href="/ayuda" onClick={() => setMobileOpen(false)} data-testid="mobile-menu-ayuda" className="mt-3 flex items-center gap-3 rounded-xl border-t border-[#5272FF] px-3 pt-5 text-sm font-semibold text-[#E3E7FF]"><HelpCircle size={18} />Ayuda</Link>}</div></div>}
    <div className="lg:pl-[252px]"><header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#E6EAF2] bg-[#F6F8FC]/90 px-5 backdrop-blur-md sm:px-8"><div className="flex items-center gap-3"><button type="button" aria-label="abrir menú" data-testid="button-abrir-menu" className="text-[#45526B] lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={22} /></button><span className="hidden h-2 w-2 rounded-full bg-[#00C2B8] sm:block" /><span className="text-xs font-semibold text-[#6D7890]">{entity ? 'Secretaría de Movilidad' : 'Medellín, Antioquia'}</span></div><div className="flex items-center gap-3"><PilotPill compact /><Link href="/notificaciones" data-testid="link-notificaciones-header" className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#DDE3F0] bg-white text-[#53617B]"><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#FF6B5E]" /></Link><Link href={entity ? '/entidad' : '/perfil'} data-testid="link-avatar-header" className="grid h-9 w-9 place-items-center rounded-full bg-[#FFC83D] font-display text-sm font-extrabold text-[#6F5000]">{entity ? 'SM' : initials}</Link>{user && (<button type="button" onClick={handleLogout} data-testid="button-logout" aria-label="cerrar sesión" className="ml-1 flex items-center gap-1.5 rounded-xl border border-[#DDE3F0] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#53617B] hover:border-[#C8463C] hover:text-[#C8463C]"><LogOut size={13} /><span className="hidden sm:inline">Salir</span></button>)}</div></header><main className="mx-auto max-w-[1440px] px-5 py-8 pb-24 sm:px-8 lg:px-10 lg:pb-10">{children}</main></div>
    <nav className="fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-2xl border border-[#DDE3F0] bg-white/95 p-2 shadow-[0_10px_35px_rgba(23,32,51,.12)] backdrop-blur lg:hidden">{(entity ? nav : [...nav, { href: '/notificaciones', label: 'Avisos', icon: Bell }]).slice(0, 5).map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`mobile-nav-${href}`} className={`flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-bold ${active(href) ? 'text-[#173BFF]' : 'text-[#8791A5]'}`}><Icon size={18} />{label}</Link>)}</nav>
  </div>;
}

function Landing() {
  const [demoOpen, setDemoOpen] = useState(false);
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const handleLogout = () => { logout(); navigate('/'); };
  return <div className="min-h-[100dvh] overflow-hidden bg-[#F6F8FC] text-[#172033]">
    <header className="relative z-20 mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8"><Logo /><div className="hidden items-center gap-7 text-sm font-semibold text-[#61708B] md:flex"><Link href="/como-funciona" data-testid="link-landing-como-funciona">Cómo funciona</Link><Link href="/explorar" data-testid="link-landing-explorar">Explorar trámites</Link><Link href="/demo" data-testid="link-landing-demo">Ver demo</Link></div><div className="flex items-center gap-3"><PilotPill compact />{user ? (<><span data-testid="status-landing-user" className="hidden text-xs font-bold text-[#53617B] sm:inline">Hola, {user.nombre_completo.split(' ')[0]}</span><Button href="/inicio" testId="link-landing-entrar">Entrar al piloto</Button><button type="button" onClick={handleLogout} data-testid="button-landing-logout" className="rounded-xl border border-[#DDE3F0] bg-white px-3 py-2.5 text-sm font-bold text-[#53617B] hover:border-[#C8463C] hover:text-[#C8463C]">Salir</button></>) : (<Button href="/login" testId="link-landing-login">Iniciar sesión</Button>)}</div></header>
    <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:pb-28 lg:pt-20"><div className="relative z-10 animate-rise"><p className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#173BFF]"><span className="h-px w-8 bg-[#173BFF]" />Un nuevo lenguaje para lo público</p><h1 className="max-w-3xl font-display text-[clamp(3.5rem,7vw,6.8rem)] font-extrab800 leading-[.94] tracking-[-.075em] text-[#172033]">Lo público,<br /><span className="text-[#173BFF]">más claro.</span></h1><p className="mt-8 max-w-xl text-lg leading-8 text-[#67748D]">MiEstado convierte trámites complejos en una conversación que puedes entender, preparar y seguir. Sin perder de vista quién valida cada paso.</p><div className="mt-9 flex flex-wrap items-center gap-3"><Button href="/asistente" icon={ArrowRight} testId="link-landing-empezar">Cuéntame qué necesitas</Button><button type="button" data-testid="button-landing-preview" onClick={() => setDemoOpen(true)} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#42506A] hover:bg-white"><MessageCircle size={17} />Ver conversación</button></div><div className="mt-12 flex items-center gap-6 text-xs font-semibold text-[#7A8499]"><span className="flex items-center gap-2"><ShieldCheck size={16} className="text-[#18C98B]" />Identidad verificada</span><span className="flex items-center gap-2"><LockKeyhole size={15} className="text-[#173BFF]" />Consentimiento visible</span></div></div>
      <div className="relative min-h-[470px] animate-rise [animation-delay:.15s]"><div className="absolute -right-20 top-4 h-72 w-72 rounded-full bg-[#DDF9F5] blur-3xl" /><div className="absolute bottom-0 left-0 h-48 w-48 rounded-full bg-[#FFF0D0] blur-3xl" /><div className="relative mx-auto max-w-[470px] rotate-[2deg] rounded-[28px] border border-[#D7DFEF] bg-white p-4 shadow-[0_25px_70px_rgba(23,59,255,.13)]"><div className="flex items-center justify-between border-b border-[#EEF1F6] px-2 pb-4"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#E9EDFF] text-[#173BFF]"><MessageCircle size={16} /></span><div><p className="text-xs font-bold">Asistente MiEstado</p><p className="text-[10px] text-[#78849A]">Listo para acompañarte</p></div></div><span className="rounded-full bg-[#DDF8ED] px-2 py-1 text-[10px] font-bold text-[#08784E]">En línea</span></div><div className="space-y-4 px-2 py-5"><div className="max-w-[285px] rounded-2xl rounded-tl-sm bg-[#F0F3F9] p-4 text-sm leading-6 text-[#42506A]">Hola, Kevin. Puedo ayudarte a resolver un trámite de principio a fin. ¿Qué necesitas hacer hoy?</div><div className="ml-auto max-w-[270px] rounded-2xl rounded-tr-sm bg-[#173BFF] p-4 text-sm leading-6 text-white">Quiero pasar mi carro de Montería a Medellín.</div><div className="max-w-[315px] rounded-2xl rounded-tl-sm border border-[#DDE7FF] bg-[#F5F7FF] p-4 text-sm leading-6 text-[#42506A]">Entendido. Encontré tu Chevrolet Onix ABC123. Te mostraré los pasos y pediré tu permiso antes de consultar fuentes oficiales.</div></div><div className="flex items-center gap-2 rounded-xl bg-[#F6F8FC] p-2"><span className="flex-1 px-2 text-xs text-[#98A1B1]">Escribe tu necesidad...</span><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#173BFF] text-white"><Send size={14} /></span></div></div><div className="absolute -bottom-5 -left-6 rounded-2xl border border-[#D7DFEF] bg-white p-4 shadow-[0_15px_35px_rgba(23,32,51,.1)]"><div className="mb-2 flex items-center gap-2 text-xs font-bold"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#DDF8ED] text-[#08784E]"><CheckCircle2 size={15} /></span>Fuente oficial consultada</div><p className="pl-9 text-[11px] text-[#738098]">RUNT · hace un momento</p></div></div></section>
    <section className="border-y border-[#E6EAF2] bg-white"><div className="mx-auto grid max-w-7xl gap-0 px-5 sm:px-8 md:grid-cols-3"><div className="border-b border-[#E6EAF2] px-0 py-8 md:border-b-0 md:border-r md:pr-10"><p className="mb-3 font-mono text-xs font-bold text-[#173BFF]">01 / Entender</p><h2 className="font-display text-xl font-bold">Una intención, no un formulario.</h2><p className="mt-2 text-sm leading-6 text-[#758097]">Dices qué necesitas en tus palabras. Nosotros ordenamos el camino.</p></div><div className="border-b border-[#E6EAF2] px-0 py-8 md:border-b-0 md:border-r md:px-10"><p className="mb-3 font-mono text-xs font-bold text-[#00A79E]">02 / Preparar</p><h2 className="font-display text-xl font-bold">Cada requisito a la vista.</h2><p className="mt-2 text-sm leading-6 text-[#758097]">Documentos, fuentes y decisiones explicadas antes de actuar.</p></div><div className="px-0 py-8 md:pl-10"><p className="mb-3 font-mono text-xs font-bold text-[#CC8700]">03 / Seguir</p><h2 className="font-display text-xl font-bold">Un radicado que cuenta la historia.</h2><p className="mt-2 text-sm leading-6 text-[#758097]">Consulta el avance y la trazabilidad cuando quieras.</p></div></div></section>
    <footer className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-9 text-xs text-[#7C879B] sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>MiEstado · piloto de GovTech conversacional</span><span>Diseñado para acompañar, no para reemplazar a las entidades.</span></footer>
    {demoOpen && <Modal title="Una conversación con contexto" onClose={() => setDemoOpen(false)}><div className="space-y-3 text-sm leading-6 text-[#59667E]"><div className="rounded-2xl bg-[#F0F3F9] p-4">Hola, Kevin. ¿Qué trámite público quieres resolver?</div><div className="ml-8 rounded-2xl bg-[#E9EDFF] p-4 text-[#173BFF]">Necesito pasar mi carro de Montería a Medellín.</div><div className="rounded-2xl bg-[#F0F3F9] p-4">Voy a revisar lo necesario y te pediré consentimiento antes de consultar tus datos. Así sabrás qué ocurre en cada paso.</div></div><div className="mt-6"><Button href="/asistente" onClick={() => setDemoOpen(false)} icon={ArrowRight}>Continuar en el asistente</Button></div></Modal>}
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-[#172033]/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-[0_25px_80px_rgba(23,32,51,.24)] sm:p-8"><div className="mb-6 flex items-start justify-between"><h2 className="font-display text-2xl font-extrabold tracking-[-.04em]">{title}</h2><IconButton label="cerrar ventana" onClick={onClose}><X size={18} /></IconButton></div>{children}</div></div>;
}

function Home() {
  const [question, setQuestion] = useState('');
  const [sent, setSent] = useState(false);
  return <><PageTitle eyebrow="Mi espacio ciudadano" title="Buenos días, Kevin." description="Tienes una conversación pendiente y una fecha importante en el calendario." action={<Button href="/asistente" icon={MessageCircle} testId="link-home-asistente">Abrir asistente</Button>} />
    <div className="mb-7 grid gap-5 xl:grid-cols-[1.45fr_1fr]"><section className="relative overflow-hidden rounded-3xl bg-[#173BFF] p-6 text-white sm:p-8"><div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border-[24px] border-[#315CFF]" /><div className="absolute -bottom-20 right-20 h-44 w-44 rounded-full border-[20px] border-[#00C2B8]/25" /><div className="relative"><div className="mb-9 flex items-center gap-2 text-xs font-bold text-[#DCE3FF]"><span className="h-2 w-2 rounded-full bg-[#18C98B]" />Acompañamiento activo</div><p className="max-w-lg font-display text-3xl font-extrabold leading-tight tracking-[-.04em] sm:text-4xl">¿Qué necesitas resolver hoy?</p><p className="mt-3 max-w-md text-sm leading-6 text-[#D1D9FF]">Cuéntamelo con tus palabras. Yo organizo los pasos y te digo antes de hacer cualquier consulta.</p><form className="mt-7 flex max-w-xl gap-2 rounded-2xl bg-white p-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) setSent(true); }}><input value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="input-home-conversation" aria-label="Cuéntame qué necesitas" placeholder="Ej. quiero pagar el impuesto de mi carro..." className="min-w-0 flex-1 px-3 text-sm text-[#172033] outline-none placeholder:text-[#A4ADBC]" /><button type="submit" data-testid="button-home-enviar" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#FFC83D] text-[#6B4B00] hover:bg-[#FFD45F]"><Send size={17} /></button></form>{sent && <p data-testid="status-home-enviado" className="mt-3 text-xs font-bold text-[#BDF7DB]">Entendido. Te llevo al asistente para continuar.</p>}</div></section><div className="rounded-3xl border border-[#DEE5F1] bg-white p-6 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8792A6]">En curso</p><h2 className="mt-2 font-display text-xl font-bold">Traslado de vehículo</h2></div><Status tone="yellow">En validación</Status></div><div className="mt-7 flex items-end justify-between"><div><p className="font-mono text-2xl font-bold text-[#173BFF]">75<span className="text-sm">%</span></p><p className="mt-1 text-xs text-[#7B879B]">TRM-2026-004821</p></div><Car className="text-[#173BFF]" size={34} /></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#E9EDF5]"><div className="h-full w-3/4 rounded-full bg-[#18C98B]" /></div><Link href="/tramites/traslado" data-testid="link-home-traslado" className="mt-6 flex items-center justify-between border-t border-[#EEF1F6] pt-4 text-sm font-bold text-[#173BFF]">Ver trazabilidad <ChevronRight size={17} /></Link></div></div>
    <section><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl font-bold">Accesos rápidos</h2><Link href="/explorar" data-testid="link-home-explorar" className="text-xs font-bold text-[#173BFF]">Ver todos</Link></div><div className="grid gap-3 md:grid-cols-3">{quickActions.map(({ label, detail, icon: Icon, href, tint }) => <Link href={href} key={href} data-testid={`card-home-${href.slice(1)}`} className="group flex items-center gap-4 rounded-2xl border border-[#DEE5F1] bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-md"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${tint}`}><Icon size={20} /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-bold">{label}</strong><small className="mt-1 block text-xs text-[#7B879B]">{detail}</small></span><ChevronRight size={17} className="text-[#A2ACBC] transition-transform group-hover:translate-x-1" /></Link>)}</div></section>
    <div className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-5 flex items-center justify-between"><h2 className="font-display text-xl font-bold">Actividad reciente</h2><Link href="/notificaciones" data-testid="link-home-actividad" className="text-xs font-bold text-[#173BFF]">Ver notificaciones</Link></div>{[['Hace 12 min', 'Consulta de RUNT autorizada', 'Fuente oficial · RUNT', 'green'], ['Ayer', 'Documento validado', 'Traslado de vehículo', 'blue'], ['12 sep 2026', 'Cita de licencia agendada', 'Centro de Servicios Norte', 'yellow']].map(([time, title, detail, tone], i) => <div key={title} data-testid={`activity-row-${i}`} className="flex gap-4 border-t border-[#EEF1F6] py-4"><div className={`mt-1 h-2 w-2 rounded-full ${tone === 'green' ? 'bg-[#18C98B]' : tone === 'yellow' ? 'bg-[#FFC83D]' : 'bg-[#173BFF]'}`} /><div className="flex-1"><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs text-[#7A869C]">{detail}</p></div><time className="text-[11px] text-[#98A1B1]">{time}</time></div>)}</section><section className="rounded-2xl border border-[#DEE5F1] bg-[#E9EDFF] p-6"><div className="mb-4 flex items-center gap-2 text-[#173BFF]"><Sparkles size={17} /><h2 className="font-display text-lg font-bold">Sobre este piloto</h2></div><p className="text-sm leading-6 text-[#53617D]">Aquí puedes ver cómo se siente una experiencia pública más acompañada. Los datos y conexiones son simulados.</p><Link href="/como-funciona" data-testid="link-home-piloto" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#173BFF]">Conoce el recorrido <ArrowRight size={16} /></Link></section></div>
  </>;
}

function Assistant() {
  const [text, setText] = useState('');
  const [stage, setStage] = useState<'idle' | 'consent' | 'found' | 'requirements' | 'validation' | 'confirm' | 'filed'>('idle');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState('');
  const messages = useMemo(() => {
    if (stage === 'idle') return [];
    if (quick === 'impuesto') return [{ who: 'assistant', text: 'Puedo consultar el impuesto 2026 de tu Chevrolet Onix ABC123. Te mostraré el valor y podrás decidir si simulas el pago.' }];
    if (quick === 'mensaje') return [{ who: 'assistant', text: 'Claro. Sube una captura o pega el texto del mensaje y revisaré sus señales y la fuente que dice representar.' }];
    if (quick === 'licencia') return [{ who: 'assistant', text: 'Para renovar tu licencia revisaremos requisitos y luego elegirás sede, fecha y hora para tu cita.' }];
    return [{ who: 'user', text: 'Quiero pasar mi carro de Montería a Medellín.' }, { who: 'assistant', text: 'Entendido. Encontré tu Chevrolet Onix ABC123. Para continuar debo consultar información oficial del vehículo. ¿Me autorizas?' }];
  }, [quick, stage]);
  const advance = () => { setBusy(true); setTimeout(() => { setBusy(false); setStage(stage === 'consent' ? 'found' : stage === 'found' ? 'requirements' : stage === 'requirements' ? 'validation' : stage === 'validation' ? 'confirm' : 'filed'); }, 650); };
  const submit = (value = text) => { if (!value.trim()) return; setQuick(''); setText(''); setStage('consent'); };
  return <div className="mx-auto max-w-5xl"><div className="mb-6 flex items-center justify-between"><div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.18em] text-[#173BFF]">Asistente transaccional</p><h1 data-testid="text-assistant-title" className="font-display text-3xl font-extrabold tracking-[-.05em] sm:text-4xl">Hablemos de tu trámite.</h1></div><PilotPill /></div><div className="grid gap-5 lg:grid-cols-[1fr_285px]"><section className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-[#DEE5F1] bg-white shadow-sm"><div className="flex items-center gap-3 border-b border-[#EDF0F5] px-5 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#E9EDFF] text-[#173BFF]"><MessageCircle size={18} /></span><div><p className="text-sm font-bold">Asistente MiEstado</p><p className="flex items-center gap-1 text-[11px] text-[#08784E]"><span className="h-1.5 w-1.5 rounded-full bg-[#18C98B]" />Acompañamiento activo</p></div><span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#7B879B]"><ShieldCheck size={14} /> Consentimiento visible</span></div><div className="flex-1 space-y-4 overflow-auto p-5 sm:p-7"><div className="flex max-w-[390px] gap-3"><span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#173BFF] text-white"><Sparkles size={14} /></span><div className="rounded-2xl rounded-tl-sm bg-[#F0F3F9] p-4 text-sm leading-6 text-[#4F5C74]">Hola, Kevin. Puedo ayudarte a entender y ejecutar un trámite público. Cuéntame qué necesitas resolver.</div></div>{messages.map((message, i) => <div key={`${message.who}-${i}`} className={`flex max-w-[420px] gap-3 ${message.who === 'user' ? 'ml-auto flex-row-reverse' : ''}`}><div className={`rounded-2xl p-4 text-sm leading-6 ${message.who === 'user' ? 'rounded-tr-sm bg-[#173BFF] text-white' : 'rounded-tl-sm border border-[#DDE7FF] bg-[#F5F7FF] text-[#4F5C74]'}`}>{message.text}</div></div>)}{stage === 'found' && <AssistantCard title="Vehículo encontrado" icon={Car}><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-[#8994A8]">Vehículo</p><p className="font-bold">Chevrolet Onix</p></div><div><p className="text-xs text-[#8994A8]">Placa</p><p className="font-mono font-bold">ABC123</p></div><div><p className="text-xs text-[#8994A8]">Modelo</p><p className="font-bold">2022</p></div><div><p className="text-xs text-[#8994A8]">Origen</p><p className="font-bold">Montería</p></div></div><Status tone="green">Encontrado en RUNT simulado</Status></AssistantCard>}{stage === 'requirements' && <AssistantCard title="Lo que necesitas" icon={FileCheck2}><div className="space-y-3 text-sm"><CheckLine text="Documento de identidad" done /><CheckLine text="SOAT vigente" done /><CheckLine text="Revisión técnico-mecánica" done /><CheckLine text="Paz y salvo de impuestos" /></div></AssistantCard>}{stage === 'validation' && <AssistantCard title="Validando documentos" icon={RefreshCw}><div className="space-y-3"><ProgressLine label="Identidad" value="Validada" done /><ProgressLine label="SOAT y tecnomecánica" value="Validando" /><ProgressLine label="Impuestos" value="Pendiente" /></div></AssistantCard>}{stage === 'confirm' && <AssistantCard title="Todo listo para radicar" icon={ClipboardCheck}><p className="text-sm leading-6 text-[#65728A]">El traslado de ABC123 de Montería a Medellín está preparado. Al continuar simularé la radicación y recibirás un número de seguimiento.</p><div className="mt-4 rounded-xl bg-[#FFF7E4] p-3 text-xs leading-5 text-[#765A15]"><CircleAlert size={14} className="mr-1 inline" /> Esta acción es una simulación dentro del piloto.</div></AssistantCard>}{stage === 'filed' && <AssistantCard title="Trámite radicado" icon={CheckCircle2}><p className="text-sm leading-6 text-[#65728A]">Tu solicitud quedó registrada y puedes seguirla desde Mis trámites.</p><div className="mt-4 rounded-xl bg-[#DDF8ED] p-4"><p className="text-[11px] font-bold uppercase tracking-[.15em] text-[#08784E]">Número de radicado</p><p data-testid="text-radicado-chat" className="mt-1 font-mono text-xl font-bold text-[#086746]">TRM-2026-004821</p></div><Button href="/tramites/traslado" variant="soft" icon={ArrowRight} testId="link-chat-tramite">Ver trazabilidad</Button></AssistantCard>}{busy && <div className="flex items-center gap-2 text-xs font-semibold text-[#8390A5]"><span className="h-2 w-2 animate-pulse-soft rounded-full bg-[#173BFF]" />Procesando con fuentes simuladas...</div>}</div><div className="border-t border-[#EDF0F5] bg-[#FBFCFE] p-4">{stage !== 'idle' && stage !== 'filed' && !quick && <div className="mb-3 flex items-center justify-between rounded-xl bg-[#FFF7E4] px-3 py-2 text-xs text-[#755B1D]"><span><LockKeyhole size={13} className="mr-1 inline" />{stage === 'consent' ? '¿Autorizas consultar las fuentes oficiales simuladas?' : 'Paso guiado listo para continuar.'}</span><Button onClick={advance} disabled={busy} testId="button-asistente-continuar">{stage === 'consent' ? 'Sí, autorizo' : stage === 'confirm' ? 'Radicar solicitud' : 'Continuar'} <ArrowRight size={15} /></Button></div>}<form className="flex gap-2 rounded-2xl border border-[#DCE3EF] bg-white p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}><input value={text} onChange={(e) => setText(e.target.value)} data-testid="input-asistente-mensaje" aria-label="Escribe tu mensaje" className="min-w-0 flex-1 px-3 text-sm outline-none placeholder:text-[#A3ACBC]" placeholder="Cuéntame qué necesitas..." /><button type="submit" data-testid="button-asistente-enviar" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#173BFF] text-white"><Send size={17} /></button></form><p className="mt-2 text-center text-[10px] text-[#96A0B0]">No se ejecuta ningún paso sin tu consentimiento.</p></div></section><aside className="space-y-4"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><p className="mb-3 text-xs font-bold uppercase tracking-[.15em] text-[#8792A6]">Comienza por aquí</p>{[['impuesto', 'Consultar impuesto vehicular', ReceiptText], ['mensaje', 'Verificar un mensaje', ShieldCheck], ['licencia', 'Renovar licencia', CalendarDays]].map(([id, label, Icon]) => <button key={id as string} type="button" data-testid={`button-quick-${id}`} onClick={() => { setQuick(id as string); setStage('requirements'); }} className="flex w-full items-center gap-3 border-b border-[#EEF1F6] py-3 text-left last:border-0"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F0F3F9] text-[#173BFF]"><Icon size={15} /></span><span className="flex-1 text-xs font-bold text-[#45526B]">{label as string}</span><ChevronRight size={15} className="text-[#A4ADBC]" /></button>)}</div><div className="rounded-2xl border border-[#D6E9E7] bg-[#ECFBF8] p-5"><div className="flex gap-3"><ShieldCheck size={19} className="shrink-0 text-[#00A79E]" /><div><p className="text-sm font-bold text-[#145B58]">Tú tienes el control</p><p className="mt-1 text-xs leading-5 text-[#397875]">Verás la fuente, el dato consultado y la acción antes de continuar.</p></div></div></div><Link href="/como-funciona" data-testid="link-assistant-explainer" className="flex items-center justify-between rounded-2xl border border-[#DEE5F1] bg-white p-5 text-xs font-bold text-[#53617B]">¿Cómo funciona por dentro? <ArrowRight size={15} className="text-[#173BFF]" /></Link></aside></div></div>;
}

function AssistantCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return <div className="ml-10 max-w-[440px] rounded-2xl border border-[#DDE7FF] bg-white p-4 shadow-sm"><div className="mb-4 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#E9EDFF] text-[#173BFF]"><Icon size={15} /></span><h3 className="text-sm font-bold">{title}</h3></div>{children}</div>;
}
function CheckLine({ text, done = false }: { text: string; done?: boolean }) { return <div className="flex items-center gap-2 text-[#59667D]"><span className={`grid h-5 w-5 place-items-center rounded-full ${done ? 'bg-[#DDF8ED] text-[#08784E]' : 'border border-[#D6DFEC] text-[#A4ADBC]'}`}>{done ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span>{text}</div>; }
function ProgressLine({ label, value, done = false }: { label: string; value: string; done?: boolean }) { return <div className="flex items-center justify-between border-b border-[#EEF1F6] pb-2 text-sm last:border-0 last:pb-0"><span className="text-[#65728A]">{label}</span><span className={`flex items-center gap-1 text-xs font-bold ${done ? 'text-[#08784E]' : value === 'Validando' ? 'text-[#B17800]' : 'text-[#8A94A6]'}`}>{done && <Check size={13} />}{value}</span></div>; }

function Tramites() {
  const [tab, setTab] = useState('Todos');
  const cards = [{ id: 'traslado', title: 'Traslado de vehículo', subtitle: 'Chevrolet Onix · ABC123', status: 'En validación', tone: 'yellow' as const, progress: 75, date: 'Actualizado hace 12 min', href: '/tramites/traslado' }, { id: 'licencia', title: 'Renovación de licencia', subtitle: 'Cita en Centro de Servicios Norte', status: 'Agendado', tone: 'green' as const, progress: 100, date: '30 sep 2026 · 10:30 a. m.', href: '/licencia' }, { id: 'impuesto', title: 'Impuesto vehicular 2026', subtitle: 'Chevrolet Onix · ABC123', status: 'Pendiente de pago', tone: 'coral' as const, progress: 35, date: 'Vence el 31 oct 2026', href: '/impuesto' }]; const filtered = tab === 'Todos' ? cards : cards.filter((c) => tab === 'En curso' ? c.progress < 100 : c.progress === 100);
  return <><PageTitle eyebrow="Seguimiento" title="Mis trámites" description="Todo lo que has empezado, en un mismo lugar." action={<Button href="/asistente" icon={MessageCircle} testId="link-tramites-nuevo">Nuevo trámite</Button>} /><div className="mb-6 flex gap-2 overflow-auto border-b border-[#E1E7F0]">{['Todos', 'En curso', 'Completados'].map((item) => <button key={item} type="button" data-testid={`tab-tramites-${item.toLowerCase().replace(' ', '-')}`} onClick={() => setTab(item)} className={`whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-bold ${tab === item ? 'border-[#173BFF] text-[#173BFF]' : 'border-transparent text-[#8792A6]'}`}>{item}</button>)}</div><div className="grid gap-4 xl:grid-cols-2">{filtered.map((card) => <Link key={card.id} href={card.href} data-testid={`card-tramite-${card.id}`} className="group rounded-2xl border border-[#DEE5F1] bg-white p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#E9EDFF] text-[#173BFF]">{card.id === 'traslado' ? <Car size={20} /> : card.id === 'licencia' ? <CalendarDays size={20} /> : <ReceiptText size={20} />}</span><div><h2 className="font-display text-lg font-bold">{card.title}</h2><p className="mt-1 text-xs text-[#7C879B]">{card.subtitle}</p></div></div><Status tone={card.tone}>{card.status}</Status></div><div className="mt-7 flex items-center justify-between text-xs"><span className="font-mono text-[#7A869B]">{card.id === 'traslado' ? 'TRM-2026-004821' : card.id === 'licencia' ? 'CIT-2026-002981' : 'PAG pendiente'}</span><span className="text-[#8994A8]">{card.date}</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E9EDF5]"><div className={`h-full rounded-full ${card.tone === 'green' ? 'bg-[#18C98B]' : card.tone === 'yellow' ? 'bg-[#FFC83D]' : 'bg-[#FF6B5E]'}`} style={{ width: `${card.progress}%` }} /></div><div className="mt-4 flex items-center justify-end gap-1 text-xs font-bold text-[#173BFF] opacity-80 group-hover:opacity-100">Abrir detalle <ChevronRight size={15} /></div></Link>)}</div>{filtered.length === 0 && <EmptyState icon={ClipboardCheck} title="Aún no hay trámites aquí" copy="Cuando completes o empieces un trámite, lo verás en esta vista." action={<Button href="/explorar">Explorar trámites</Button>} />}</>;
}

function TransferDetail() {
  const [action, setAction] = useState<string | null>(null);
  const timeline = [['Solicitud iniciada', '12 sep 2026 · 9:41 a. m.', true], ['Identidad confirmada', '12 sep 2026 · 9:42 a. m.', true], ['Documentos recibidos', '12 sep 2026 · 9:44 a. m.', true], ['Validación de entidad', 'En curso · Secretaría de Movilidad', false], ['Decisión y cierre', 'Pendiente', false]] as const;
  return <><Link href="/tramites" data-testid="link-volver-tramites" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#60708B]"><ArrowLeft size={16} />Mis trámites</Link><PageTitle eyebrow="Detalle del trámite" title="Traslado de vehículo" description="Montería → Medellín · Chevrolet Onix ABC123" action={<Status tone="yellow">En validación</Status>} /><div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><section className="space-y-5"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8792A6]">Radicado</p><p data-testid="text-transfer-radicado" className="mt-2 font-mono text-2xl font-bold text-[#173BFF]">TRM-2026-004821</p></div><div className="text-left sm:text-right"><p className="text-xs text-[#8792A6]">Avance estimado</p><p className="mt-1 font-display text-3xl font-extrabold text-[#172033]">75%</p></div></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#E9EDF5]"><div className="h-full w-3/4 rounded-full bg-[#18C98B]" /></div></div><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="mb-6 font-display text-xl font-bold">Historia del trámite</h2><div className="relative ml-2 space-y-6 border-l border-[#D9E1EE] pl-7">{timeline.map(([label, date, done], i) => <div key={label} data-testid={`timeline-${i}`} className="relative"><span className={`absolute -left-[39px] top-0.5 grid h-5 w-5 place-items-center rounded-full border-4 border-white ${done ? 'bg-[#18C98B] text-white' : i === 3 ? 'bg-[#FFC83D]' : 'bg-[#D7DFEC]'}`}>{done && <Check size={9} strokeWidth={4} />}</span><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-[#8994A8]">{date}</p></div>)}</div></div><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="mb-5 font-display text-xl font-bold">Documentos y validaciones</h2><div className="space-y-3">{[['Documento de identidad', 'Validado', 'green'], ['SOAT vigente', 'Validado', 'green'], ['Revisión técnico-mecánica', 'Validado', 'green'], ['Paz y salvo de impuestos', 'En consulta', 'yellow']].map(([name, status, tone], i) => <div key={name} data-testid={`document-row-${i}`} className="flex items-center gap-3 rounded-xl bg-[#F8FAFD] p-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#173BFF]"><FileText size={15} /></span><span className="flex-1 text-sm font-semibold">{name}</span><Status tone={tone as 'green' | 'yellow'}>{status}</Status></div>)}</div></div></section><aside className="space-y-5"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-4 flex items-center gap-2"><History size={17} className="text-[#173BFF]" /><h2 className="font-display text-lg font-bold">Trazabilidad</h2></div><p className="text-sm leading-6 text-[#6E7A91]">Cada consulta queda registrada para que sepas qué fuente intervino y con qué permiso.</p><div className="mt-5 space-y-4">{[['09:44', 'Secretaría de Movilidad', 'Consulta de requisito'], ['09:42', 'MiEstado', 'Consentimiento confirmado'], ['09:41', 'Kevin', 'Solicitud iniciada']].map(([time, source, detail]) => <div key={time} className="flex gap-3"><span className="font-mono text-[11px] text-[#173BFF]">{time}</span><div><p className="text-xs font-bold">{source}</p><p className="mt-0.5 text-[11px] text-[#8994A8]">{detail}</p></div></div>)}</div></div><div className="rounded-2xl border border-[#D6E9E7] bg-[#ECFBF8] p-5"><div className="flex gap-3"><ShieldCheck size={18} className="shrink-0 text-[#00A79E]" /><div><p className="text-sm font-bold text-[#145B58]">Fuente oficial simulada</p><p className="mt-1 text-xs leading-5 text-[#397875]">La información fue contrastada con RUNT y la Secretaría de Movilidad.</p></div></div></div><div className="flex flex-wrap gap-2"><Button onClick={() => setAction('Copia del radicado lista para compartir.')} variant="outline" icon={ExternalLink} testId="button-compartir-radicado">Compartir</Button><Button onClick={() => setAction('La actualización se solicitará al equipo de prueba.')} variant="soft" icon={RefreshCw} testId="button-actualizar-tramite">Actualizar</Button></div>{action && <p data-testid="status-transfer-action" className="rounded-xl bg-[#E9EDFF] p-3 text-xs font-bold text-[#173BFF]">{action}</p>}</aside></div></>;
}

function Explore() {
  const [query, setQuery] = useState('');
  const groups = [{ title: 'Movilidad', icon: Car, items: [['Traslado de vehículo', 'Cambia de ciudad un vehículo registrado', '/tramites/traslado', false], ['Renovación de licencia', 'Revisa requisitos y agenda tu cita', '/licencia', false]] }, { title: 'Impuestos', icon: ReceiptText, items: [['Impuesto vehicular', 'Consulta y simula tu pago 2026', '/impuesto', false], ['Predial municipal', 'Consulta de impuesto predial', '#', true]] }, { title: 'Identidad y seguridad', icon: ShieldCheck, items: [['Verificar un mensaje', 'Comprueba señales y fuentes', '/verificar', false], ['Cédula digital', 'Trámite de demostración', '#', true]] }, { title: 'Ciudad y educación', icon: Building2, items: [['Certificado de residencia', 'Disponible próximamente', '#', true], ['Matrícula educativa', 'Disponible próximamente', '#', true]] }]; const visible = groups.map((group) => ({ ...group, items: group.items.filter((item) => `${item[0]} ${item[1]}`.toLowerCase().includes(query.toLowerCase())) })).filter((g) => g.items.length); return <><PageTitle eyebrow="Catálogo ciudadano" title="Explora tus opciones" description="Encuentra un camino claro para cada necesidad. Las opciones marcadas están en demostración." /><div className="mb-7 flex items-center gap-3 rounded-2xl border border-[#DDE4F0] bg-white px-4 py-2.5 shadow-sm"><Search size={18} className="text-[#8994A8]" /><input value={query} onChange={(e) => setQuery(e.target.value)} data-testid="input-explorar-busqueda" aria-label="Buscar trámites" placeholder="Buscar por ejemplo: licencia, carro, impuesto..." className="flex-1 bg-transparent text-sm outline-none" /><SlidersHorizontal size={17} className="text-[#A4ADBC]" /></div><div className="grid gap-5 md:grid-cols-2">{visible.map(({ title, icon: Icon, items }) => <section key={title} className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><div className="mb-4 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#E9EDFF] text-[#173BFF]"><Icon size={19} /></span><h2 className="font-display text-xl font-bold">{title}</h2></div><div className="space-y-2">{items.map(([name, detail, href, soon]) => soon ? <div key={name as string} data-testid={`catalog-${name}`} className="flex items-center gap-3 rounded-xl border border-dashed border-[#DDE4F0] p-3 opacity-75"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F0F3F9] text-[#8290A5]"><Clock3 size={15} /></span><span className="flex-1"><strong className="block text-sm">{name as string}</strong><small className="text-xs text-[#8B96A9]">{detail as string}</small></span><Status tone="slate">Próximamente</Status></div> : <Link key={name as string} href={href as string} data-testid={`catalog-${name}`} className="group flex items-center gap-3 rounded-xl p-3 hover:bg-[#F5F7FB]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F0F3F9] text-[#173BFF]"><ArrowRight size={15} /></span><span className="flex-1"><strong className="block text-sm">{name as string}</strong><small className="text-xs text-[#8B96A9]">{detail as string}</small></span><ChevronRight size={16} className="text-[#B0B8C6] group-hover:text-[#173BFF]" /></Link>)}</div></section>)}</div></>;
}

function Verify() {
  const [file, setFile] = useState(false); const [result, setResult] = useState<'idle' | 'processing' | 'done'>('idle');
  const run = () => { setFile(true); setResult('processing'); setTimeout(() => setResult('done'), 1000); };
  return <><PageTitle eyebrow="Confianza digital" title="Verifica antes de actuar" description="Analiza un mensaje o documento para entender quién lo emite, qué pide y qué señales presenta." /><div className="grid gap-5 lg:grid-cols-[1fr_340px]"><section className="rounded-3xl border border-[#DEE5F1] bg-white p-6 sm:p-8"><div className="mb-6 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#FFF2CE] text-[#946900]"><ShieldCheck size={22} /></span><div><h2 className="font-display text-xl font-bold">Nueva verificación</h2><p className="text-xs text-[#7D899E]">Simulación de análisis de fuente y contenido</p></div></div><label htmlFor="verify-text" className="mb-2 block text-sm font-bold">Pega el texto del mensaje</label><textarea id="verify-text" data-testid="textarea-verificar-mensaje" className="h-32 w-full resize-none rounded-xl border border-[#DDE4F0] bg-[#FBFCFE] p-3 text-sm outline-none focus:border-[#173BFF]" placeholder="Ej. Secretaría de Movilidad: evita sanciones, paga hoy en este enlace..." /><div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-[#EDF0F5]" /><span className="text-xs font-bold text-[#9AA4B3]">o</span><span className="h-px flex-1 bg-[#EDF0F5]" /></div><button type="button" data-testid="button-verificar-upload" onClick={() => setFile(true)} className={`flex w-full items-center justify-center gap-3 rounded-xl border border-dashed p-5 text-sm font-bold ${file ? 'border-[#18C98B] bg-[#ECFBF8] text-[#08784E]' : 'border-[#BFCBE0] text-[#66748D] hover:border-[#173BFF] hover:text-[#173BFF]'}`}><UploadCloud size={19} />{file ? 'mensaje-capturado.txt listo' : 'Sube una captura o documento'}</button>{result === 'idle' && <Button onClick={run} disabled={!file} testId="button-verificar-analizar" icon={ArrowRight}>Analizar mensaje</Button>}{result === 'processing' && <div data-testid="status-verificar-processing" className="mt-5 rounded-xl bg-[#F0F3F9] p-4 text-sm font-bold text-[#56647D]"><span className="mr-2 inline-block h-2 w-2 animate-pulse-soft rounded-full bg-[#173BFF]" />Revisando señales y fuentes...</div>}{result === 'done' && <div data-testid="status-verificar-result" className="mt-5 rounded-2xl border border-[#BDEBD6] bg-[#ECFBF8] p-5"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 text-[#18C98B]" /><div><p className="font-bold text-[#08784E]">No encontramos señales críticas</p><p className="mt-1 text-sm leading-6 text-[#397875]">El mensaje parece informativo, pero confirma siempre desde canales oficiales antes de entregar datos o pagar.</p><div className="mt-4 flex flex-wrap gap-2"><Status tone="green">Fuente identificada</Status><Status tone="yellow">Enlace no validado</Status></div></div></div></div>}</section><aside className="space-y-4"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><h2 className="font-display text-lg font-bold">¿Qué revisamos?</h2><div className="mt-4 space-y-4">{[['Origen declarado', 'Comparamos el nombre con fuentes conocidas.', ShieldCheck], ['Lenguaje y urgencia', 'Detectamos presión o solicitudes inusuales.', CircleAlert], ['Destino del enlace', 'Te indicamos si falta validar una dirección.', ExternalLink]].map(([title, copy, Icon]) => <div key={title as string} className="flex gap-3"><Icon size={17} className="mt-0.5 shrink-0 text-[#173BFF]" /><div><p className="text-sm font-bold">{title as string}</p><p className="mt-1 text-xs leading-5 text-[#7C879B]">{copy as string}</p></div></div>)}</div></div><div className="rounded-2xl bg-[#FFF7E4] p-5 text-xs leading-5 text-[#765A15]"><CircleAlert size={15} className="mr-1 inline" /> MiEstado no reemplaza la confirmación de la entidad. Nunca compartas claves ni códigos.</div></aside></div></>;
}

function Tax() {
  const [modal, setModal] = useState(false); const [paid, setPaid] = useState(false);
  return <><PageTitle eyebrow="Impuesto vehicular · 2026" title="Tu impuesto, sin letra pequeña." description="Consulta simulada para tu Chevrolet Onix ABC123." action={<Status tone="yellow">Vence 31 oct 2026</Status>} /><div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><section className="rounded-3xl border border-[#DEE5F1] bg-white p-6 sm:p-8"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em] text-[#8792A6]">Total a pagar</p><p data-testid="text-impuesto-total" className="mt-2 font-display text-5xl font-extrabold tracking-[-.06em] text-[#173BFF]">$1.123.740</p><p className="mt-2 text-sm text-[#748096]">Aplicando descuento por pronto pago del 10%.</p></div><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#E9EDFF] text-[#173BFF]"><Car size={23} /></span></div><div className="my-8 grid gap-3 sm:grid-cols-3">{[['Valor base', '$1.248.600'], ['Descuento', '- $124.860'], ['Vencimiento', '31 oct 2026']].map(([label, value]) => <div key={label} className="rounded-xl bg-[#F7F9FC] p-3"><p className="text-[11px] text-[#8792A6]">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}</div>{paid ? <div data-testid="status-pago-confirmado" className="rounded-2xl border border-[#BDEBD6] bg-[#ECFBF8] p-5"><div className="flex items-center gap-2 font-bold text-[#08784E]"><CheckCircle2 size={19} /> Pago simulado confirmado</div><p className="mt-2 text-sm text-[#397875]">Recibo <span className="font-mono font-bold">PAG-2026-003821</span> · 12 sep 2026</p></div> : <Button onClick={() => setModal(true)} testId="button-pagar-impuesto" icon={CreditCard}>Simular pago</Button>}</section><aside className="space-y-4"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><p className="mb-4 text-xs font-bold uppercase tracking-[.15em] text-[#8792A6]">Datos del vehículo</p><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#F0F3F9] text-[#173BFF]"><Car size={20} /></span><div><p className="text-sm font-bold">Chevrolet Onix</p><p className="font-mono text-xs text-[#77839A]">ABC123 · Modelo 2022</p></div></div><div className="mt-5 border-t border-[#EEF1F6] pt-4 text-xs text-[#718097]"><ShieldCheck size={14} className="mr-1 inline text-[#18C98B]" /> Consulta contrastada con fuente oficial simulada</div></div><div className="rounded-2xl bg-[#E9EDFF] p-5"><p className="text-sm font-bold text-[#173BFF]">¿Qué pasa al pagar?</p><p className="mt-2 text-xs leading-5 text-[#53617D]">Generaremos un comprobante de prueba para que puedas seguir el recorrido completo.</p></div></aside></div>{modal && <Modal title="Confirmar pago simulado" onClose={() => setModal(false)}><p className="text-sm leading-6 text-[#65728A]">Vas a simular un pago por <strong>$1.123.740</strong> para tu Chevrolet Onix ABC123.</p><div className="mt-5 rounded-xl bg-[#F7F9FC] p-4 text-sm"><div className="flex justify-between"><span>Total</span><strong>$1.123.740</strong></div><div className="mt-2 flex justify-between text-xs text-[#7D899E]"><span>Medio de prueba</span><span>Tarjeta simulada</span></div></div><div className="mt-6 flex gap-2"><Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button><Button onClick={() => { setModal(false); setPaid(true); }} icon={Check} testId="button-confirmar-pago">Confirmar pago</Button></div></Modal>}</>;
}

function License() {
  const [step, setStep] = useState(1); const [date, setDate] = useState('30 septiembre 2026'); const [time, setTime] = useState('10:30 a. m.');
  return <><PageTitle eyebrow="Licencia de conducción" title="Renueva sin dar vueltas." description="Revisa lo necesario y elige el momento que mejor te funcione." /><div className="mb-6 flex items-center gap-2">{[['1', 'Requisitos'], ['2', 'Cita'], ['3', 'Confirmación']].map(([number, label], i) => <div key={number} className="flex flex-1 items-center gap-2"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold ${step > i ? 'bg-[#18C98B] text-white' : step === i + 1 ? 'bg-[#173BFF] text-white' : 'bg-[#E6EBF4] text-[#7C879B]'}`}>{step > i + 1 ? <Check size={14} /> : number}</span><span className={`hidden text-xs font-bold sm:block ${step === i + 1 ? 'text-[#173BFF]' : 'text-[#7C879B]'}`}>{label}</span>{i < 2 && <span className="h-px flex-1 bg-[#DCE3EF]" />}</div>)}</div><div className="mx-auto max-w-3xl rounded-3xl border border-[#DEE5F1] bg-white p-6 shadow-sm sm:p-9">{step === 1 && <><div className="mb-7"><h2 className="font-display text-2xl font-bold">Antes de agendar</h2><p className="mt-2 text-sm text-[#748096]">Estos son los requisitos para tu renovación.</p></div><div className="grid gap-3">{[['Documento de identidad', 'Cédula vigente y legible', true], ['Examen médico', 'Presenta certificado de aptitud', false], ['Foto', 'La toman en el punto de atención', false]].map(([title, copy, done]) => <div key={title as string} className="flex items-center gap-3 rounded-xl border border-[#E3E8F1] p-4"><span className={`grid h-9 w-9 place-items-center rounded-lg ${done ? 'bg-[#DDF8ED] text-[#08784E]' : 'bg-[#F0F3F9] text-[#748096]'}`}>{done ? <Check size={17} /> : <FileText size={17} />}</span><div className="flex-1"><p className="text-sm font-bold">{title as string}</p><p className="mt-1 text-xs text-[#7C879B]">{copy as string}</p></div><Status tone={done ? 'green' : 'slate'}>{done ? 'Listo' : 'Requerido'}</Status></div>)}</div><div className="mt-7"><Button onClick={() => setStep(2)} icon={ArrowRight} testId="button-licencia-requisitos">Elegir cita</Button></div></>}{step === 2 && <><div className="mb-7"><h2 className="font-display text-2xl font-bold">Elige tu cita</h2><p className="mt-2 text-sm text-[#748096]">Centro de Servicios Norte · Medellín</p></div><div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-bold">Fecha<select value={date} onChange={(e) => setDate(e.target.value)} data-testid="select-licencia-fecha" className="mt-2 w-full rounded-xl border border-[#DDE4F0] bg-white p-3 font-normal outline-none"><option>30 septiembre 2026</option><option>1 octubre 2026</option><option>2 octubre 2026</option></select></label><label className="text-sm font-bold">Hora<select value={time} onChange={(e) => setTime(e.target.value)} data-testid="select-licencia-hora" className="mt-2 w-full rounded-xl border border-[#DDE4F0] bg-white p-3 font-normal outline-none"><option>10:30 a. m.</option><option>11:00 a. m.</option><option>2:00 p. m.</option></select></label></div><div className="mt-6 rounded-xl bg-[#F0F3F9] p-4 text-sm text-[#5B6880]"><MapPin size={16} className="mr-2 inline text-[#173BFF]" />Centro de Servicios Norte · Cra. 52 # 44-20, Medellín</div><div className="mt-7 flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Atrás</Button><Button onClick={() => setStep(3)} icon={ArrowRight} testId="button-licencia-confirmar">Confirmar horario</Button></div></>}{step === 3 && <div className="text-center"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-[#DDF8ED] text-[#08784E]"><CheckCircle2 size={31} /></div><h2 data-testid="text-cita-confirmada" className="font-display text-3xl font-extrabold">Cita agendada</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#748096]">Te esperamos para renovar tu licencia. Este recordatorio es parte de la simulación.</p><div className="mx-auto mt-6 max-w-sm rounded-2xl bg-[#F0F3F9] p-5 text-left"><p className="text-xs text-[#8792A6]">Número de cita</p><p className="mt-1 font-mono text-lg font-bold text-[#173BFF]">CIT-2026-002981</p><div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#DCE3EF] pt-4 text-xs"><div><p className="text-[#8792A6]">Fecha</p><strong>{date}</strong></div><div><p className="text-[#8792A6]">Hora</p><strong>{time}</strong></div></div></div><Button href="/notificaciones" variant="soft" icon={Bell} testId="link-cita-notificaciones">Ver recordatorio</Button></div>}</div></>;
}

function Notifications() {
  const [items, setItems] = useState([{ id: 1, title: 'Tu traslado tiene una actualización', copy: 'La Secretaría de Movilidad empezó a validar tus documentos.', time: 'Hace 12 min', unread: true, icon: Car }, { id: 2, title: 'Cita de licencia confirmada', copy: 'CIT-2026-002981 · 30 sep 2026 a las 10:30 a. m.', time: 'Ayer', unread: true, icon: CalendarDays }, { id: 3, title: 'Consulta oficial completada', copy: 'RUNT respondió a la consulta de tu Chevrolet Onix ABC123.', time: '12 sep 2026', unread: false, icon: ShieldCheck }]);
  return <><PageTitle eyebrow="Centro de avisos" title="Notificaciones" description="Información importante sobre tus trámites y decisiones." action={<Button onClick={() => setItems(items.map((item) => ({ ...item, unread: false })))} variant="outline" testId="button-marcar-leidas">Marcar todas como leídas</Button>} /><div className="max-w-3xl space-y-3">{items.map((item) => <button type="button" key={item.id} data-testid={`notification-${item.id}`} onClick={() => setItems(items.map((current) => current.id === item.id ? { ...current, unread: false } : current))} className={`flex w-full items-start gap-4 rounded-2xl border p-5 text-left ${item.unread ? 'border-[#C9D5FF] bg-white' : 'border-[#E2E7F0] bg-[#FBFCFE]'}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.unread ? 'bg-[#E9EDFF] text-[#173BFF]' : 'bg-[#F0F3F9] text-[#8994A8]'}`}><item.icon size={18} /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="text-sm">{item.title}</strong>{item.unread && <span className="h-2 w-2 rounded-full bg-[#FF6B5E]" />}</span><span className="mt-1 block text-sm leading-6 text-[#748096]">{item.copy}</span><span className="mt-2 block text-[11px] text-[#98A1B1]">{item.time}</span></span><ChevronRight size={17} className="mt-1 text-[#AAB3C1]" /></button>)}</div></>;
}

function Profile() {
  const [saved, setSaved] = useState(false);
  return <><PageTitle eyebrow="Tu cuenta" title="Perfil ciudadano" description="Tus datos visibles y tus preferencias de acompañamiento." action={<Status tone="green">Identidad verificada</Status>} /><div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]"><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="flex items-center gap-4"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-[#FFC83D] font-display text-2xl font-extrabold text-[#735100]">K</span><div><h2 data-testid="text-profile-name" className="font-display text-xl font-bold">Kevin</h2><p className="text-sm text-[#77839A]">Medellín, Antioquia</p></div></div><div className="mt-7 rounded-xl bg-[#ECFBF8] p-4"><div className="flex items-center gap-2 text-sm font-bold text-[#08784E]"><ShieldCheck size={17} /> Identidad verificada</div><p className="mt-2 text-xs leading-5 text-[#397875]">Verificada para este piloto. No guardamos documentos reales.</p></div><div className="mt-6 space-y-4 text-sm"><div className="flex justify-between border-b border-[#EEF1F6] pb-3"><span className="text-[#8290A5]">Correo</span><strong>kevin@ejemplo.co</strong></div><div className="flex justify-between border-b border-[#EEF1F6] pb-3"><span className="text-[#8290A5]">Celular</span><strong>*** *** 4821</strong></div><div className="flex justify-between"><span className="text-[#8290A5]">Último acceso</span><strong>Hoy, 9:18 a. m.</strong></div></div></section><div className="space-y-5"><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="font-display text-xl font-bold">Vehículo asociado</h2><div className="mt-5 flex items-center gap-4 rounded-xl bg-[#F7F9FC] p-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#E9EDFF] text-[#173BFF]"><Car size={20} /></span><div className="flex-1"><p className="font-bold">Chevrolet Onix</p><p className="mt-1 font-mono text-xs text-[#77839A]">ABC123 · 2022</p></div><Status tone="green">Activo</Status></div></section><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="font-display text-xl font-bold">Preferencias</h2><label className="mt-5 flex items-center justify-between text-sm"><span><strong className="block">Avisos de trámites</strong><small className="text-xs text-[#7C879B]">Recibe actualizaciones importantes</small></span><input type="checkbox" defaultChecked data-testid="checkbox-avisos" className="h-5 w-5 accent-[#173BFF]" /></label><label className="mt-5 flex items-center justify-between text-sm"><span><strong className="block">Explicar cada fuente</strong><small className="text-xs text-[#7C879B]">Siempre mostrar por qué se consulta</small></span><input type="checkbox" defaultChecked data-testid="checkbox-fuentes" className="h-5 w-5 accent-[#173BFF]" /></label><div className="mt-6">{saved ? <p data-testid="status-preferencias" className="text-xs font-bold text-[#08784E]">Preferencias guardadas en la simulación.</p> : <Button onClick={() => setSaved(true)} testId="button-guardar-preferencias" icon={Check}>Guardar preferencias</Button>}</div></section></div></div></>;
}

function EntityOverview() {
  return <><PageTitle eyebrow="Consola de entidad" title="Secretaría de Movilidad" description="Una vista operativa para acompañar trámites con contexto, no solo con filas." action={<Button href="/entidad/bandeja" icon={Inbox} testId="link-entidad-bandeja">Abrir bandeja</Button>} /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['En bandeja', '24', Inbox, 'blue'], ['En validación', '11', Clock3, 'yellow'], ['Resueltos hoy', '37', CheckCircle2, 'green'], ['Servicios activos', '6 / 6', Activity, 'teal']].map(([label, value, Icon, tone]) => <div key={label as string} className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><div className={`mb-4 grid h-9 w-9 place-items-center rounded-xl ${tone === 'green' ? 'bg-[#DDF8ED] text-[#08784E]' : tone === 'yellow' ? 'bg-[#FFF2CE] text-[#946900]' : tone === 'teal' ? 'bg-[#DDF9F5] text-[#087E78]' : 'bg-[#E9EDFF] text-[#173BFF]'}`}><Icon size={18} /></div><p className="text-xs text-[#8994A8]">{label as string}</p><p data-testid={`metric-${label}`} className="mt-1 font-display text-3xl font-extrabold">{value as string}</p></div>)}</div><div className="grid gap-5 lg:grid-cols-[1fr_.85fr]"><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-5 flex items-center justify-between"><h2 className="font-display text-xl font-bold">Flujo de hoy</h2><Status tone="blue">Datos piloto</Status></div><div className="space-y-4">{[['TRM-2026-004821', 'Traslado de vehículo', 'Kevin · Chevrolet Onix ABC123', 'En validación', 'yellow'], ['TRM-2026-004817', 'Traslado de vehículo', 'María · Renault Sandero', 'Información recibida', 'blue'], ['TRM-2026-004801', 'Cambio de servicio', 'Luis · Kia Picanto', 'Listo para decisión', 'green']].map(([id, title, copy, status, tone]) => <Link href="/entidad/tramite" key={id} data-testid={`entity-case-${id}`} className="flex items-center gap-3 rounded-xl border border-[#EEF1F6] p-4 hover:border-[#C4D1ED]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#F0F3F9] text-[#173BFF]"><Car size={16} /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{title}</strong><small className="block truncate text-xs text-[#7C879B]">{copy}</small><small className="mt-2 block font-mono text-[10px] text-[#173BFF]">{id}</small></span><Status tone={tone as 'yellow' | 'blue' | 'green'}>{status}</Status></Link>)}</div></section><section className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-5 flex items-center gap-2"><Activity size={18} className="text-[#00A79E]" /><h2 className="font-display text-xl font-bold">Pulso de servicios</h2></div><div className="space-y-3">{[['Identidad', 'Operativo'], ['RUNT', 'Operativo'], ['SIMIT', 'Operativo'], ['Pagos', 'Operativo']].map(([name, status]) => <div key={name} className="flex items-center justify-between border-b border-[#EEF1F6] pb-3 text-sm last:border-0"><span className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full bg-[#18C98B]" />{name}</span><span className="text-xs font-bold text-[#08784E]">{status}</span></div>)}</div><Link href="/entidad/servicios" data-testid="link-entidad-servicios" className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#173BFF]">Ver monitor completo <ArrowRight size={15} /></Link></section></div></>;
}

function EntityInbox() {
  const [filter, setFilter] = useState('Todos'); const rows = [['TRM-2026-004821', 'Kevin', 'Traslado de vehículo', 'En validación', 'yellow', 'Hace 12 min'], ['TRM-2026-004817', 'María Fernanda', 'Traslado de vehículo', 'Información recibida', 'blue', 'Hace 31 min'], ['TRM-2026-004801', 'Luis Alberto', 'Cambio de servicio', 'Listo para decisión', 'green', 'Ayer'], ['TRM-2026-004792', 'Juliana', 'Traslado de vehículo', 'En validación', 'yellow', 'Ayer']] as const; const visible = filter === 'Todos' ? rows : rows.filter((r) => r[3] === filter);
  return <><PageTitle eyebrow="Consola de entidad" title="Bandeja de trámites" description="Prioriza, revisa contexto y deja trazabilidad de cada decisión." action={<Button href="/entidad" variant="outline" icon={LayoutDashboard}>Resumen</Button>} /><div className="mb-5 flex flex-wrap gap-2">{['Todos', 'En validación', 'Información recibida', 'Listo para decisión'].map((item) => <button type="button" key={item} data-testid={`filter-inbox-${item}`} onClick={() => setFilter(item)} className={`rounded-full px-3 py-2 text-xs font-bold ${filter === item ? 'bg-[#173BFF] text-white' : 'bg-white text-[#66748D] ring-1 ring-[#DDE4F0]'}`}>{item}</button>)}</div><div className="overflow-hidden rounded-2xl border border-[#DEE5F1] bg-white"><div className="hidden grid-cols-[1.2fr_1fr_1.3fr_1fr_.8fr] gap-4 border-b border-[#EDF0F5] bg-[#F8FAFD] px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-[#8B96A9] md:grid"><span>Radicado</span><span>Ciudadano</span><span>Trámite</span><span>Estado</span><span>Actualización</span></div>{visible.map((row) => <Link href="/entidad/tramite" key={row[0]} data-testid={`inbox-row-${row[0]}`} className="grid gap-2 border-b border-[#EDF0F5] px-5 py-4 last:border-0 hover:bg-[#FBFCFE] md:grid-cols-[1.2fr_1fr_1.3fr_1fr_.8fr] md:items-center md:gap-4"><span className="font-mono text-xs font-bold text-[#173BFF]">{row[0]}</span><span className="text-sm font-semibold">{row[1]}</span><span className="text-xs text-[#6F7C93]">{row[2]}</span><span><Status tone={row[4]}>{row[3]}</Status></span><span className="text-[11px] text-[#919BAC]">{row[5]}</span></Link>)}</div></>;
}

function EntityCase() {
  const [notice, setNotice] = useState('');
  return <><Link href="/entidad/bandeja" data-testid="link-volver-bandeja" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#60708B]"><ArrowLeft size={16} />Bandeja</Link><PageTitle eyebrow="Revisión oficial · piloto" title="TRM-2026-004821" description="Traslado de vehículo · Kevin · Chevrolet Onix ABC123" action={<Status tone="yellow">En validación</Status>} /><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><section className="space-y-5"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#ECFBF8] text-[#087E78]"><ShieldCheck size={19} /></span><div><h2 className="font-display text-xl font-bold">Identidad y consentimiento</h2><p className="text-xs text-[#7B879B]">La persona sabe qué se está consultando.</p></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[#F7F9FC] p-3"><p className="text-[11px] text-[#8792A6]">Ciudadano</p><p className="mt-1 text-sm font-bold">Kevin · identidad verificada</p></div><div className="rounded-xl bg-[#F7F9FC] p-3"><p className="text-[11px] text-[#8792A6]">Consentimiento</p><p className="mt-1 text-sm font-bold text-[#08784E]">Concedido · 12 sep 2026</p></div></div></div><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="mb-5 font-display text-xl font-bold">Datos recolectados</h2><div className="grid gap-3 sm:grid-cols-2">{[['Origen', 'Montería'], ['Destino', 'Medellín'], ['Vehículo', 'Chevrolet Onix'], ['Placa', 'ABC123'], ['Modelo', '2022'], ['Solicitud', 'Traslado de matrícula']].map(([label, value]) => <div key={label} className="border-b border-[#EEF1F6] pb-3"><p className="text-[11px] text-[#8792A6]">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}</div></div><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="mb-5 font-display text-xl font-bold">Documentos y validaciones</h2><div className="space-y-2">{['Documento de identidad · validado', 'SOAT · vigente', 'Tecnomecánica · vigente', 'Impuesto vehicular · consulta en curso'].map((item, i) => <div key={item} data-testid={`entity-validation-${i}`} className="flex items-center gap-3 rounded-xl bg-[#F8FAFD] p-3 text-sm"><FileCheck2 size={16} className={i === 3 ? 'text-[#B17800]' : 'text-[#18C98B]'} /><span className="flex-1">{item}</span><ChevronRight size={15} className="text-[#B0B8C6]" /></div>)}</div></div></section><aside className="space-y-5"><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><h2 className="mb-5 font-display text-xl font-bold">Decisión</h2><p className="text-sm leading-6 text-[#6D7A91]">Continúa el trámite, pide un dato faltante o escálalo a revisión.</p><div className="mt-5 space-y-2"><Button onClick={() => setNotice('Trámite continuado. El ciudadano recibirá una actualización.')} testId="button-entidad-continuar" icon={ArrowRight}>Continuar trámite</Button><Button onClick={() => setNotice('Solicitud de información enviada al ciudadano.')} variant="outline" testId="button-entidad-informacion" icon={MessageCircle}>Solicitar información</Button><Button onClick={() => setNotice('Caso escalado a un equipo de revisión.')} variant="danger" testId="button-entidad-escalar" icon={CircleAlert}>Escalar caso</Button></div>{notice && <p data-testid="status-entidad-accion" className="mt-4 rounded-xl bg-[#E9EDFF] p-3 text-xs font-bold leading-5 text-[#173BFF]">{notice}</p>}</div><div className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><div className="mb-4 flex items-center gap-2"><History size={17} className="text-[#173BFF]" /><h2 className="font-display text-lg font-bold">Historial</h2></div>{['Consulta RUNT · 09:44', 'Consentimiento recibido · 09:42', 'Solicitud creada · 09:41'].map((item) => <p key={item} className="border-b border-[#EEF1F6] py-3 text-xs text-[#65728A] last:border-0">{item}</p>)}</div></aside></div></>;
}

function EntityServices() {
  const [refreshed, setRefreshed] = useState(false); const services = [['Identidad', 'Validación de identidad ciudadana', '99.8%', ShieldCheck], ['Movilidad', 'Secretaría de Movilidad', '98.4%', Car], ['SIMIT', 'Comparendos y obligaciones', '97.9%', FileCheck2], ['RUNT', 'Registro único nacional de tránsito', '99.1%', RouteIcon], ['Impuestos', 'Liquidación vehicular', '98.7%', ReceiptText], ['Pagos', 'Confirmación de pagos simulados', '100%', WalletCards], ['Notificaciones', 'Entrega de actualizaciones', '99.6%', Bell]] as const; return <><PageTitle eyebrow="Interoperabilidad simulada" title="Servicios conectados" description="Un mapa visible de las fuentes que participan en el recorrido. Ninguna conexión es real en este piloto." action={<Button onClick={() => setRefreshed(true)} variant="outline" icon={RefreshCw} testId="button-refrescar-servicios">Actualizar monitor</Button>} /><div className="mb-6 rounded-2xl border border-[#C9D4EE] bg-[#E9EDFF] p-5"><div className="flex gap-3"><Activity size={19} className="shrink-0 text-[#173BFF]" /><div><p className="text-sm font-bold text-[#173BFF]">Orquestador MiEstado</p><p className="mt-1 text-xs leading-5 text-[#53617D]">Coordina las consultas, registra consentimiento y devuelve una respuesta que la persona puede entender.</p></div></div></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{services.map(([name, copy, uptime, Icon]) => <div key={name} data-testid={`service-card-${name}`} className="rounded-2xl border border-[#DEE5F1] bg-white p-5"><div className="mb-5 flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F0F3F9] text-[#173BFF]"><Icon size={18} /></span><Status tone="green">Operativo</Status></div><h2 className="font-display text-lg font-bold">{name}</h2><p className="mt-1 text-xs text-[#7C879B]">{copy}</p><div className="mt-5 flex items-center justify-between border-t border-[#EEF1F6] pt-3"><span className="text-[11px] text-[#8B96A9]">Disponibilidad simulada</span><span className="font-mono text-xs font-bold text-[#08784E]">{uptime}</span></div></div>)}</div>{refreshed && <p data-testid="status-servicios-actualizado" className="mt-5 text-xs font-bold text-[#08784E]">Monitor actualizado · todos los servicios operativos en la simulación.</p>}</>;
}

function HowItWorks() {
  const steps = [['Tú', 'Cuentas lo que necesitas con tus palabras.', UserRound, 'bg-[#FFF2CE] text-[#946900]'], ['IA conversacional', 'Entiende la intención y traduce la burocracia.', MessageCircle, 'bg-[#E9EDFF] text-[#173BFF]'], ['Orquestador', 'Pide consentimiento, ordena fuentes y guarda la historia.', RouteIcon, 'bg-[#DDF9F5] text-[#087E78]'], ['Servicios conectados', 'Devuelven datos y validaciones para una decisión.', Activity, 'bg-[#DDF8ED] text-[#08784E]'] ] as const; return <><PageTitle eyebrow="La idea detrás del piloto" title="Un puente, no una caja negra." description="MiEstado hace visible el recorrido entre tu necesidad y las instituciones que pueden resolverla." /><div className="rounded-3xl border border-[#DEE5F1] bg-white p-5 sm:p-9"><div className="grid gap-5 lg:grid-cols-4">{steps.map(([title, copy, Icon, color], i) => <div key={title} className="relative"><div className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl ${color}`}><Icon size={23} /></div><p className="mb-2 font-mono text-xs font-bold text-[#173BFF]">0{i + 1}</p><h2 className="font-display text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-[#758097]">{copy}</p>{i < 3 && <ArrowRight className="absolute right-0 top-6 hidden text-[#B6C2D8] lg:block" size={19} />}</div>)}</div><div className="mt-9 rounded-2xl bg-[#172033] p-6 text-white sm:p-7"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><p className="mb-2 text-xs font-bold uppercase tracking-[.16em] text-[#6BE0D7]">Siempre visible</p><h2 className="font-display text-2xl font-bold">Quién consulta. Qué consulta. Por qué.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#B8C0D1]">La confianza no aparece en letra pequeña: se muestra en la conversación y en la trazabilidad.</p></div><ShieldCheck size={45} className="text-[#00C2B8]" /></div></div></div><div className="mt-6 flex items-center gap-3 rounded-2xl border border-[#E7D9B0] bg-[#FFF7E4] p-5 text-sm text-[#765A15]"><CircleAlert size={18} className="shrink-0" /><span><strong>Importante:</strong> MiEstado es un piloto de demostración. No representa a una entidad pública ni ejecuta trámites reales.</span></div></>;
}

function Help() {
  const topics = [
    ['¿Qué es MiEstado?', 'Es un piloto de experiencia pública conversacional. Aquí puedes explorar cómo una persona entiende, prepara y sigue un trámite desde un solo lugar.', Sparkles],
    ['¿Mis datos son reales?', 'No. Todos los datos, respuestas y conexiones de este entorno son simulados para demostración. No compartas claves, códigos ni documentos reales.', ShieldCheck],
    ['¿Cómo funciona un trámite?', 'Cuéntanos qué necesitas, revisa lo que el sistema entendió, autoriza cada consulta y confirma la acción antes de radicarla.', RouteIcon],
    ['¿Necesitas hablar con una entidad?', 'Las acciones del piloto no reemplazan a una entidad pública. Para un trámite real, usa siempre los canales oficiales que ya conoces.', Building2],
  ] as const;
  return <><PageTitle eyebrow="Centro de ayuda" title="Entender también es parte del trámite." description="Respuestas claras para recorrer este piloto con confianza." action={<PilotPill />} /><div className="grid gap-4 md:grid-cols-2">{topics.map(([title, copy, Icon], index) => <article key={title} data-testid={`help-topic-${index}`} className="rounded-2xl border border-[#DEE5F1] bg-white p-6 shadow-sm"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#E9EDFF] text-[#173BFF]"><Icon size={20} /></span><h2 className="mt-5 font-display text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-[#718098]">{copy}</p></article>)}</div><div className="mt-6 flex flex-col gap-4 rounded-2xl border border-[#D6E9E7] bg-[#ECFBF8] p-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-display text-lg font-bold text-[#145B58]">¿Quieres empezar?</p><p className="mt-1 text-sm text-[#397875]">Elige una necesidad y mira cómo MiEstado organiza el camino.</p></div><Button href="/asistente" variant="soft" icon={ArrowRight} testId="link-help-asistente">Abrir asistente</Button></div></>;
}

function Demo() {
  const [reset, setReset] = useState(false);
  const cases: Array<{ title: string; copy: string; href: string; icon: LucideIcon; tone: string }> = [
    { title: 'Traslado de vehículo', copy: 'De Montería a Medellín, con radicado y trazabilidad.', href: '/asistente', icon: Car, tone: 'blue' },
    { title: 'Impuesto vehicular', copy: 'Consulta el valor 2026 y confirma un pago de prueba.', href: '/impuesto', icon: ReceiptText, tone: 'yellow' },
    { title: 'Renovar licencia', copy: 'Cumple requisitos, escoge hora y recibe una cita.', href: '/licencia', icon: CalendarDays, tone: 'teal' },
  ];
  return <><PageTitle eyebrow="Laboratorio de recorridos" title="Demo guiada" description="Prueba los casos que muestran el alcance de MiEstado en pocos minutos." action={<Button onClick={() => setReset(true)} variant="outline" icon={RotateCcw} testId="button-demo-reset">Reiniciar demo</Button>} /><div className="grid gap-5 md:grid-cols-3">{cases.map(({ title, copy, href, icon: Icon, tone }, i) => <div key={title} className="rounded-2xl border border-[#DEE5F1] bg-white p-6"><span className={`grid h-12 w-12 place-items-center rounded-2xl ${tone === 'yellow' ? 'bg-[#FFF2CE] text-[#946900]' : tone === 'teal' ? 'bg-[#DDF9F5] text-[#087E78]' : 'bg-[#E9EDFF] text-[#173BFF]'}`}><Icon size={22} /></span><p className="mt-7 font-mono text-xs text-[#173BFF]">CASO 0{i + 1}</p><h2 className="mt-2 font-display text-xl font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-[#748096]">{copy}</p><Button href={href} variant="soft" icon={ArrowRight} testId={`link-demo-case-${i}`}>Probar caso</Button></div>)}</div>{reset && <div data-testid="status-demo-reset" className="mt-5 rounded-xl bg-[#DDF8ED] p-4 text-sm font-bold text-[#08784E]">Demo reiniciada. Puedes comenzar cualquier caso de nuevo.</div>}<div className="mt-7 rounded-2xl border border-[#DEE5F1] bg-[#F8FAFD] p-6"><div className="flex gap-3"><Sparkles className="text-[#173BFF]" size={18} /><div><p className="text-sm font-bold">Una nota del equipo</p><p className="mt-1 text-sm leading-6 text-[#68748A]">Los tiempos de carga, respuestas de fuentes y acciones de entidad están simulados para explorar la experiencia.</p></div></div></div></>;
}

function PageRouter() {
  return <Switch>
    <Route path="/inicio" component={Home} />
    <Route path="/asistente" component={Assistant} />
    <Route path="/tramites" component={Tramites} />
    <Route path="/tramites/traslado" component={TransferDetail} />
    <Route path="/explorar" component={Explore} />
    <Route path="/verificar" component={Verify} />
    <Route path="/impuesto" component={Tax} />
    <Route path="/licencia" component={License} />
    <Route path="/notificaciones" component={Notifications} />
    <Route path="/perfil" component={Profile} />
    <Route path="/entidad" component={EntityOverview} />
    <Route path="/entidad/bandeja" component={EntityInbox} />
    <Route path="/entidad/tramite" component={EntityCase} />
    <Route path="/entidad/servicios" component={EntityServices} />
    <Route path="/como-funciona" component={HowItWorks} />
    <Route path="/ayuda" component={Help} />
    <Route path="/demo" component={Demo} />
    <Route component={() => <EmptyState icon={CircleAlert} title="Página no encontrada" copy="La ruta que buscas no existe en este piloto." action={<Button href="/inicio">Volver al inicio</Button>} />} />
  </Switch>;
}

// Rutas publicas: accesibles sin autenticacion.
function PublicRoutes() {
  return <Switch>
    <Route path="/" component={Landing} />
    <Route path="/login" component={Login} />
    <Route path="/como-funciona" component={HowItWorks} />
    <Route path="/ayuda" component={Help} />
    <Route path="/demo" component={Demo} />
  </Switch>;
}

// Rutas protegidas: requieren sesion activa (RequireAuth redirige a /login).
function ProtectedRoutes() {
  return <RequireAuth><Shell><PageRouter /></Shell></RequireAuth>;
}

function AppRouter() {
  return <Switch>
    <Route path="/login" component={Login} />
    <Route path="/" component={Landing} />
    <Route path="/como-funciona" component={HowItWorks} />
    <Route path="/ayuda" component={Help} />
    <Route path="/demo" component={Demo} />
    <Route component={() => <RequireAuth><Shell><PageRouter /></Shell></RequireAuth>} />
  </Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ErrorBoundary>
            <AppRouter />
          </ErrorBoundary>
        </WouterRouter>
      </AuthProvider>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;